// ============================================================
//  Note History Engine
//
//  Captures per-note version history. Each version stores a
//  blob hash in the CAS store (deduplicated). Tracks version
//  numbers, timestamps, and content hashes.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { CASStore, sha256 } = require('./cas');
const { TrustClassifier, TRUST_LEVELS, CONTENT_SOURCES } = require('./trust');

class HistoryEngine {
    /**
     * @param {string} historyDir - Directory for history records.
     * @param {CASStore} cas - Content-addressable blob store.
     */
    constructor(historyDir, cas) {
        this.historyDir = historyDir;
        this.cas = cas;
    }

    init() {
        if (!fs.existsSync(this.historyDir)) {
            fs.mkdirSync(this.historyDir, { recursive: true });
        }
    }

    /**
     * Get the history file path for a note path.
     */
    historyFileFor(notePath) {
        const hash = sha256(notePath);
        return path.join(this.historyDir, hash + '.json');
    }

    /**
     * Load the version history for a note.
     */
    load(notePath) {
        this.init();
        const file = this.historyFileFor(notePath);
        if (!fs.existsSync(file)) return [];
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            return [];
        }
    }

    /**
     * Record a new version of a note. Returns the version record,
     * or null if the content is unchanged from the latest version.
     *
     * @param {string} notePath - Vault-relative note path.
     * @param {string} content - Note content.
     * @param {number} maxVersions - Max versions to keep (prune oldest).
     */
    record(notePath, content, maxVersions = 50) {
        this.init();
        const versions = this.load(notePath);
        const hash = sha256(content);

        // If unchanged from latest, don't add a duplicate
        if (versions.length > 0 && versions[versions.length - 1].hash === hash) {
            return null;
        }

        const blobHash = this.cas.put(content);
        const maxVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) : 0;
        const version = {
            version: maxVersion + 1,
            timestamp: new Date().toISOString(),
            hash,
            blobHash,
            // Trust Boundary metadata
            trust: TrustClassifier.classify(content, {
                source: CONTENT_SOURCES.USER_CREATED,
                trustLevel: TRUST_LEVELS.TRUSTED,
                verifiedBy: 'user',
            }),
        };
        versions.push(version);

        // Prune oldest
        while (versions.length > maxVersions) {
            versions.shift();
        }

        const file = this.historyFileFor(notePath);
        fs.writeFileSync(file, JSON.stringify(versions));
        return version;
    }

    /**
     * Get a specific version of a note.
     */
    getVersion(notePath, versionNumber) {
        const versions = this.load(notePath);
        const v = versions.find(x => x.version === versionNumber);
        if (!v) return null;
        const content = this.cas.getText(v.blobHash);
        return content === null ? null : { ...v, content };
    }

    /**
     * Get the latest recorded version content.
     */
    getLatest(notePath) {
        const versions = this.load(notePath);
        if (versions.length === 0) return null;
        return this.getVersion(notePath, versions[versions.length - 1].version);
    }

    /**
     * Restore a specific version of a note back into the live vault
     * file. Writes the version's blob content to `notePath` (resolved
     * relative to an externally-provided vault root, here the caller
     * passes the absolute path). Returns the restored content, or
     * null if the version or its blob cannot be resolved.
     *
     * @param {string} notePath - Vault-relative note path.
     * @param {number} versionNumber - The version to restore.
     * @param {string} [absoluteTarget] - Absolute path to write to.
     *        If omitted, the content is returned only (not written).
     */
    restore(notePath, versionNumber, absoluteTarget) {
        const v = this.getVersion(notePath, versionNumber);
        if (!v) return null;
        if (absoluteTarget) {
            fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
            fs.writeFileSync(absoluteTarget, v.content);
        }
        return v.content;
    }

    /**
     * List all notes that have history.
     */
    listNotes() {
        this.init();
        return fs.readdirSync(this.historyDir).filter(f => f.endsWith('.json'));
    }
}

module.exports = { HistoryEngine };
