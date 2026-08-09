// ============================================================
//  Tests for lib/branches.js (Experimental Branch Engine)
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CASStore } = require('../lib/cas');
const { BranchEngine, sanitizeBranchName } = require('../lib/branches');

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createVault(root) {
    fs.mkdirSync(path.join(root, 'Notes'), { recursive: true });
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Notes', 'A.md'), '# A v1');
    fs.writeFileSync(path.join(root, 'Notes', 'B.md'), '# B v1');
    fs.writeFileSync(path.join(root, '.obsidian', 'config.json'), '{}');
}

function makeEngine(root) {
    const cas = new CASStore(path.join(root, '.vault-scholar', 'blobs'));
    const engine = new BranchEngine(root, path.join(root, '.vault-scholar', 'branches'), cas);
    engine.init();
    return engine;
}

test('sanitizeBranchName cleanest names', () => {
    assert.strictEqual(sanitizeBranchName('mathstral-derivations'), 'mathstral-derivations');
    assert.strictEqual(sanitizeBranchName('Quantum Bounce!'), 'quantum_bounce_');
});

test('create branch from current vault state', () => {
    const root = makeTempDir('vs-branch-');
    createVault(root);
    const engine = makeEngine(root);
    const result = engine.create('quantum-bounce-simulation', 'test branch');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.branch.name, 'quantum-bounce-simulation');
    // 2 notes (config.json excluded from walkDir)
    assert.strictEqual(Object.keys(result.branch.files).length, 2);
});

test('duplicate branch create fails', () => {
    const root = makeTempDir('vs-branch-');
    createVault(root);
    const engine = makeEngine(root);
    engine.create('duplicate-branch');
    const dup = engine.create('duplicate-branch');
    assert.strictEqual(dup.ok, false);
});

test('apply switches vault to branch state', () => {
    const root = makeTempDir('vs-branch-');
    createVault(root);
    const engine = makeEngine(root);
    engine.create('branch-a');

    // Modify a file in the working vault
    fs.writeFileSync(path.join(root, 'Notes', 'A.md'), '# A v2 (after branch)');

    // Apply branch-a restores original content
    const applied = engine.apply('branch-a');
    assert.strictEqual(applied.ok, true);
    assert.strictEqual(
        fs.readFileSync(path.join(root, 'Notes', 'A.md'), 'utf8'),
        '# A v1'
    );
});

test('commit updates branch file map', () => {
    const root = makeTempDir('vs-branch-');
    createVault(root);
    const engine = makeEngine(root);
    engine.create('branch-c');

    // Modify, then commit
    fs.writeFileSync(path.join(root, 'Notes', 'B.md'), '# B v2');
    const committed = engine.commit('branch-c', 'update B');
    assert.strictEqual(committed.ok, true);
    assert.strictEqual(committed.branch.commits.length, 1);

    // Apply branch again — should have B v2 now
    fs.writeFileSync(path.join(root, 'Notes', 'B.md'), '# B v3');
    engine.apply('branch-c');
    assert.strictEqual(
        fs.readFileSync(path.join(root, 'Notes', 'B.md'), 'utf8'),
        '# B v2'
    );
});

test('rollback restores branch state', () => {
    const root = makeTempDir('vs-branch-');
    createVault(root);
    const engine = makeEngine(root);
    engine.create('branch-r');

    // Modify working vault after branch
    fs.writeFileSync(path.join(root, 'Notes', 'A.md'), '# A changed');
    const rolled = engine.rollback('branch-r');
    assert.strictEqual(rolled.ok, true);
    assert.strictEqual(
        fs.readFileSync(path.join(root, 'Notes', 'A.md'), 'utf8'),
        '# A v1'
    );
});

test('merge applies branch changes into current', () => {
    const root = makeTempDir('vs-branch-');
    createVault(root);
    const engine = makeEngine(root);

    // Create branch, change a file, commit
    engine.create('feature-x');
    fs.writeFileSync(path.join(root, 'Notes', 'A.md'), '# A feature version');
    engine.commit('feature-x', 'feature change');

    // Now change the working vault independently
    fs.writeFileSync(path.join(root, 'Notes', 'B.md'), '# B current version');

    // Merge feature-x in
    const merged = engine.merge('feature-x', 'main');
    assert.strictEqual(merged.ok, true);
    // A.md should take the feature version
    assert.strictEqual(
        fs.readFileSync(path.join(root, 'Notes', 'A.md'), 'utf8'),
        '# A feature version'
    );
});

test('merge detects conflict when both sides changed same file', () => {
    const root = makeTempDir('vs-branch-');
    createVault(root);
    const engine = makeEngine(root);

    // Branch created at # A v1
    engine.create('feature-conflict');
    // Branch changes A
    fs.writeFileSync(path.join(root, 'Notes', 'A.md'), '# A branch version');
    engine.commit('feature-conflict', 'branch A');

    // Working vault also changes A after commit
    fs.writeFileSync(path.join(root, 'Notes', 'A.md'), '# A working version');

    // Merge — both sides changed A.md after branch point → conflict
    const merged = engine.merge('feature-conflict', 'main');
    assert.strictEqual(merged.ok, true);
    assert.ok(merged.conflicts.length >= 1);
    assert.ok(merged.conflicts.some(c => c.path.endsWith('A.md')));
});