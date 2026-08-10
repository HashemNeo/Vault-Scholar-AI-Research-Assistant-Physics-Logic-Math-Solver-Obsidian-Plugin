// ============================================================
//  External Vault Backup (Layer 1)
//
//  Mirrors the vault to an external directory (e.g. D:\Obsidian-Backups)
//  with a manifest of files + hashes. Incremental: unchanged files
//  (hash match) are skipped.
// ============================================================

import fs from 'fs';
import path from 'path';
import { walkDir, DEFAULT_EXCLUDES } from './snapshot';
import { sha256 } from './cas';
import { TrustClassifier, TRUST_LEVELS, CONTENT_SOURCES, TrustRecord } from './trust';

export interface BackupManifest {
    timestamp: string;
    source: string;
    fileCount: number;
    files: Record<string, string>;
    trust: TrustRecord;
}

export interface BackupStats {
    copied: number;
    skipped: number;
    total: number;
    errors: number;
}

export class ExternalBackup {
    vaultRoot: string;
    backupRoot: string;
    manifestFile: string;

    constructor(vaultRoot: string, backupRoot: string) {
        this.vaultRoot = vaultRoot;
        this.backupRoot = backupRoot;
        this.manifestFile = path.join(backupRoot, 'backup-manifest.json');
    }

    init(): void {
        if (!fs.existsSync(this.backupRoot)) {
            fs.mkdirSync(this.backupRoot, { recursive: true });
        }
    }

    /**
     * Load the previous manifest (map of relPath -> hash) if it exists.
     */
    loadPreviousManifest(): Record<string, string> {
        if (!fs.existsSync(this.manifestFile)) return {};
        try {
            const data = JSON.parse(fs.readFileSync(this.manifestFile, 'utf8')) as BackupManifest;
            return data.files || {};
        } catch {
            return {};
        }
    }

    /**
     * Run a backup. Returns stats {copied, skipped, total, errors}.
     */
    run(): BackupStats {
        this.init();
        const files = walkDir(this.vaultRoot);
        const previous = this.loadPreviousManifest();
        const newManifest: Record<string, string> = {};
        let copied = 0, skipped = 0, errors = 0;

        for (const file of files) {
            const rel = path.relative(this.vaultRoot, file).split(path.sep).join('/');
            try {
                const hash = sha256(fs.readFileSync(file));
                newManifest[rel] = hash;
                if (previous[rel] === hash) {
                    skipped++;
                } else {
                    const dest = path.join(this.backupRoot, rel);
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.copyFileSync(file, dest);
                    copied++;
                }
            } catch {
                errors++;
            }
        }

        const manifest: BackupManifest = {
            timestamp: new Date().toISOString(),
            source: this.vaultRoot,
            fileCount: Object.keys(newManifest).length,
            files: newManifest,
            // Trust Boundary metadata
            trust: TrustClassifier.classify(`backup:${new Date().toISOString()}`, {
                source: CONTENT_SOURCES.USER_CREATED,
                trustLevel: TRUST_LEVELS.TRUSTED,
                verifiedBy: 'user',
            }),
        };
        fs.writeFileSync(this.manifestFile, JSON.stringify(manifest, null, 2));

        return { copied, skipped, total: files.length, errors };
    }
}