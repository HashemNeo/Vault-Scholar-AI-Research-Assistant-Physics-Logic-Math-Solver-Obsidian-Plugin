import { describe, it, expect } from 'vitest';
import { parseSemanticResult, buildPrompt } from '../src/lib/semantic-diff';

describe('semantic diff', () => {
    it('parses a full LLM result', () => {
        const raw = `Meaning: REDEFINED
Magnitude: MAJOR
Confidence: 94%
Description: The note was substantially rewritten to focus on quantum field theory.`;
        const result = parseSemanticResult(raw);
        expect(result.meaning).toBe('REDEFINED');
        expect(result.magnitude).toBe('MAJOR');
        expect(result.confidence).toBe(94);
        expect(result.description).toContain('quantum field theory');
    });

    it('handles lowercase keys', () => {
        const raw = `meaning: elaborated
magnitude: minor
confidence: 75%
description: Minor updates to clarify the algorithm.`;
        const result = parseSemanticResult(raw);
        expect(result.meaning).toBe('ELABORATED');
        expect(result.magnitude).toBe('MINOR');
        expect(result.confidence).toBe(75);
    });

    it('handles decimal confidence', () => {
        const raw = `Confidence: 66.5%`;
        const result = parseSemanticResult(raw);
        expect(result.confidence).toBe(66.5);
    });

    it('returns defaults for empty input', () => {
        const result = parseSemanticResult('');
        expect(result.meaning).toBe('UNKNOWN');
        expect(result.magnitude).toBe('UNKNOWN');
        expect(result.confidence).toBe(0);
        expect(result.description).toBe('');
    });

    it('handles missing fields gracefully', () => {
        const raw = `Meaning: CLARIFIED`;
        const result = parseSemanticResult(raw);
        expect(result.meaning).toBe('CLARIFIED');
        expect(result.magnitude).toBe('UNKNOWN');
        expect(result.confidence).toBe(0);
    });

    it('builds a complete prompt', () => {
        const prompt = buildPrompt('old content', 'new content');
        expect(prompt).toContain('PREVIOUS VERSION:');
        expect(prompt).toContain('CURRENT VERSION:');
        expect(prompt).toContain('old content');
        expect(prompt).toContain('new content');
        expect(prompt).toContain('Meaning:');
        expect(prompt).toContain('Magnitude:');
        expect(prompt).toContain('Confidence:');
        expect(prompt).toContain('Description:');
    });
});
