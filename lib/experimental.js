// ============================================================
//  Experimental Workspace Engine (Phase 7)
//
//  Implements the safe AI-editing pipeline:
//    AI modifications
//         ↓
//    Experimental Workspace
//         ↓
//    Snapshot created          ← baseline snapshot (CAS)
//         ↓
//    Changes applied           ← edits written into a branch
//         ↓
//    User evaluates
//         ↓
//    Commit / Rollback
//
//  The workspace orchestrates a SnapshotEngine (for the baseline
//  snapshot) and a BranchEngine (for the live, evaluatable,
//  committable branch state). Both share the same CASStore so
//  blob content is deduplicated across experiments.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { sha256 } = require('./cas');
const { SnapshotEngine } = require('./snapshot');
const { BranchEngine } = require('./branches');

const WS_PENDING = 'pending';
const WS_REVIEWING = 'reviewing';
const WS_COMMITTED = 'committed';
const WS_ROLLED_BACK = 'rolled_back';

class ExperimentalWorkspace {
    /**
     * @param {string} vaultRoot - Root directory to manage.
     * @param {string} workspacesDir - Directory for workspace manifests.
     * @param {object} deps - { cas, snapshotEngine, branchEngine }
     */
    constructor(vaultRoot, workspacesDir, deps = {}) {
        this.vaultRoot = vaultRoot;
        this.workspacesDir = workspacesDir;
        this.cas = deps.cas;
        this.snapshots = deps.snapshotEngine;
        this.branches = deps.branchEngine;
        // If engines weren't provided, build them from paths
        if (!this.cas) this.cas = deps.cas;
    }

    init() {
        if (!fs.existsSync(this.workspacesDir)) {
            fs.mkdirSync(this.workspacesDir, { recursive: true });
        }
        if (this.snapshots) this.snapshots.init();
        if (this.branches) this.branches.init();
    }

    workspaceFileFor(name) {
        // Name is already sanitized by BranchEngine, but be defensive
        const clean = String(name || 'ws').replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
        return path.join(this.workspacesDir, clean + '.json');
    }

    /**
     * Load a workspace manifest.
     */
    load(name) {
        const file = this.workspaceFileFor(name);
        if (!fs.existsSync(file)) return null;
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch { return null; }
    }

    save(workspace) {
        this.init();
        fs.writeFileSync(this.workspaceFileFor(workspace.name), JSON.stringify(workspace, null, 2));
    }

    /**
     * Create a new experimental workspace.
     *
     * Pipeline start: AI modifications are staged in a fresh branch,
     * and a baseline snapshot is taken *before* any changes so the
     * vault can be restored if the experiment is rolled back.
     *
     * @param {string} name - Branch/workspace name.
     * @param {string} description - Human description / AI prompt.
     * @returns {{ok: boolean, workspace?, snapshot?, branch?, error?}}
     */
    create(name, description = '') {
        this.init();

        // 1. Snapshot created — baseline before changes (Layer 2)
        const snapshot = this.snapshots
            ? this.snapshots.create(name, 'experimental')
            : { id: sha256('fallback-' + Date.now()), timestamp: new Date().toISOString(), fileCount: 0, files: [] };

        // 2. Create the experimental branch from the current vault state
        let branch;
        if (this.branches) {
            const res = this.branches.create(name, description);
            if (!res.ok) return res;
            branch = res.branch;
        } else {
            branch = { name, files: {}, commits: [], baseState: {} };
        }

        const workspace = {
            name: branch.name,
            description,
            created: new Date().toISOString(),
            snapshotId: snapshot.id,
            branch: branch.name,
            state: WS_PENDING,
            appliedFiles: {},
        };

        this.save(workspace);
        return { ok: true, workspace, snapshot, branch };
    }

    /**
     * Apply AI-generated edits into the experimental workspace.
     * Each edit is { path: relPath, content: string }.
     * After writing, the branch's file map is updated and the vault
     * working tree is swapped to the branch state (so the user can
     * evaluate the changes live).
     *
     * @returns {{ok: boolean, applied: number, conflicts?: []}}
     */
    applyEdits(name, edits) {
        const workspace = this.load(name);
        if (!workspace) return { ok: false, error: 'Workspace not found' };
        if (!this.branches) return { ok: false, error: 'BranchEngine not available' };

        // Update branch file map with new content (CAS-deduplicated)
        const branch = this.branches.load(name);
        if (!branch) return { ok: false, error: 'Branch not found' };
        for (const edit of edits) {
            const hash = this.branches.cas.put(edit.content);
            branch.files[edit.path] = hash;
            workspace.appliedFiles[edit.path] = hash;
        }

        branch.state = WS_REVIEWING;
        this.branches.save(branch);

        // Swap the live vault into the experimental branch state
        // (Changes applied — user evaluates)
        this.branches.apply(name);

        workspace.state = WS_REVIEWING;
        workspace.appliedAt = new Date().toISOString();
        this.save(workspace);

        return { ok: true, applied: edits.length };
    }

