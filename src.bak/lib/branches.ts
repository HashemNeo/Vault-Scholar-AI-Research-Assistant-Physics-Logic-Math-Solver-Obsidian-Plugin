 // ============================================================
//  Experimental Branch Engine
//
//  Plugin-managed branches for the vault (no git dependency).
//  A branch is a manifest of {path -> blobHash} referencing the
//  CAS store. Supports create, switch, commit, rollback, merge,
//  and delete. Merges detect conflicts (both sides changed).
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { CASStore, sha256 } = require('./cas');
const { walkDir, DEFAULT_EXCLUDES } = require('./snapshot');
const { TrustClassifier, TRUST_LEVELS, CONTENT_SOURCES } = require('./trust');

class BranchEngine {
    /**
     * @param {string} vaultRoot - Root directory to manage.
     * @param {string} branchesDir - Directory for branch manifests.
     * @param {CASStore} cas - Content-addressable blob store.
     */
    constructor(vaultRoot, branchesDir, cas) {
        this.vaultRoot = vaultRoot;
        this.branchesDir = branchesDir;
        this.cas = cas;
    }

    init() {
        if (!fs.existsSync(this.branchesDir)) {
            fs.mkdirSync(this.branchesDir, { recursive: true });
        }
    }

    /**
     * Get the current vault state as {path: blobHash}.
     */
    currentFileMap() {
        const files = walkDir(this.vaultRoot);
        const map = {};
        for (const file of files) {
            const rel = path.relative(this.vaultRoot, file).split(path.sep).join('/');
            const hash = this.cas.putFile(file);
            map[rel] = hash;
        }
        return map;
    }

    /**
     * Branch manifest path helper.
     */
    branchFile(name) {
        return path.join(this.branchesDir, sanitizeBranchName(name) + '.json');
    }

    /**
     * List all branches.
     */
    list() {
        this.init();
        const files = fs.readdirSync(this.branchesDir).filter(f => f.endsWith('.json'));
        return files.map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(this.branchesDir, f), 'utf8')); }
            catch { return null; }
        }).filter(Boolean);
    }

    /**
     * Load a branch manifest.
     */
    load(name) {
        const file = this.branchFile(name);
        if (!fs.existsSync(file)) return null;
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch { return null; }
    }

    /**
     * Save a branch manifest.
     */
    save(branch) {
        this.init();
        fs.writeFileSync(this.branchFile(branch.name), JSON.stringify(branch, null, 2));
    }

    /**
     * Create a new branch from the current vault state.
     */
    create(name, description = '') {
        const clean = sanitizeBranchName(name);
        if (this.load(clean)) return { ok: false, error: 'Branch already exists' };
        const branch = {
            name: clean,
            description,
            created: new Date().toISOString(),
            parent: mainBranchName(),
            head: sha256(Date.now() + '-' + clean),
            files: this.currentFileMap(),
            commits: [],
            baseState: this.currentFileMap(),
            // Trust Boundary metadata
            trust: TrustClassifier.classify(`branch:${clean}`, {
                source: CONTENT_SOURCES.USER_CREATED,
                trustLevel: TRUST_LEVELS.TRUSTED,
                verifiedBy: 'user',
            }),
        };
        this.save(branch);
        return { ok: true, branch };
    }

    /**
     * Delete a branch.
     */
    delete(name) {
        const file = this.branchFile(name);
        if (!fs.existsSync(file)) return { ok: false, error: 'Branch not found' };
        fs.unlinkSync(file);
        return { ok: true };
    }

    /**
     * Switch current vault state to a branch's file map.
     * Returns {ok, restored}.
     */
    apply(name) {
        const branch = this.load(name);
        if (!branch) return { ok: false, error: 'Branch not found' };
        let restored = 0;
        for (const [rel, blobHash] of Object.entries(branch.files)) {
            const content = this.cas.get(blobHash);
            if (content === null) continue;
            const dest = path.join(this.vaultRoot, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content);
            restored++;
        }
        return { ok: true, restored, count: Object.keys(branch.files).length };
    }

    /**
     * Commit current vault state to a branch.
     */
    commit(name, message) {
        const branch = this.load(name);
        if (!branch) return { ok: false, error: 'Branch not found' };
        branch.files = this.currentFileMap();
        branch.head = sha256(Date.now() + '-' + branch.name + '-' + message);
        branch.commits.push({
            hash: branch.head,
            message: message || 'commit',
            timestamp: new Date().toISOString(),
            files: { ...branch.files },
        });
        this.save(branch);
        return { ok: true, branch };
    }

    /**
     * Rollback a branch to a specific commit (or last commit).
     */
    rollback(name) {
        const branch = this.load(name);
        if (!branch) return { ok: false, error: 'Branch not found' };
        // Rollback restores the branch's recorded file map (last committed state,
        // or creation state if no commits have been made yet). The common-ancestor
        // baseState is preserved across commits.
        let files;
        if (branch.commits && branch.commits.length > 0) {
            const lastCommit = branch.commits[branch.commits.length - 1];
            files = lastCommit.files || branch.files || branch.baseState || {};
        } else {
            files = branch.baseState || {};
        }
        branch.files = { ...files };
        this.save(branch);

        let restored = 0;
        for (const [rel, blobHash] of Object.entries(files)) {
            const content = this.cas.get(blobHash);
            if (content === null) continue;
            const dest = path.join(this.vaultRoot, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content);
            restored++;
        }
        return { ok: true, restored };
    }

    /**
     * Merge a branch into the current (main) vault state.
     * Uses the branch's baseState (captured at branch creation) as the
     * common ancestor for three-way conflict detection.
     * Returns stats including conflicts.
     */
    merge(branchName, targetName = mainBranchName()) {
        const branch = this.load(branchName);
        if (!branch) return { ok: false, error: 'Branch not found' };
        const target = this.load(targetName);
        const base = (target && target.baseState) || branch.baseState || {};
        const current = this.currentFileMap();
        const conflicts = [];
        const merged = { ...current };
        let updated = 0;

        for (const [rel, branchHash] of Object.entries(branch.files)) {
            const baseHash = base[rel];
            const currentHash = current[rel];
            const branchChanged = baseHash !== branchHash;
            const mainChanged = baseHash !== currentHash;
            // Conflict: both diverged from the common ancestor and differ
            if (branchChanged && mainChanged && branchHash !== currentHash) {
                conflicts.push({ path: rel, branchHash, currentHash, baseHash });
            } else {
                merged[rel] = branchHash;
                if (branchChanged) updated++;
            }
        }

        // Apply merged map to disk
        let applied = 0;
        for (const [rel, blobHash] of Object.entries(merged)) {
            const content = this.cas.get(blobHash);
            if (content === null) continue;
            const dest = path.join(this.vaultRoot, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content);
            applied++;
        }

        return { ok: true, applied, updated, conflicts };
    }

    /**
     * Get the main branch name (static helper).
     */
    getMainBranchName() {
        return mainBranchName();
    }
}

function sanitizeBranchName(name) {
    return String(name || 'branch').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40).toLowerCase();
}

function mainBranchName() {
    return 'main';
}

module.exports = { BranchEngine, sanitizeBranchName };