// ============================================================
//  Content-Addressable Storage (CAS)
//
//  Stores file content blobs keyed by SHA-256 hash, so that
//  identical content is stored only once. Snapshots, history,
//  and branches all reference blobs by hash, preventing
//  duplicate file bloat.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

class CASStore {
    /**
     * @param {string} blobsDir - Directory where blob files are stored.
     */
    constructor(blobsDir) {
        this.blobsDir = blobsDir;
    }

    init() {
        if (!fs.existsSync(this.blobsDir)) {
            fs.mkdirSync(this.blobsDir, { recursive: true });
        }
    }

    /**
     * Store content (Buffer or string). Returns the SHA-256 hash.
     * If content already exists, it is not duplicated.
     */
    put(content) {
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
    putFile(filePath) {
        const buf = fs.readFileSync(filePath);
        return this.put(buf);
    }

    /**
     * Retrieve content by hash. Returns Buffer, or null if missing.
     */
    get(hash) {
        const dest = path.join(this.blobsDir, hash);
        if (!fs.existsSync(dest)) return null;
        return fs.readFileSync(dest);
    }

    /**
     * Retrieve content as UTF-8 string. Returns null if missing.
     */
    getText(hash) {
        const buf = this.get(hash);
        return buf ? buf.toString('utf8') : null;
    }

    /**
     * Check whether a hash exists.
     */
    has(hash) {
        return fs.existsSync(path.join(this.blobsDir, hash));
    }

    /**
     * Delete a blob by hash. Returns true if removed.
     */
    remove(hash) {
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
    list() {
        this.init();
        return fs.readdirSync(this.blobsDir).filter(f => /^[0-9a-f]{64}$/.test(f));
    }

    /**
     * Garbage collection: keep only blobs referenced by the given
     * set of hashes. Returns count of removed blobs.
     */
    gc(keepHashes) {
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

module.exports = { CASStore, sha256 };