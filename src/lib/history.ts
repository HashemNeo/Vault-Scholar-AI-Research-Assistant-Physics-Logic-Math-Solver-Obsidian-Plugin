// ============================================================
//  Note History Engine
//
//  Captures per-note version history. Each version stores a
//  blob hash in the CAS store (deduplicated). Tracks version
//  numbers, timestamps, and content hashes.
// ============================================================

import fs from 'fs';
import path from 'path';
import { CASStore, sha256 } from './cas';
import { TrustClassifier, TRUST_LEVELS, CONTENT_SOURCES, TrustRecord } from './trust';

export interface VersionRecord {
    version: number;
    timestamp: string;
    hash: string;
    blobHash: string;
    trust: TrustRecord;
}

export interface VersionWithContent extends VersionRecord {
    content: string;
}

export class HistoryEngine {
    historyDir: string;
    cas: CASStore;

    constructor(historyDir: string, cas: CASStore) {
        this.historyDir = historyDir;
        this.cas = cas;
    }

    init(): void {
        if (!fs.existsSync(this.historyDir)) {
            fs.mkdirSync(this.historyDir, { recursive: true });
        }
    }

    /**
     * Get the history file path for a note path.
     */
    historyFileFor(notePath: string): string {
        const hash = sha256(notePath);
        return path.join(this.historyDir, hash + '.json');
    }

    /**
     * Load the version history for a note.
     */
    load(notePath: string): VersionRecord[] {
        this.init();
        const file = this.historyFileFor(notePath);
        if (!fs.existsSync(file)) return [];
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8')) as VersionRecord[];
        } catch {
            return [];
        }
    }

    /**
     * Record a new version of a note. Returns the version record,
     * or null if the content is unchanged from the latest version.
     */
    record(notePath: string, content: string, maxVersions = 50): VersionRecord | null {
        this.init();
        const versions = this.load(notePath);
        const hash = sha256(content);

        // If unchanged from latest, don't add a duplicate
        if (versions.length > 0 && versions[versions.length - 1].hash === hash) {
            return null;
        }

        const blobHash = this.cas.put(content);
        const maxVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) : 0;
        const version: VersionRecord = {
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
    getVersion(notePath: string, versionNumber: number): VersionWithContent | null {
        const versions = this.load(notePath);
        const v = versions.find(x => x.version === versionNumber);
        if (!v) return null;
        const content = this.cas.getText(v.blobHash);
        return content === null ? null : { ...v, content };
    }

    /**
     * Get the latest recorded version content.
     */
    getLatest(notePath: string): VersionWithContent | null {
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
     */
    restore(notePath: string, versionNumber: number, absoluteTarget?: string): string | null {
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
    listNotes(): string[] {
        this.init();
        return fs.readdirSync(this.historyDir).filter(f => f.endsWith('.json'));
    }
}