import { describe, it, expect } from 'vitest';
import { parseStructure, structuralDiff, renderStructuralDiff } from '../src/lib/markdown-structure';

describe('markdown structure parser', () => {
    it('parses headings', () => {
        const s = parseStructure('# Title\n## Section\n### Subsection');
        expect(s.headings).toHaveLength(3);
        expect(s.headings[0].level).toBe(1);
        expect(s.headings[0].text).toBe('Title');
        expect(s.headings[2].level).toBe(3);
    });

    it('counts paragraphs', () => {
        const s = parseStructure('para one\n\npara two\n\npara three');
        expect(s.paragraphCount).toBe(3);
    });

    it('skips headings when counting paragraphs', () => {
        const s = parseStructure('# Heading\n\npara one');
        expect(s.paragraphCount).toBe(1);
        expect(s.headings).toHaveLength(1);
    });

    it('extracts tags', () => {
        const s = parseStructure('See #tag1 and #tag2');
        expect(s.tags).toContain('tag1');
        expect(s.tags).toContain('tag2');
    });

    it('extracts wiki links', () => {
        const s = parseStructure('See [[Note One]] and [[Note Two]]');
        expect(s.links).toContain('Note One');
        expect(s.links).toContain('Note Two');
    });

    it('counts block equations', () => {
        const s = parseStructure('Some text\n\n$$\nx = 1\n$$\n\nmore text');
        expect(s.equationCount).toBe(1);
    });

    it('counts inline math', () => {
        const s = parseStructure('$x^2 + y^2 = z^2$ and $E = mc^2$');
        expect(s.inlineMathCount).toBe(2);
    });

    it('counts code blocks and skips content inside', () => {
        const s = parseStructure('Before\n```\n# heading inside code\n```\nAfter');
        expect(s.codeBlockCount).toBe(1);
        expect(s.headings).toHaveLength(0);
    });

    it('parses frontmatter', () => {
        const s = parseStructure('---\ntitle: Test\n---\n\nBody text');
        expect(s.frontmatter).not.toBeNull();
        expect(s.frontmatter).toContain('title');
    });

    it('returns zero counts for empty input', () => {
        const s = parseStructure('');
        expect(s.headings).toHaveLength(0);
        expect(s.paragraphCount).toBe(0);
        expect(s.equationCount).toBe(0);
    });
});

describe('structural diff', () => {
    it('detects heading additions', () => {
        const old_s = parseStructure('# A\n');
        const new_s = parseStructure('# A\n## B\n');
        const changes = structuralDiff(old_s, new_s);
        expect(changes).toContainEqual(expect.objectContaining({ type: 'heading_added' }));
    });

    it('detects heading removals', () => {
        const old_s = parseStructure('# A\n## B\n');
        const new_s = parseStructure('# A\n');
        const changes = structuralDiff(old_s, new_s);
        expect(changes).toContainEqual(expect.objectContaining({ type: 'heading_removed', value: '## B' }));
    });

    it('detects paragraph changes', () => {
        const old_s = parseStructure('para one\n\npara two');
        const new_s = parseStructure('para one');
        const changes = structuralDiff(old_s, new_s);
        expect(changes).toContainEqual(expect.objectContaining({ type: 'paragraphs_removed', count: 1 }));
    });

    it('detects tag additions', () => {
        const old_s = parseStructure('text\n');
        const new_s = parseStructure('text #newtag\n');
        const changes = structuralDiff(old_s, new_s);
        expect(changes).toContainEqual(expect.objectContaining({ type: 'tag_added', value: 'newtag' }));
    });

    it('detects no changes for identical content', () => {
        const s1 = parseStructure('# Title\nSome text\n');
        const s2 = parseStructure('# Title\nSome text\n');
        expect(structuralDiff(s1, s2)).toHaveLength(0);
    });

    it('renders changes as a tree', () => {
        const old_s = parseStructure('# A');
        const new_s = parseStructure('# A\n## B');
        const changes = structuralDiff(old_s, new_s);
        const rendered = renderStructuralDiff(changes);
        expect(rendered).toContain('Changed:');
        expect(rendered).toContain('Heading added');
    });

    it('renders "no changes" when empty', () => {
        const rendered = renderStructuralDiff([]);
        expect(rendered).toContain('No structural changes');
    });
});
