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

import fs from 'fs';
import path from 'path';
import { sha256, CASStore } from './cas';
import { SnapshotEngine, SnapshotManifest } from './snapshot';
import { BranchEngine, BranchManifest, BranchResult } from './branches';
import { diffLines, diffStats } from './diff';

export const WS_PENDING = 'pending';
export const WS_REVIEWING = 'reviewing';
export const WS_COMMITTED = 'committed';
export const WS_ROLLED_BACK = 'rolled_back';

export type WorkspaceState = typeof WS_PENDING | typeof WS_REVIEWING | typeof WS_COMMITTED | typeof WS_ROLLED_BACK;

export interface WorkspaceEdit {
    path: string;
    content: string;
}

export interface WorkspaceManifest {
    name: string;
    description: string;
    created: string;
    snapshotId: string;
    branch: string;
    state: WorkspaceState;
    appliedFiles: Record<string, string>;
    appliedAt?: string;
    committedAt?: string;
    commitMessage?: string;
    rolledBackAt?: string;
}

export interface WorkspaceDeps {
    cas?: CASStore;
    snapshotEngine?: SnapshotEngine;
    branchEngine?: BranchEngine;
}

export interface WorkspaceResult {
    ok: boolean;
    error?: string;
    workspace?: WorkspaceManifest;
    snapshot?: SnapshotManifest | { id: string; timestamp: string; fileCount: number; files: never[] };
    branch?: BranchManifest | { name: string; files: Record<string, string>; commits: []; baseState: Record<string, string> } | null;
    applied?: number;
    restored?: number;
    files?: Array<{ path: string; added: number; removed: number }>;
    totalAdded?: number;
    totalRemoved?: number;
}

export class ExperimentalWorkspace {
    vaultRoot: string;
    workspacesDir: string;
    cas: CASStore | null;
    snapshots: SnapshotEngine | null;
    branches: BranchEngine | null;

    constructor(vaultRoot: string, workspacesDir: string, deps: WorkspaceDeps = {}) {
        this.vaultRoot = vaultRoot;
        this.workspacesDir = workspacesDir;
        this.cas = deps.cas || null;
        this.snapshots = deps.snapshotEngine || null;
        this.branches = deps.branchEngine || null;
    }

    init(): void {
        if (!fs.existsSync(this.workspacesDir)) {
            fs.mkdirSync(this.workspacesDir, { recursive: true });
        }
        if (this.snapshots) this.snapshots.init();
        if (this.branches) this.branches.init();
    }

    workspaceFileFor(name: string): string {
        // Name is already sanitized by BranchEngine, but be defensive
        const clean = String(name || 'ws').replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
        return path.join(this.workspacesDir, clean + '.json');
    }

    /**
     * Load a workspace manifest.
     */
    load(name: string): WorkspaceManifest | null {
        const file = this.workspaceFileFor(name);
        if (!fs.existsSync(file)) return null;
        try { return JSON.parse(fs.readFileSync(file, 'utf8')) as WorkspaceManifest; }
        catch { return null; }
    }

    save(workspace: WorkspaceManifest): void {
        this.init();
        fs.writeFileSync(this.workspaceFileFor(workspace.name), JSON.stringify(workspace, null, 2));
    }

    /**
     * Create a new experimental workspace.
     *
     * Pipeline start: AI modifications are staged in a fresh branch,
     * and a baseline snapshot is taken *before* any changes so the
     * vault can be restored if the experiment is rolled back.
     */
    create(name: string, description = ''): WorkspaceResult {
        this.init();

        // 1. Snapshot created — baseline before changes (Layer 2)
        const snapshot = this.snapshots
            ? this.snapshots.create(name, 'experimental')
            : { id: sha256('fallback-' + Date.now()), timestamp: new Date().toISOString(), fileCount: 0, files: [] };

        // 2. Create the experimental branch from the current vault state
        let branch: BranchManifest | { name: string; files: Record<string, string>; commits: []; baseState: Record<string, string> };
        if (this.branches) {
            const res = this.branches.create(name, description);
            if (!res.ok) return res;
            branch = res.branch!;
        } else {
            branch = { name, files: {}, commits: [], baseState: {} };
        }

        const workspace: WorkspaceManifest = {
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
     */
    applyEdits(name: string, edits: WorkspaceEdit[]): WorkspaceResult {
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
    commit(name: string, message = 'Experimental commit'): WorkspaceResult {
        const workspace = this.load(name);
        if (!workspace) return { ok: false, error: 'Workspace not found' };
        if (!workspace.snapshotId) return { ok: false, error: 'No baseline snapshot' };

        let result: BranchResult | undefined;
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
    rollback(name: string): WorkspaceResult {
        const workspace = this.load(name);
        if (!workspace) return { ok: false, error: 'Workspace not found' };
        if (!workspace.snapshotId) return { ok: false, error: 'No baseline snapshot' };

        let restored = 0;
        // Restore from the baseline snapshot (Layer 2 restore)
        if (this.snapshots) {
            const result = this.snapshots.restore(workspace.snapshotId);
            restored = result.ok ? (result.restored || 0) : 0;
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
    list(): WorkspaceManifest[] {
        this.init();
        const files = fs.readdirSync(this.workspacesDir).filter(f => f.endsWith('.json'));
        const wss: WorkspaceManifest[] = files.map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(this.workspacesDir, f), 'utf8')) as WorkspaceManifest; }
            catch { return null; }
        }).filter((w): w is WorkspaceManifest => w !== null);
        wss.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
        return wss;
    }

    /**
     * Delete a workspace (and its branch + snapshot baseline).
     */
    delete(name: string): WorkspaceResult {
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
     */
    diff(name: string): WorkspaceResult {
        if (!this.branches) return { ok: false, error: 'BranchEngine not available' };
        const branch = this.branches.load(name);
        if (!branch) return { ok: false, error: 'Branch not found' };
        const diffs: Array<{ path: string; added: number; removed: number }> = [];
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
export function createWorkspace(vaultRoot: string, baseDir: string): ExperimentalWorkspace {
    const casDir = path.join(baseDir, 'blobs');
    const cas = new CASStore(casDir);
    const snapshots = new SnapshotEngine(vaultRoot, path.join(baseDir, 'snapshots'), cas);
    const branches = new BranchEngine(vaultRoot, path.join(baseDir, 'branches'), cas);
    const ws = new ExperimentalWorkspace(vaultRoot, path.join(baseDir, 'workspaces'), { cas, snapshotEngine: snapshots, branchEngine: branches });
    ws.init();
    return ws;
}