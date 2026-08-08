// ============================================================
//  Snapshot Engine (content-addressed)
//
//  Creates snapshots of a directory tree stored as JSON manifests
//  referencing blobs in a CASStore. Restores by reading blobs back
//  out. Supports auto-snapshot triggers, listing, and pruning.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { CASStore, sha256 } = require('./cas');

const DEFAULT_EXCLUDES = new Set([
    '.obsidian', '.trash', '.git', '.copilot-index', '.megaignore',
    '.vault-scholar', 'assets',
]);

function walkDir(dir, exclude = DEFAULT_EXCLUDES) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (exclude.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkDir(full, exclude));
        } else {
            results.push(full);
        }
    }
    return results;
}

class SnapshotEngine {
    /**
     * @param {string} vaultRoot - Root directory to snapshot.
     * @param {string} snapshotsDir - Where snapshot manifests are stored.
     * @param {CASStore} cas - Content-addressable blob store.
     */
    constructor(vaultRoot, snapshotsDir, cas) {
        this.vaultRoot = vaultRoot;
        this.snapshotsDir = snapshotsDir;
        this.cas = cas;
    }

    init() {
        if (!fs.existsSync(this.snapshotsDir)) {
            fs.mkdirSync(this.snapshotsDir, { recursive: true });
        }
    }

    /**
     * Create a snapshot of the vault. Returns the snapshot manifest.
     */
    create(label = 'manual', trigger = 'manual') {
        this.init();
        const files = walkDir(this.vaultRoot);
        const fileEntries = [];
        for (const file of files) {
            const rel = path.relative(this.vaultRoot, file).split(path.sep).join('/');
            const hash = this.cas.putFile(file);
            const stat = fs.statSync(file);
            fileEntries.push({ path: rel, hash, size: stat.size, mtime: stat.mtimeMs });
        }
        const snapshot = {
            id: sha256(Date.now() + '-' + label + '-' + Math.random()),
            timestamp: new Date().toISOString(),
            label,
            trigger,
            fileCount: fileEntries.length,
            files: fileEntries,
        };
        const dest = path.join(this.snapshotsDir, snapshot.id + '.json');
        fs.writeFileSync(dest, JSON.stringify(snapshot, null, 2));
        return snapshot;
    }

    /**
     * List all snapshots (newest first).
     */
    list() {
        if (!fs.existsSync(this.snapshotsDir)) return [];
        const files = fs.readdirSync(this.snapshotsDir).filter(f => f.endsWith('.json'));
        const snapshots = files.map(f => {
            try {
                return JSON.parse(fs.readFileSync(path.join(this.snapshotsDir, f), 'utf8'));
            } catch { return null; }
        }).filter(Boolean);
        snapshots.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return snapshots;
    }

    /**
     * Load a snapshot manifest by id.
     */
    load(id) {
        const dest = path.join(this.snapshotsDir, id + '.json');
        if (!fs.existsSync(dest)) return null;
        try {
            return JSON.parse(fs.readFileSync(dest, 'utf8'));
        } catch {
            return null;
        }
    }

    /**
     * Restore a snapshot into the vault. Overwrites files that exist,
     * creates dirs as needed. Returns {restored, total}.
     */
    restore(id) {
        const snapshot = this.load(id);
        if (!snapshot) return { ok: false, error: 'Snapshot not found' };
        let restored = 0;
        for (const entry of snapshot.files) {
            const content = this.cas.get(entry.hash);
            if (content === null) continue;
            const dest = path.join(this.vaultRoot, entry.path);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, content);
            restored++;
        }
        return { ok: true, restored, total: snapshot.fileCount };
    }

    /**
     * Delete a snapshot manifest by id.
     */
    delete(id) {
        const dest = path.join(this.snapshotsDir, id + '.json');
        if (fs.existsSync(dest)) {
            fs.unlinkSync(dest);
            return true;
        }
        return false;
    }

    /**
     * Prune old snapshots, keeping the newest `max` count.
     * Returns array of removed snapshot ids.
     */
    prune(max) {
        const snapshots = this.list();
        const removed = [];
        if (snapshots.length > max) {
            const toRemove = snapshots.slice(max);
            for (const s of toRemove) {
                this.delete(s.id);
                removed.push(s.id);
            }
        }
        return removed;
    }

    /**
     * Collect all blob hashes referenced by snapshots (for GC).
     */
    referencedBlobs() {
        const hashes = new Set();
        for (const snap of this.list()) {
            for (const f of snap.files) hashes.add(f.hash);
        }
        return hashes;
    }
}

module.exports = { SnapshotEngine, walkDir, DEFAULT_EXCLUDES };