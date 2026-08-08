// ============================================================
//  Tests for lib/snapshot.js and lib/backup.js
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CASStore } = require('../lib/cas');
const { SnapshotEngine, walkDir } = require('../lib/snapshot');
const { ExternalBackup } = require('../lib/backup');

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createVault(root) {
    fs.mkdirSync(path.join(root, 'Research'), { recursive: true });
    fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true });
    fs.mkdirSync(path.join(root, '.trash'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Research', 'A.md'), '# Note A\ncontent');
    fs.writeFileSync(path.join(root, 'Research', 'B.md'), '# Note B\nother');
    fs.writeFileSync(path.join(root, '.obsidian', 'config.json'), '{}');
    fs.writeFileSync(path.join(root, '.trash', 'old.md'), 'deleted');
}

test('walkDir excludes dot-directories', () => {
    const root = makeTempDir('vs-walk-');
    createVault(root);
    const files = walkDir(root).map(f => path.basename(f));
    assert.ok(files.includes('A.md'));
    assert.ok(files.includes('B.md'));
    assert.ok(!files.includes('config.json'));
    assert.ok(!files.includes('old.md'));
});

test('snapshot creates manifest and stores blobs', () => {
    const root = makeTempDir('vs-snap-');
    createVault(root);
    const cas = new CASStore(path.join(root, '.vault-scholar', 'blobs'));
    const engine = new SnapshotEngine(root, path.join(root, '.vault-scholar', 'snapshots'), cas);
    const snap = engine.create('test-snapshot', 'test');
    assert.strictEqual(snap.fileCount, 2);
    assert.strictEqual(snap.label, 'test-snapshot');
    assert.strictEqual(cas.list().length, 2);
    assert.strictEqual(engine.list().length, 1);
});

test('snapshot deduplicates unchanged content across snapshots', () => {
    const root = makeTempDir('vs-snap-');
    createVault(root);
    const cas = new CASStore(path.join(root, '.vault-scholar', 'blobs'));
    const engine = new SnapshotEngine(root, path.join(root, '.vault-scholar', 'snapshots'), cas);
    engine.create('s1', 'manual');
    // Modify one file
    fs.writeFileSync(path.join(root, 'Research', 'A.md'), '# Note A\nchanged');
    engine.create('s2', 'manual');
    // 3 unique blobs (A v1, A v2, B) — B shared across snapshots
    assert.strictEqual(cas.list().length, 3);
});

test('snapshot restore restores file content', () => {
    const root = makeTempDir('vs-snap-');
    createVault(root);
    const cas = new CASStore(path.join(root, '.vault-scholar', 'blobs'));
    const engine = new SnapshotEngine(root, path.join(root, '.vault-scholar', 'snapshots'), cas);
    const snap = engine.create('s1', 'manual');
    // Modify the file
    fs.writeFileSync(path.join(root, 'Research', 'A.md'), '# Note A\nchanged');
    // Restore
    const result = engine.restore(snap.id);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.restored, 2);
    assert.strictEqual(
        fs.readFileSync(path.join(root, 'Research', 'A.md'), 'utf8'),
        '# Note A\ncontent'
    );
});

test('snapshot prune removes oldest', () => {
    const root = makeTempDir('vs-snap-');
    createVault(root);
    const cas = new CASStore(path.join(root, '.vault-scholar', 'blobs'));
    const engine = new SnapshotEngine(root, path.join(root, '.vault-scholar', 'snapshots'), cas);
    engine.create('s1', 'manual');
    engine.create('s2', 'manual');
    engine.create('s3', 'manual');
    assert.strictEqual(engine.list().length, 3);
    const removed = engine.prune(2);
    assert.strictEqual(removed.length, 1);
    assert.strictEqual(engine.list().length, 2);
});

test('external backup copies and is incremental', () => {
    const root = makeTempDir('vs-vault-');
    const backup = makeTempDir('vs-backup-');
    createVault(root);
    const b = new ExternalBackup(root, backup);
    const r1 = b.run();
    assert.strictEqual(r1.copied, 2);
    assert.strictEqual(r1.errors, 0);
    // Verify copied
    assert.ok(fs.existsSync(path.join(backup, 'Research', 'A.md')));
    assert.ok(!fs.existsSync(path.join(backup, '.obsidian', 'config.json')));
    // Second run: all skipped
    const r2 = b.run();
    assert.strictEqual(r2.skipped, 2);
    assert.strictEqual(r2.copied, 0);
    // Change a file, third run copies only that
    fs.writeFileSync(path.join(root, 'Research', 'A.md'), '# Note A\nv2');
    const r3 = b.run();
    assert.strictEqual(r3.copied, 1);
    assert.strictEqual(r3.skipped, 1);
});