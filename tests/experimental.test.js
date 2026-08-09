// ============================================================
//  Tests for lib/experimental.js (Experimental Workspace Engine)
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CASStore } = require('../lib/cas');
const { SnapshotEngine } = require('../lib/snapshot');
const { BranchEngine } = require('../lib/branches');
const { ExperimentalWorkspace, createWorkspace, WS_PENDING, WS_COMMITTED, WS_ROLLED_BACK } = require('../lib/experimental');

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createVault(root) {
    fs.mkdirSync(path.join(root, 'Research'), { recursive: true });
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Research', 'A.md'), '# Note A\noriginal');
    fs.writeFileSync(path.join(root, 'Research', 'B.md'), '# Note B\nbase');
    fs.writeFileSync(path.join(root, '.obsidian', 'config.json'), '{}');
}

function makeWorkspace(root) {
    const base = path.join(root, '.vault-scholar');
    return createWorkspace(root, base);
}

test('create workspace snapshots vault and branches from current state', () => {
    const root = makeTempDir('vs-exp-create-');
    createVault(root);
    const ws = makeWorkspace(root);
    const res = ws.create('mathstral-derivations', 'test experiment');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.workspace.state, WS_PENDING);
    assert.ok(res.workspace.snapshotId);
    // snapshot stored a baseline
    const snaps = ws.snapshots.list();
    assert.strictEqual(snaps.length, 1);
    // branch created from current vault (2 notes, excludes .obsidian)
    const branch = ws.branches.load('mathstral-derivations');
    assert.strictEqual(Object.keys(branch.files).length, 2);
});

test('applyEdits swaps vault into branch state with new content', () => {
    const root = makeTempDir('vs-exp-apply-');
    createVault(root);
    const ws = makeWorkspace(root);
    ws.create('quantum-bounce-simulation', 'sim experiment');

    // AI modifications applied to the experimental workspace
    const edits = [
        { path: 'Research/A.md', content: '# Note A\nexperimental edit' },
    ];
    const res = ws.applyEdits('quantum-bounce-simulation', edits);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.applied, 1);
    // Vault now reflects the branch (experimental) state
    assert.strictEqual(
        fs.readFileSync(path.join(root, 'Research', 'A.md'), 'utf8'),
        '# Note A\nexperimental edit'
    );
    assert.strictEqual(ws.load('quantum-bounce-simulation').state, 'reviewing');
});

test('commit finalizes the workspace and preserves state', () => {
    const root = makeTempDir('vs-exp-commit-');
    createVault(root);
    const ws = makeWorkspace(root);
    ws.create('code-security-sweep', 'security');
    ws.applyEdits('code-security-sweep', [{ path: 'Research/B.md', content: '# Note B\naudited' }]);
    const res = ws.commit('code-security-sweep', 'security sweep done');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(ws.load('code-security-sweep').state, WS_COMMITTED);
    const branch = ws.branches.load('code-security-sweep');
    assert.strictEqual(branch.commits.length, 1);
});

test('rollback restores vault to baseline snapshot', () => {
    const root = makeTempDir('vs-exp-rollback-');
    createVault(root);
    const ws = makeWorkspace(root);
    const created = ws.create('black-hole-collapse-test', 'physics');
    ws.applyEdits('black-hole-collapse-test', [{ path: 'Research/A.md', content: '# Note A\nmutated by AI' }]);
    // Vault changed
    assert.notStrictEqual(
        fs.readFileSync(path.join(root, 'Research', 'A.md'), 'utf8'),
        '# Note A\noriginal'
    );
    // Rollback
    const res = ws.rollback('black-hole-collapse-test');
    assert.strictEqual(res.ok, true);
    assert.ok(res.restored >= 1);
    // Vault restored to original
    assert.strictEqual(
        fs.readFileSync(path.join(root, 'Research', 'A.md'), 'utf8'),
        '# Note A\noriginal'
    );
    assert.strictEqual(ws.load('black-hole-collapse-test').state, WS_ROLLED_BACK);
});

test('diff reports added/removed line counts after edits', () => {
    const root = makeTempDir('vs-exp-diff-');
    createVault(root);
    const ws = makeWorkspace(root);
    ws.create('auto-tag-test', 'tags');
    ws.applyEdits('auto-tag-test', [
        { path: 'Research/A.md', content: '# Note A\noriginal\nnew line added' },
    ]);
    const d = ws.diff('auto-tag-test');
    assert.strictEqual(d.ok, true);
    assert.ok(d.totalAdded > 0);
    assert.ok(d.files.some(f => f.path === 'Research/A.md'));
});

test('list and delete workspaces', () => {
    const root = makeTempDir('vs-exp-list-');
    createVault(root);
    const ws = makeWorkspace(root);
    ws.create('branch-one', 'first');
    ws.create('branch-two', 'second');
    assert.strictEqual(ws.list().length, 2);
    const del = ws.delete('branch-one');
    assert.strictEqual(del.ok, true);
    assert.strictEqual(ws.list().length, 1);
});

test('create duplicate workspace name fails', () => {
    const root = makeTempDir('vs-exp-dup-');
    createVault(root);
    const ws = makeWorkspace(root);
    ws.create('dup', 'first');
    const dup = ws.create('dup', 'second');
    assert.strictEqual(dup.ok, false);
});

test('rollback without snapshot fails gracefully', () => {
    const root = makeTempDir('vs-exp-nosnap-');
    createVault(root);
    const cas = new CASStore(path.join(root, '.vs', 'blobs'));
    const snapshots = new SnapshotEngine(root, path.join(root, '.vs', 'snapshots'), cas);
    const branches = new BranchEngine(root, path.join(root, '.vs', 'branches'), cas);
    const ws = new ExperimentalWorkspace(root, path.join(root, '.vs', 'workspaces'), { cas, snapshotEngine: snapshots, branchEngine: branches });
    // Manually craft a workspace with no snapshotId
    ws.init();
    const orphan = { name: 'orphan', state: WS_PENDING, created: new Date().toISOString(), snapshotId: null, branch: 'orphan', appliedFiles: {} };
    ws.save(orphan);
    const res = ws.rollback('orphan');
    assert.strictEqual(res.ok, false);
    assert.ok(res.error);
});
