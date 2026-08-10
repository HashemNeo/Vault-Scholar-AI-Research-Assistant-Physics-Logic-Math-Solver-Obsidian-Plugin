// ============================================================
//  Snapshot Engine (content-addressed)
//
//  Creates snapshots of a directory tree stored as JSON manifests
//  referencing blobs in a CASStore. Restores by reading blobs back
//  out. Supports auto-snapshot triggers, listing, and pruning.
// ============================================================

import fs from 'fs';
import path from 'path';
import { CASStore, sha256 } from './cas';
import { TrustClassifier, TRUST_LEVELS, CONTENT_SOURCES, TrustRecord } from './trust';

export const DEFAULT_EXCLUDES = new Set([
    '.obsidian', '.trash', '.git', '.copilot-index', '.megaignore',
    '.vault-scholar', 'assets',
]);

export interface SnapshotFileEntry {
    path: string;
    hash: string;
    size: number;
    mtime: number;
}

export interface SnapshotManifest {
    id: string;
    timestamp: string;
    label: string;
    trigger: string;
    fileCount: number;
    files: SnapshotFileEntry[];
    trust: TrustRecord;
}

export function walkDir(dir: string, exclude: Set<string> = DEFAULT_EXCLUDES): string[] {
    const results: string[] = [];
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

export class SnapshotEngine {
    vaultRoot: string;
    snapshotsDir: string;
    cas: CASStore;

    constructor(vaultRoot: string, snapshotsDir: string, cas: CASStore) {
        this.vaultRoot = vaultRoot;
        this.snapshotsDir = snapshotsDir;
        this.cas = cas;
    }

    init(): void {
        if (!fs.existsSync(this.snapshotsDir)) {
            fs.mkdirSync(this.snapshotsDir, { recursive: true });
        }
    }

    /**
     * Create a snapshot of the vault. Returns the snapshot manifest.
     */
    create(label = 'manual', trigger = 'manual'): SnapshotManifest {
        this.init();
        const files = walkDir(this.vaultRoot);
        const fileEntries: SnapshotFileEntry[] = [];
        for (const file of files) {
            const rel = path.relative(this.vaultRoot, file).split(path.sep).join('/');
            const hash = this.cas.putFile(file);
            const stat = fs.statSync(file);
            fileEntries.push({ path: rel, hash, size: stat.size, mtime: stat.mtimeMs });
        }
        const snapshot: SnapshotManifest = {
            id: sha256(Date.now() + '-' + label + '-' + Math.random()),
            timestamp: new Date().toISOString(),
            label,
            trigger,
            fileCount: fileEntries.length,
            files: fileEntries,
            // Trust Boundary metadata
            trust: TrustClassifier.classify(`snapshot:${label}`, {
                source: CONTENT_SOURCES.USER_CREATED,
                trustLevel: TRUST_LEVELS.TRUSTED,
                verifiedBy: 'user',
            }),
        };
        const dest = path.join(this.snapshotsDir, snapshot.id + '.json');
        fs.writeFileSync(dest, JSON.stringify(snapshot, null, 2));
        return snapshot;
    }

    /**
     * List all snapshots (newest first).
     */
    list(): SnapshotManifest[] {
        if (!fs.existsSync(this.snapshotsDir)) return [];
        const files = fs.readdirSync(this.snapshotsDir).filter(f => f.endsWith('.json'));
        const snapshots: SnapshotManifest[] = files.map(f => {
            try {
                return JSON.parse(fs.readFileSync(path.join(this.snapshotsDir, f), 'utf8')) as SnapshotManifest;
            } catch { return null; }
        }).filter((s): s is SnapshotManifest => s !== null);
        snapshots.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return snapshots;
    }

    /**
     * Load a snapshot manifest by id.
     */
    load(id: string): SnapshotManifest | null {
        const dest = path.join(this.snapshotsDir, id + '.json');
        if (!fs.existsSync(dest)) return null;
        try {
            return JSON.parse(fs.readFileSync(dest, 'utf8')) as SnapshotManifest;
        } catch {
            return null;
        }
    }

    /**
     * Restore a snapshot into the vault. Overwrites files that exist,
     * creates dirs as needed. Returns {restored, total}.
     */
    restore(id: string): { ok: boolean; restored?: number; total?: number; error?: string } {
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
    delete(id: string): boolean {
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
    prune(max: number): string[] {
        const snapshots = this.list();
        const removed: string[] = [];
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
    referencedBlobs(): Set<string> {
        const hashes = new Set<string>();
        for (const snap of this.list()) {
            for (const f of snap.files) hashes.add(f.hash);
        }
        return hashes;
    }
}