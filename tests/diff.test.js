// ============================================================
//  Tests for lib/diff.js, lib/markdown-structure.js,
//  lib/history.js, and lib/semantic-diff.js
// ============================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { diffLines, renderUnified, diffStats } = require('../lib/diff');
const { parseStructure, structuralDiff, renderStructuralDiff } = require('../lib/markdown-structure');
const { HistoryEngine } = require('../lib/history');
const { CASStore } = require('../lib/cas');
const { semanticDiff, parseSemanticResult } = require('../lib/semantic-diff');

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ===== diff.js =====

test('diffLines detects single line change', () => {
    const ops = diffLines('Gravity is a force.', 'Gravity is spacetime curvature.');
    const removals = ops.filter(o => o.type === 'remove');
    const additions = ops.filter(o => o.type === 'add');
    assert.strictEqual(removals.length, 1);
    assert.strictEqual(additions.length, 1);
    assert.strictEqual(removals[0].oldLine, 'Gravity is a force.');
    assert.strictEqual(additions[0].newLine, 'Gravity is spacetime curvature.');
});

test('diffLines returns all equal for identical', () => {
    const ops = diffLines('same\ncontent', 'same\ncontent');
    assert.ok(ops.every(o => o.type === 'equal'));
    assert.strictEqual(ops.length, 2);
});

test('diffLines handles additions and removals', () => {
    const ops = diffLines('a\nb\nc', 'a\nb\nc\nd\ne');
    const additions = ops.filter(o => o.type === 'add');
    assert.strictEqual(additions.length, 2);
    assert.strictEqual(additions[0].newLine, 'd');
    assert.strictEqual(additions[1].newLine, 'e');
});

test('renderUnified produces -/+ markers', () => {
    const ops = diffLines('Gravity is a force.', 'Gravity is spacetime curvature.');
    const out = renderUnified(ops);
    assert.ok(out.includes('- Gravity is a force.'));
    assert.ok(out.includes('+ Gravity is spacetime curvature.'));
});

test('diffStats counts changes', () => {
    const ops = diffLines('a\nb', 'a\nc\nd');
    const stats = diffStats(ops);
    assert.strictEqual(stats.removed, 1);
    assert.strictEqual(stats.added, 2);
});

// ===== markdown-structure.js =====

test('parseStructure detects headings, math, links, tags', () => {
    const md = [
        '---',
        'title: Test',
        '---',
        '',
        '# Heading One',
        '',
        'Some paragraph with $x^2$ inline math.',
        '',
        '$$E = mc^2$$',
        '',
        'A [[linked-note]] and a tag #physics. [Source: Ref]',
        '',
        '```python',
        'print("hi")',
        '```',
        ''
    ].join('\n');
    const s = parseStructure(md);
    assert.strictEqual(s.headings.length, 1);
    assert.strictEqual(s.headings[0].text, 'Heading One');
    assert.strictEqual(s.equationCount, 1);
    assert.strictEqual(s.inlineMathCount, 1);
    assert.ok(s.links.includes('linked-note'));
    assert.ok(s.tags.includes('physics'));
    assert.ok(s.citations.length >= 1);
    assert.strictEqual(s.codeBlockCount, 1);
    assert.ok(s.frontmatter.includes('title: Test'));
});

test('structuralDiff detects added/removed elements', () => {
    const oldMD = '# Title\n\nParagraph one.\n\n$$a = b$$\n\n[Source: A]';
    const newMD = '# Title\n\n## New Section\n\nParagraph one.\n\nParagraph two.\n\n[Source: B]\n\n[[New Link]]';
    const oldS = parseStructure(oldMD);
    const newS = parseStructure(newMD);
    const changes = structuralDiff(oldS, newS);
    const types = changes.map(c => c.type);
    assert.ok(types.includes('heading_added'));
    assert.ok(types.includes('paragraphs_added'));
    assert.ok(types.includes('citation_removed'));
    assert.ok(types.includes('link_added'));
});

