// ============================================================
//  Generic Settings Field Factory
//
//  Replaces the 400+ line settings tab in main.ts with a
//  data-driven field definition array + single factory function.
//  Every setting key matches the original DEFAULT_SETTINGS.
// ============================================================

import { Setting, Notice } from 'obsidian';
import { TRUST_LEVELS } from '../lib/trust';
import { MODELS } from '../core/settings';

export type SettingFieldDef =
    | { type: 'toggle'; key: string; name: string; desc: string; onChange?: (value: boolean) => void }
    | { type: 'dropdown'; key: string; name: string; desc: string; options: Record<string, string>; onChange?: (value: string) => void }
    | { type: 'text'; key: string; name: string; desc: string; placeholder?: string; disabled?: (settings: any) => boolean; onChange?: (value: string) => void }
    | { type: 'slider'; key: string; name: string; desc: string; min: number; max: number; step: number; onChange?: (value: number) => void }
    | { type: 'button'; name: string; desc: string; onClick: () => void };

export const SETTING_FIELDS: SettingFieldDef[] = [
    // ===== Security =====
    { type: 'toggle', key: 'safeMode', name: 'Safe Mode', desc: 'Default to safe model (Qwen3 8B) for everyday tasks' },
    { type: 'toggle', key: 'internetResearch', name: 'Internet Research', desc: 'Allow external sources in research (OFF by default)' },
    { type: 'toggle', key: 'vaultWriteApproval', name: 'Vault Write Approval', desc: 'Require approval before writing to vault' },
    { type: 'toggle', key: 'scriptExecutionApproval', name: 'Script Execution Approval', desc: 'Require approval before running scripts in sandbox' },
    { type: 'toggle', key: 'verifyExternalBeforeWrite', name: 'Verify External Before Write', desc: 'Verify external sources before writing to vault' },

    // ===== Trust Boundary =====
    { type: 'toggle', key: 'trustEnforcement', name: 'Enable Trust Enforcement', desc: 'Enforce trust levels on vault operations. Unverified AI output cannot silently overwrite trusted content.' },
    {
        type: 'dropdown', key: 'trustThreshold', name: 'Trust Threshold',
        desc: 'Minimum trust level required for automatic operations',
        options: {
            [TRUST_LEVELS.TRUSTED]: '🛡️ TRUSTED — User verified only',
            [TRUST_LEVELS.VERIFIED]: '✅ VERIFIED — Cross-checked with citations',
            [TRUST_LEVELS.INFERRED]: '🧠 INFERRED — Logically derived',
            [TRUST_LEVELS.UNVERIFIED]: '⚠️ UNVERIFIED — No checks',
        },
    },
    { type: 'toggle', key: 'trustDisplay', name: 'Show Trust Badges', desc: 'Display trust level badges in result modals and status bar' },

    // ===== Sandbox =====
    {
        type: 'dropdown', key: 'sandboxMode', name: 'Sandbox Mode',
        desc: 'Code execution isolation level',
        options: {
            'python': 'Python (subprocess isolation)',
            'node': 'Node (vm sandbox)',
            'docker': 'Docker (container isolation)',
        },
    },

    // ===== Models =====
    {
        type: 'dropdown', key: 'activeModel', name: 'Active Model',
        desc: 'Current main task model',
        options: (() => {
            const opts: Record<string, string> = {};
            for (const [key, m] of Object.entries(MODELS)) {
                if (key !== 'embedding') opts[m.id] = `${m.role} — ${m.id}`;
            }
            return opts;
        })(),
    },
    { type: 'toggle', key: 'keepEmbeddingsLoaded', name: 'Keep Embeddings Loaded', desc: 'Keep qwen3-embedding loaded in VRAM for instant RAG' },

    // ===== Context =====
    { type: 'slider', key: 'numCtx', name: 'Context Window (tokens)', desc: 'Default context size. Increase for long derivations/code.', min: 2048, max: 16384, step: 1024 },
    { type: 'slider', key: 'numCtxLong', name: 'Long Context Window (tokens)', desc: 'Used for derivations, research, and large code files', min: 4096, max: 32768, step: 2048 },

    // ===== Provenance =====
    { type: 'toggle', key: 'provenanceEnabled', name: 'Enable Provenance', desc: 'Record every claim, equation, and script with source, model, and timestamp' },

    // ===== Snapshots =====
    { type: 'toggle', key: 'autoSnapshotBeforeRisky', name: 'Auto-snapshot before risky ops', desc: 'Create a snapshot before vault writes and script runs' },
    { type: 'slider', key: 'snapshotMaxCount', name: 'Max snapshots', desc: 'Maximum number of snapshots to keep', min: 5, max: 50, step: 5 },

    // ===== Evidence-Gated Knowledge =====
    { type: 'toggle', key: 'evidenceGating', name: 'Enable Evidence Gating', desc: 'Block external factual claims without a source from entering the vault (Section 9)' },

    // ===== Research Mode =====
    { type: 'toggle', key: 'researchModeEnabled', name: 'Enable Research Mode', desc: 'Allow the 13-stage research pipeline (Section 10)' },
    {
        type: 'dropdown', key: 'searchProvider', name: 'Search Provider',
        desc: 'DuckDuckGo (zero-config) or SearXNG (user-specified endpoint — self-hosted OR third-party)',
        options: {
            'duckduckgo': 'DuckDuckGo (zero-config, no API key)',
            'searxng': 'SearXNG (user-specified endpoint)',
        },
    },
    { type: 'text', key: 'searxngUrl', name: 'SearXNG URL', desc: 'Your SearXNG instance endpoint — self-hosted (e.g. http://localhost:8080) OR third-party (e.g. https://searx.be). Must support /search?format=json. User is responsible for the endpoint.', placeholder: 'http://localhost:8080', disabled: (s) => s.searchProvider !== 'searxng' },
    { type: 'text', key: 'searxngCategories', name: 'SearXNG Categories', desc: 'SearXNG search categories (e.g. general, science)', placeholder: 'general' },
    { type: 'slider', key: 'maxSources', name: 'Max Sources', desc: 'Maximum number of sources to retrieve and analyze', min: 1, max: 20, step: 1 },
    { type: 'slider', key: 'maxSearchResults', name: 'Max Search Results', desc: 'Maximum search results per query', min: 3, max: 30, step: 1 },

    // ===== RAG =====
    { type: 'toggle', key: 'ragEnabled', name: 'Enable RAG', desc: 'Semantic search and context retrieval from vault' },

    // ===== Ollama =====
    { type: 'text', key: 'ollamaHost', name: 'Ollama Host', desc: 'Ollama API endpoint', placeholder: 'http://localhost:11434' },
];

