import { describe, it, expect } from 'vitest';
import { diffLines, diffStats, renderUnified } from '../src/lib/diff';

describe('diff engine', () => {
    it('detects added lines', () => {
        const ops = diffLines('a\nb', 'a\nb\nc');
        const added = ops.filter(o => o.type === 'add');
        expect(added).toHaveLength(1);
        expect(added[0].newLine).toBe('c');
    });

    it('detects removed lines', () => {
        const ops = diffLines('a\nb\nc', 'a\nb');
        const removed = ops.filter(o => o.type === 'remove');
        expect(removed).toHaveLength(1);
        expect(removed[0].oldLine).toBe('c');
    });

    it('reports equal lines unchanged', () => {
        const ops = diffLines('x\ny', 'x\ny');
        expect(ops.every(o => o.type === 'equal')).toBe(true);
    });

    it('computes correct stats', () => {
        const ops = diffLines('a\nb\nc', 'a\nb\nd');
        const stats = diffStats(ops);
        expect(stats.added).toBe(1);
        expect(stats.removed).toBe(1);
        expect(stats.unchanged).toBe(2);
    });

    it('handles empty inputs', () => {
        expect(diffLines('', '').every(o => o.type === 'equal')).toBe(true);
        expect(diffLines('a', '').filter(o => o.type === 'remove')).toHaveLength(1);
    });

    it('renders unified output', () => {
        const ops = diffLines('old line', 'new line');
        const rendered = renderUnified(ops);
        expect(rendered).toContain('- old line');
        expect(rendered).toContain('+ new line');
    });

    it('handles no changes', () => {
        const stats = diffStats(diffLines('identical', 'identical'));
        expect(stats.added).toBe(0);
        expect(stats.removed).toBe(0);
        expect(stats.unchanged).toBe(1);
    });
});
