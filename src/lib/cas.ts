// ============================================================
//  Content-Addressable Storage (CAS)
//
//  Stores file content blobs keyed by SHA-256 hash, so that
//  identical content is stored only once. Snapshots, history,
//  and branches all reference blobs by hash, preventing
//  duplicate file bloat.
// ============================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function sha256(data: string | Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

export class CASStore {
    blobsDir: string;

    /**
     * @param blobsDir - Directory where blob files are stored.
     */
    constructor(blobsDir: string) {
        this.blobsDir = blobsDir;
    }

    init(): void {
        if (!fs.existsSync(this.blobsDir)) {
            fs.mkdirSync(this.blobsDir, { recursive: true });
        }
    }

    /**
     * Store content (Buffer or string). Returns the SHA-256 hash.
     * If content already exists, it is not duplicated.
     */
    put(content: string | Buffer): string {
        this.init();
        const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        const hash = sha256(buf);
        const dest = path.join(this.blobsDir, hash);
        if (!fs.existsSync(dest)) {
            const tmp = dest + '.tmp';
            fs.writeFileSync(tmp, buf);
            fs.renameSync(tmp, dest);
        }
        return hash;
    }

    /**
     * Store from a file path. Returns the SHA-256 hash.
     */
    putFile(filePath: string): string {
        const buf = fs.readFileSync(filePath);
        return this.put(buf);
    }

    /**
     * Retrieve content by hash. Returns Buffer, or null if missing.
     */
    get(hash: string): Buffer | null {
        const dest = path.join(this.blobsDir, hash);
        if (!fs.existsSync(dest)) return null;
        return fs.readFileSync(dest);
    }

    /**
     * Retrieve content as UTF-8 string. Returns null if missing.
     */
    getText(hash: string): string | null {
        const buf = this.get(hash);
        return buf ? buf.toString('utf8') : null;
    }

    /**
     * Check whether a hash exists.
     */
    has(hash: string): boolean {
        return fs.existsSync(path.join(this.blobsDir, hash));
    }

    /**
     * Delete a blob by hash. Returns true if removed.
     */
    remove(hash: string): boolean {
        const dest = path.join(this.blobsDir, hash);
        if (fs.existsSync(dest)) {
            fs.unlinkSync(dest);
            return true;
        }
        return false;
    }

    /**
     * List all blob hashes currently stored.
     */
    list(): string[] {
        this.init();
        return fs.readdirSync(this.blobsDir).filter((f) => /^[0-9a-f]{64}$/.test(f));
    }

    /**
     * Garbage collection: keep only blobs referenced by the given
     * set of hashes. Returns count of removed blobs.
     */
    gc(keepHashes: Iterable<string>): number {
        const keep = new Set(keepHashes);
        let removed = 0;
        for (const hash of this.list()) {
            if (!keep.has(hash)) {
                this.remove(hash);
                removed++;
            }
        }
        return removed;
    }
}