// ============================================================
//  Tests for lib/cas.js (Content-Addressable Storage)
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CASStore, sha256 } = require('../lib/cas');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'vs-cas-'));
}

test('put returns SHA-256 hash and stores content', () => {
    const dir = makeTempDir();
    const cas = new CASStore(path.join(dir, 'blobs'));
    const hash = cas.put('hello world');
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.strictEqual(cas.getText(hash), 'hello world');
});

test('put deduplicates identical content', () => {
    const dir = makeTempDir();
    const cas = new CASStore(path.join(dir, 'blobs'));
    const h1 = cas.put('same content');
    const h2 = cas.put('same content');
    assert.strictEqual(h1, h2);
    assert.strictEqual(cas.list().length, 1);
});

test('put stores differing content separately', () => {
    const dir = makeTempDir();
    const cas = new CASStore(path.join(dir, 'blobs'));
    const h1 = cas.put('alpha');
    const h2 = cas.put('beta');
    assert.notStrictEqual(h1, h2);
    assert.strictEqual(cas.list().length, 2);
});

test('putFile stores file content by hash', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, '# Heading\ncontent');
    const cas = new CASStore(path.join(dir, 'blobs'));
    const hash = cas.putFile(file);
    assert.strictEqual(cas.getText(hash), '# Heading\ncontent');
});

test('get returns null for missing hash', () => {
    const dir = makeTempDir();
    const cas = new CASStore(path.join(dir, 'blobs'));
    const buf = cas.get('a'.repeat(64));
    assert.strictEqual(buf, null);
});

test('has returns correct existence', () => {
    const dir = makeTempDir();
    const cas = new CASStore(path.join(dir, 'blobs'));
    const h = cas.put('x');
    assert.strictEqual(cas.has(h), true);
    assert.strictEqual(cas.has('b'.repeat(64)), false);
});

test('remove deletes a blob', () => {
    const dir = makeTempDir();
    const cas = new CASStore(path.join(dir, 'blobs'));
    const h = cas.put('y');
    assert.strictEqual(cas.remove(h), true);
    assert.strictEqual(cas.has(h), false);
    assert.strictEqual(cas.remove(h), false);
});

test('gc removes unreferenced blobs', () => {
    const dir = makeTempDir();
    const cas = new CASStore(path.join(dir, 'blobs'));
    const keep = cas.put('keep me');
    cas.put('drop me');
    assert.strictEqual(cas.list().length, 2);
    const removed = cas.gc([keep]);
    assert.strictEqual(removed, 1);
    assert.strictEqual(cas.list().length, 1);
    assert.strictEqual(cas.has(keep), true);
});

test('sha256 produces stable hex digest', () => {
    assert.strictEqual(
        sha256('abc'),
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
});