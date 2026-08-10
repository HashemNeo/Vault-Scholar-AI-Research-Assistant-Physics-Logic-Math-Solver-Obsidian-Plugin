import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CASStore } from '../src/lib/cas';

describe('CAS store', () => {
    let tmpDir: string;
    let cas: CASStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-cas-'));
        cas = new CASStore(path.join(tmpDir, 'blobs'));
    });

    afterEach(() => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('stores and retrieves text content', () => {
        const text = 'Hello, Vault Scholar!';
        const hash = cas.put(text);
        expect(cas.has(hash)).toBe(true);
        expect(cas.getText(hash)).toBe(text);
    });

    it('deduplicates identical content', () => {
        const text = 'deduplicated content';
        const h1 = cas.put(text);
        const h2 = cas.put(text);
        expect(h1).toBe(h2);
    });

    it('produces different hashes for different content', () => {
        const h1 = cas.put('content A');
        const h2 = cas.put('content B');
        expect(h1).not.toBe(h2);
    });

    it('getFile stores and retrieves file content', () => {
        const filePath = path.join(tmpDir, 'test.txt');
        fs.writeFileSync(filePath, 'file content here');
        const hash = cas.putFile(filePath);
        const data = cas.get(hash);
        expect(data).not.toBeNull();
        expect(data!.toString()).toBe('file content here');
    });

    it('returns null for missing blobs', () => {
        expect(cas.get('nonexistenthash123')).toBeNull();
    });

    it('lists only unique blob hashes (dedup)', () => {
        cas.put('a');
        cas.put('b');
        cas.put('b'); // dedup, should not increase count
        expect(cas.list()).toHaveLength(2);
    });
});