/**
 * Generic factory: render a single setting field into the container.
 * Uses the plugin's settings object + saveSettings for persistence.
 */
export function addSettingField(containerEl: HTMLElement, plugin: any, def: SettingFieldDef): void {
    const { settings, saveSettings } = plugin;

    switch (def.type) {
        case 'toggle': {
            new Setting(containerEl)
                .setName(def.name)
                .setDesc(def.desc)
                .addToggle(t => t.setValue(settings[def.key]).onChange(async (v: boolean) => {
                    settings[def.key] = v;
                    if (def.onChange) def.onChange(v);
                    await saveSettings();
                }));
            break;
        }
        case 'dropdown': {
            new Setting(containerEl)
                .setName(def.name)
                .setDesc(def.desc)
                .addDropdown(d => {
                    for (const [value, label] of Object.entries(def.options)) {
                        d.addOption(value, label);
                    }
                    d.setValue(settings[def.key]);
                    d.onChange(async (v: string) => {
                        settings[def.key] = v;
                        if (def.onChange) def.onChange(v);
                        await saveSettings();
                    });
                });
            break;
        }
        case 'text': {
            new Setting(containerEl)
                .setName(def.name)
                .setDesc(def.desc)
                .addText(t => {
                    t.setPlaceholder(def.placeholder || '')
                        .setValue(settings[def.key] || '')
                        .setDisabled(def.disabled ? def.disabled(settings) : false)
                        .onChange(async (v: string) => {
                            settings[def.key] = v.trim();
                            if (def.onChange) def.onChange(v.trim());
                            await saveSettings();
                        });
                });
            break;
        }
        case 'slider': {
            new Setting(containerEl)
                .setName(def.name)
                .setDesc(def.desc)
                .addSlider(s => {
                    s.setLimits(def.min, def.max, def.step)
                        .setValue(settings[def.key] ?? def.min)
                        .setDynamicTooltip()
                        .onChange(async (v: number) => {
                            settings[def.key] = v;
                            if (def.onChange) def.onChange(v);
                            await saveSettings();
                        });
                });
            break;
        }
        case 'button': {
            new Setting(containerEl)
                .setName(def.name)
                .setDesc(def.desc)
                .addButton(b => b.setButtonText(def.name).onClick(def.onClick));
            break;
        }
    }
}

/**
 * Action buttons section (kept separate from data-driven fields
 * because their handlers need plugin engine hooks).
 */
export function addActionButtons(containerEl: HTMLElement, plugin: any): void {
    containerEl.createEl('h3', { text: '⚡ Actions' });

    new Setting(containerEl)
        .setName('Index vault for RAG')
        .setDesc('Embed all notes for semantic search')
        .addButton(b => b.setButtonText('Index Vault').onClick(() => plugin.rag.indexVault()));

    new Setting(containerEl)
        .setName('Check loaded models')
        .setDesc('View current VRAM usage')
        .addButton(b => b.setButtonText('Check VRAM').onClick(async () => {
            const models = await plugin.ollama.ps();
            if (models.length === 0) {
                new Notice('No models currently loaded');
                return;
            }
            new Notice(models.map((m: any) => `${m.name}: ${(m.size_vram / 1e9).toFixed(1)} GB`).join('\n'));
        }));

    new Setting(containerEl)
        .setName('Create snapshot')
        .setDesc('Backup vault to snapshot')
        .addButton(b => b.setButtonText('Snapshot Now').onClick(() => plugin.snapshotManager.createSnapshot('manual')));
}