test('renderStructuralDiff produces tree', () => {
    const changes = [
        { type: 'heading_added', value: '# New' },
        { type: 'paragraphs_added', count: 2 },
        { type: 'citation_removed', value: '[Source: A]' },
    ];
    const out = renderStructuralDiff(changes);
    assert.ok(out.includes('Heading added'));
    assert.ok(out.includes('Paragraphs added: 2'));
});

// ===== history.js =====

test('history records versions and dedupes unchanged', () => {
    const dir = makeTempDir('vs-hist-');
    const cas = new CASStore(path.join(dir, 'blobs'));
    const history = new HistoryEngine(path.join(dir, 'history'), cas);
    const note = 'Math/Deriv.md';

    history.record(note, 'version one');
    history.record(note, 'version two');
    // Unchanged — should not create a new version
    const dup = history.record(note, 'version two');
    assert.strictEqual(dup, null);

    const versions = history.load(note);
    assert.strictEqual(versions.length, 2);
    assert.strictEqual(versions[0].version, 1);
    assert.strictEqual(versions[1].version, 2);
});

test('history getVersion returns content', () => {
    const dir = makeTempDir('vs-hist-');
    const cas = new CASStore(path.join(dir, 'blobs'));
    const history = new HistoryEngine(path.join(dir, 'history'), cas);
    const note = 'Research/A.md';
    history.record(note, 'content alpha');
    history.record(note, 'content beta');
    const v1 = history.getVersion(note, 1);
    const v2 = history.getVersion(note, 2);
    assert.strictEqual(v1.content, 'content alpha');
    assert.strictEqual(v2.content, 'content beta');
});

test('history prunes to maxVersions', () => {
    const dir = makeTempDir('vs-hist-');
    const cas = new CASStore(path.join(dir, 'blobs'));
    const history = new HistoryEngine(path.join(dir, 'history'), cas);
    const note = 'Code/Script.md';
    for (let i = 1; i <= 5; i++) {
        history.record(note, 'content ' + i, 3);
    }
    const versions = history.load(note);
    assert.strictEqual(versions.length, 3);
    assert.strictEqual(versions[0].version, 3);
    assert.strictEqual(versions[2].version, 5);
});

test('history restore writes a version back to disk', () => {
    const dir = makeTempDir('vs-hist-');
    const cas = new CASStore(path.join(dir, 'blobs'));
    const history = new HistoryEngine(path.join(dir, 'history'), cas);
    const note = 'Research/A.md';
    const target = path.join(dir, 'vault', 'Research', 'A.md');
    history.record(note, 'alpha content');
    history.record(note, 'beta content');
    // Restore version 1 onto disk
    const restored = history.restore(note, 1, target);
    assert.strictEqual(restored, 'alpha content');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'alpha content');
    // Restore version 2
    history.restore(note, 2, target);
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'beta content');
    // Restore nonexistent version returns null
    assert.strictEqual(history.restore(note, 999, target), null);
});

// ===== semantic-diff.js =====

test('parseSemanticResult extracts fields', () => {
    const raw = 'Meaning: REDEFINED\nMagnitude: MAJOR\nConfidence: 94%\nDescription: Gravity is now described geometrically.';
    const r = parseSemanticResult(raw);
    assert.strictEqual(r.meaning, 'REDEFINED');
    assert.strictEqual(r.magnitude, 'MAJOR');
    assert.strictEqual(r.confidence, 94);
    assert.ok(r.description.includes('geometrically'));
});

test('semanticDiff calls generateFn and returns parsed result', async () => {
    const generateFn = async () => 'Meaning: CLARIFIED\nMagnitude: MINOR\nConfidence: 80%\nDescription: Clarified wording.';
    const res = await semanticDiff('old', 'new', generateFn);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.result.meaning, 'CLARIFIED');
    assert.strictEqual(res.result.magnitude, 'MINOR');
});

test('semanticDiff falls back gracefully on error', async () => {
    const generateFn = async () => { throw new Error('model down'); };
    const res = await semanticDiff('old', 'new', generateFn);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error);
});