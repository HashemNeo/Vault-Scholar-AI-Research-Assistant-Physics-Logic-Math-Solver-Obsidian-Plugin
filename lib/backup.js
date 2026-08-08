// ============================================================
//  External Vault Backup (Layer 1)
//
//  Mirrors the vault to an external directory (e.g. D:\Obsidian-Backups)
//  with a manifest of files + hashes. Incremental: unchanged files
//  (hash match) are skipped.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { walkDir, DEFAULT_EXCLUDES } = require('./snapshot');
const { sha256 } = require('./cas');

class ExternalBackup {
    /**
     * @param {string} vaultRoot - Source vault directory.
     * @param {string} backupRoot - Destination backup directory.
     */
    constructor(vaultRoot, backupRoot) {
        this.vaultRoot = vaultRoot;
        this.backupRoot = backupRoot;
        this.manifestFile = path.join(backupRoot, 'backup-manifest.json');
    }

    init() {
        if (!fs.existsSync(this.backupRoot)) {
            fs.mkdirSync(this.backupRoot, { recursive: true });
        }
    }

    /**
     * Load the previous manifest (map of relPath -> hash) if it exists.
     */
    loadPreviousManifest() {
        if (!fs.existsSync(this.manifestFile)) return {};
        try {
            const data = JSON.parse(fs.readFileSync(this.manifestFile, 'utf8'));
            return data.files || {};
        } catch {
            return {};
        }
    }

    /**
     * Run a backup. Returns stats {copied, skipped, total, errors}.
     */
    run() {
        this.init();
        const files = walkDir(this.vaultRoot);
        const previous = this.loadPreviousManifest();
        const newManifest = {};
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

        const manifest = {
            timestamp: new Date().toISOString(),
            source: this.vaultRoot,
            fileCount: Object.keys(newManifest).length,
            files: newManifest,
        };
        fs.writeFileSync(this.manifestFile, JSON.stringify(manifest, null, 2));

        return { copied, skipped, total: files.length, errors };
    }
}

module.exports = { ExternalBackup };