    /**
     * Commit the experimental workspace.
     * Finalizes the branch with a commit message; the working vault
     * keeps the experimental state (now committed).
     */
    commit(name, message = 'Experimental commit') {
        const workspace = this.load(name);
        if (!workspace) return { ok: false, error: 'Workspace not found' };
        if (!workspace.snapshotId) return { ok: false, error: 'No baseline snapshot' };

        let result;
        if (this.branches) {
            result = this.branches.commit(name, message);
            if (!result.ok) return result;
        }

        workspace.state = WS_COMMITTED;
        workspace.committedAt = new Date().toISOString();
        workspace.commitMessage = message;
        this.save(workspace);

        return { ok: true, workspace, branch: this.branches ? this.branches.load(name) : null };
    }

    /**
     * Rollback the experimental workspace.
     * Restores the vault to the baseline snapshot taken at creation,
     * reverting all AI edits. The branch record is preserved for
     * reference (state = rolled_back).
     */
    rollback(name) {
        const workspace = this.load(name);
        if (!workspace) return { ok: false, error: 'Workspace not found' };
        if (!workspace.snapshotId) return { ok: false, error: 'No baseline snapshot' };

        let restored = 0;
        // Restore from the baseline snapshot (Layer 2 restore)
        if (this.snapshots) {
            const result = this.snapshots.restore(workspace.snapshotId);
            restored = result.ok ? result.restored : 0;
        }

        // Also roll the branch back to its base state
        if (this.branches) {
            this.branches.rollback(name);
        }

        workspace.state = WS_ROLLED_BACK;
        workspace.rolledBackAt = new Date().toISOString();
        this.save(workspace);

        return { ok: true, restored };
    }

    /**
     * List all experimental workspaces (newest first).
     */
    list() {
        this.init();
        const files = fs.readdirSync(this.workspacesDir).filter(f => f.endsWith('.json'));
        const wss = files.map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(this.workspacesDir, f), 'utf8')); }
            catch { return null; }
        }).filter(Boolean);
        wss.sort((a, b) => new Date(b.created) - new Date(a.created));
        return wss;
    }

    /**
     * Delete a workspace (and its branch + snapshot baseline).
     */
    delete(name) {
        const workspace = this.load(name);
        if (!workspace) return { ok: false, error: 'Workspace not found' };

        if (this.branches) this.branches.delete(name);
        if (this.snapshots && workspace.snapshotId) this.snapshots.delete(workspace.snapshotId);

        const file = this.workspaceFileFor(name);
        if (fs.existsSync(file)) fs.unlinkSync(file);

        return { ok: true };
    }

    /**
     * Get the current diff stats for a workspace's applied edits
     * vs. its base state (text-level line diff per file).
     * Requires lib/diff.js to be available.
     */
    diff(name) {
        if (!this.branches) return { ok: false, error: 'BranchEngine not available' };
        const branch = this.branches.load(name);
        if (!branch) return { ok: false, error: 'Branch not found' };
        const { diffLines, diffStats } = require('./diff');
        const diffs = [];
        let totalAdded = 0, totalRemoved = 0;
        for (const [rel, hash] of Object.entries(branch.files)) {
            const baseHash = branch.baseState ? branch.baseState[rel] : null;
            if (baseHash === hash) continue;
            const oldContent = (baseHash && this.branches.cas.getText(baseHash)) || '';
            const newContent = this.branches.cas.getText(hash) || '';
            const ops = diffLines(oldContent, newContent);
            const stats = diffStats(ops);
            totalAdded += stats.added;
            totalRemoved += stats.removed;
            diffs.push({ path: rel, added: stats.added, removed: stats.removed });
        }
        return { ok: true, files: diffs, totalAdded, totalRemoved };
    }
}

// Factory: build a fully-wired workspace from a vault root + base dir
function createWorkspace(vaultRoot, baseDir) {
    const casDir = path.join(baseDir, 'blobs');
    const cas = new (require('./cas').CASStore)(casDir);
    const snapshots = new SnapshotEngine(vaultRoot, path.join(baseDir, 'snapshots'), cas);
    const branches = new BranchEngine(vaultRoot, path.join(baseDir, 'branches'), cas);
    const ws = new ExperimentalWorkspace(vaultRoot, path.join(baseDir, 'workspaces'), { cas, snapshotEngine: snapshots, branchEngine: branches });
    ws.init();
    return ws;
}

module.exports = { ExperimentalWorkspace, createWorkspace, WS_PENDING, WS_REVIEWING, WS_COMMITTED, WS_ROLLED_BACK };
