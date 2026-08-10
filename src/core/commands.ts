// ============================================================
//  Data-Driven Command Definitions
//
//  Replaces the 20+ repetitive `addCommand` blocks in main.ts
//  with a single COMMANDS array, looped in onload().
//  Every command ID matches the original to preserve user
//  command palette bindings.
// ============================================================

import { MarkdownView, Notice } from 'obsidian';
import { TrustClassifier, TRUST_LEVELS, CONTENT_SOURCES } from '../lib/trust';
import { EvidenceGate } from '../lib/evidence';
import { MODELS } from './settings';

/**
 * Minimal plugin interface — avoids circular dependency with main.ts.
 * main.ts's VaultScholarPlugin satisfies this structurally.
 */
export interface PluginRef {
    app: any;
    settings: any;
    statusBarEl: any;
    ollama: any;
    modelManager: any;
    taskRouter: any;
    provenance: any;
    snapshotManager: any;
    rag: any;
    sandbox: any;
    codeAuditor: any;
    mathPhysics: any;
    simulation: any;
    research: any;
    researchMode: any;
    trustBoundary: any;
    workingMemory: string;
    updateStatusBar(): void;
    openMainModal(): void;
    promptForInput(placeholder: string, callback: (value: string) => Promise<void> | void): void;
    showResultModal(title: string, content: string, citations?: string[], code?: string | null): void;
    confirmModal(title: string, message: string): Promise<boolean>;
    trustAudit(): Promise<void>;
}

export interface CommandDef {
    id: string;
    name: string;
    callback: (plugin: PluginRef) => void | Promise<void>;
}

export const COMMANDS: CommandDef[] = [
    {
        id: 'open-main',
        name: 'Open Vault Scholar',
        callback: (p) => p.openMainModal(),
    },
    {
        id: 'research',
        name: 'Research with citations',
        callback: (p) => p.promptForInput('🔬 Research topic:', async (topic) => {
            const { result, citations } = await p.research.research(topic);
            p.showResultModal('Research Results', result, citations);
        }),
    },
    {
        id: 'research-mode',
        name: 'Research this (Research Mode)',
        callback: (p) => p.promptForInput('🔎 Research this (Research Mode):', async (question) => {
            if (!p.settings.internetResearch) {
                new Notice('⚠️ Internet Research is OFF. Enable it in Settings → Vault Scholar.');
                return;
            }
            if (!p.settings.researchModeEnabled) {
                new Notice('⚠️ Research Mode is disabled in settings.');
                return;
            }
            const stageNames: string[] = [];
            const state = await p.researchMode.research(question, {
                onStage: (name: string) => { stageNames.push(name); new Notice('🔬 Stage: ' + name); },
            });
            await p.provenance.record({
                type: 'research_mode',
                content: state.answer || state.vaultProposal,
                contentSource: CONTENT_SOURCES.EXTERNAL_SOURCED,
                trustLevel: TRUST_LEVELS.VERIFIED,
                citations: state.citations,
                verificationMethod: 'research_mode_pipeline',
                metadata: { question, stages: stageNames, contradictions: state.contradictions.length },
            });
            p.showResultModal('Research Mode Results', state.vaultProposal, state.citations);
        }),
    },
    {
        id: 'gate-content',
        name: 'Gate active note with Evidence-Gated Knowledge',
        callback: (p) => {
            const view = p.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) { new Notice('❌ No active note'); return; }
            const report = EvidenceGate.validateNote(view.editor.getValue());
            const text =
                '🛡️ EVIDENCE GATE REPORT\n' +
                '=========================\n\n' +
                'Valid: ' + (report.valid ? '✅ YES' : '❌ NO') + '\n' +
                'Total claims: ' + report.totalClaims + '\n' +
                'Allowed: ' + report.allowed + '\n' +
                'Blocked: ' + report.blocked + '\n\n' +
                'Origins:\n' +
                Object.entries(report.summary.origins || {}).map(([k, v]) => '  ' + k + ': ' + v).join('\n') +
                '\n\nTrust levels:\n' +
                Object.entries(report.summary.trust || {}).map(([k, v]) => '  ' + k + ': ' + v).join('\n') +
                (report.issues.length > 0
                    ? '\n\n🚫 Blocked claims:\n' + report.issues.map(i => '- ' + i.text + '\n  → ' + i.reason).join('\n')
                    : '');
            p.showResultModal('Evidence Gate Report', text);
        },
    },
    {
        id: 'lint-evidence',
        name: 'Lint vault for evidence',
        callback: async (p) => {
            const files = p.app.vault.getMarkdownFiles();
            let total = 0, blocked = 0, ok = 0;
            const details: string[] = [];
            for (const file of files) {
                const content = await p.app.vault.cachedRead(file);
                const report = EvidenceGate.validateNote(content);
                total += report.totalClaims;
                blocked += report.blocked;
                if (report.blocked > 0) {
                    details.push(file.path + ': ' + report.blocked + ' blocked');
                } else {
                    ok++;
                }
            }
            const text =
                '🔍 VAULT EVIDENCE LINT\n' +
                '======================\n\n' +
                'Files: ' + files.length + '\n' +
                'Total claims: ' + total + '\n' +
                'Blocked: ' + blocked + '\n' +
                'Files with issues: ' + details.length + '\n\n' +
                (details.length > 0 ? details.join('\n') : '✅ No unsourced external claims detected');
            p.showResultModal('Vault Evidence Lint', text);
        },
    },
    {
        id: 'format-simulation',
        name: 'Format simulation result header',
        callback: (p) => {
            const view = p.app.workspace.getActiveViewOfType(MarkdownView);
            const header = EvidenceGate.simulationHeader(
                'Unspecified model',
                ['(none stated)'],
                '(none stated)',
                'Unspecified'
            );
            if (!view) {
                p.showResultModal('Simulation Header Template', header);
                new Notice('💡 No active note — header copied to result modal');
                return;
            }
            const editor = view.editor;
            const doc = editor.getDoc();
            const cursor = doc.getCursor();
            doc.replaceRange(header + '\n\n', cursor);
            new Notice('✅ Simulation header inserted');
        },
    },
    {
        id: 'derive-math',
        name: 'Derive math/physics step-by-step',
        callback: (p) => p.promptForInput('➗ Problem to derive:', async (problem) => {
            const result = await p.mathPhysics.derive(problem);
            p.showResultModal('Derivation', result);
        }),
    },
    {
        id: 'analyze-patterns',
        name: 'Analyze patterns/symmetries/invariants',
        callback: (p) => p.promptForInput('🔍 Input to analyze:', async (input) => {
            const result = await p.mathPhysics.analyzePatterns(input);
            p.showResultModal('Pattern Analysis', result);
        }),
    },
    {
        id: 'audit-code',
        name: 'Audit code for vulnerabilities',
        callback: (p) => p.promptForInput('💻 Code to audit (paste code):', async (code) => {
            const result = await p.codeAuditor.audit(code);
            const staticText = result.staticFindings.length > 0
                ? result.staticFindings.map((f: any) => `- [${f.severity.toUpperCase()}] ${f.name}: ${f.match}`).join('\n')
                : '- No static pattern matches';
            p.showResultModal('Code Audit', `STATIC ANALYSIS:\n${staticText}\n\nAI ANALYSIS:\n${result.aiAnalysis}`);
        }),
    },
    {
        id: 'generate-sim-spec',
        name: 'Generate simulation specification',
        callback: (p) => p.promptForInput('🎯 Simulation description:', async (desc) => {
            const spec = await p.simulation.generateSpec(desc);
            p.showResultModal('Simulation Specification', spec);
        }),
    },
    {
        id: 'build-sim-script',
        name: 'Build simulation script from spec',
        callback: (p) => p.promptForInput('📝 Paste simulation spec:', async (spec) => {
            const { script, full } = await p.simulation.buildScript(spec);
            p.showResultModal('Simulation Script', full, [], script);
        }),
    },
    {
        id: 'run-script-sandbox',
        name: 'Run script in sandbox',
        callback: (p) => p.promptForInput('🏃 Paste script to run in sandbox:', async (code) => {
            if (p.settings.scriptExecutionApproval) {
                const approved = await p.confirmModal('Run in sandbox?', 'This will execute the script in an isolated sandbox. Continue?');
                if (!approved) { new Notice('❌ Script execution cancelled'); return; }
            }
            const result = await p.sandbox.run(code);
            p.showResultModal('Sandbox Output', `EXIT CODE: ${result.exitCode ?? 'N/A'}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`);
        }),
    },
    {
        id: 'semantic-search',
        name: 'Semantic search vault',
        callback: (p) => p.promptForInput('🔎 Search query:', async (query) => {
            const results = await p.rag.search(query);
            if (results.length === 0) {
                new Notice('No results found. Try indexing the vault first.');
                return;
            }
            const text = results.map((r: any, i: number) =>
                `### ${i + 1}. [${r.chunk.note}] (${(r.score * 100).toFixed(1)}%)\n${r.chunk.text}`
            ).join('\n\n');
            p.showResultModal('Semantic Search Results', text);
        }),
    },
    {
        id: 'index-vault',
        name: 'Index vault for semantic search',
        callback: (p) => p.rag.indexVault(),
    },
    {
        id: 'create-snapshot',
        name: 'Create vault snapshot',
        callback: (p) => p.promptForInput('📸 Snapshot label:', async (label) => {
            await p.snapshotManager.createSnapshot(label || 'manual');
        }),
    },
    {
        id: 'list-snapshots',
        name: 'List snapshots',
        callback: (p) => {
            const snapshots = p.snapshotManager.listSnapshots();
            if (snapshots.length === 0) {
                new Notice('No snapshots yet');
                return;
            }
            p.showResultModal('Snapshots', snapshots.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n'));
        },
    },
    {
        id: 'restore-snapshot',
        name: 'Restore snapshot',
        callback: (p) => p.promptForInput('♻️ Snapshot name to restore:', async (name) => {
            if (p.settings.vaultWriteApproval) {
                const approved = await p.confirmModal('Restore snapshot?', `This will overwrite vault files with snapshot "${name}". Continue?`);
                if (!approved) { new Notice('❌ Restore cancelled'); return; }
            }
            await p.snapshotManager.restoreSnapshot(name);
        }),
    },
    {
        id: 'view-provenance',
        name: 'View provenance records',
        callback: (p) => {
            p.provenance.getAll().then((records: any[]) => {
                if (records.length === 0) {
                    new Notice('No provenance records yet');
                    return;
                }
                const text = records.slice(-20).reverse().map((r: any) =>
                    `### ${r.timestamp}\n**Type:** ${r.type} | **Model:** ${r.model} | **Verified:** ${r.verified}\n${truncate(r.content, 300)}`
                ).join('\n\n---\n\n');
                p.showResultModal('Provenance Records', text);
            });
        },
    },
    {
        id: 'switch-model',
        name: 'Switch active model',
        callback: (p) => {
            p.promptForInput('🧠 Switch model (safe/deep/math/coder):', async (choice) => {
                const key = choice.trim().toLowerCase();
                if (MODELS[key as keyof typeof MODELS]) {
                    await p.modelManager.switchTo(MODELS[key as keyof typeof MODELS].id);
                } else {
                    new Notice('Invalid model key. Use: safe, deep, math, coder');
                }
            });
        },
    },
    {
        id: 'check-vram',
        name: 'Check loaded models (VRAM)',
        callback: async (p) => {
            const models = await p.ollama.ps();
            if (models.length === 0) {
                new Notice('No models currently loaded in VRAM');
                return;
            }
            const text = models.map((m: any) => `- ${m.name} (${(m.size_vram / 1e9).toFixed(1)} GB VRAM)`).join('\n');
            p.showResultModal('Loaded Models (VRAM)', text);
        },
    },
    {
        id: 'classify-note',
        name: 'Classify current note trust level',
        callback: (p) => {
            const view = p.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) {
                new Notice('❌ No active note open');
                return;
            }
            const content = view.editor.getValue();
            const record = TrustClassifier.classify(content, {
                source: CONTENT_SOURCES.USER_CREATED,
                trustLevel: TRUST_LEVELS.TRUSTED,
                verifiedBy: 'user',
            });
            new Notice(`🛡️ Note classified: ${record.trustLevel} (${record.contentSource})`);
            p.showResultModal('Trust Classification',
                `TRUST LEVEL: ${record.trustLevel}\n` +
                `CONTENT SOURCE: ${record.contentSource}\n` +
                `CONFIDENCE: ${record.confidence}%\n` +
                `VERIFIED: ${record.verified}\n` +
                `VERIFIED BY: ${record.verifiedBy}\n` +
                `HASH: ${record.hash.slice(0, 16)}…`
            );
        },
    },
    {
        id: 'view-trust',
        name: 'View trust boundary status',
        callback: (p) => {
            const trail = p.trustBoundary.auditTrail();
            const status =
                `TRUST BOUNDARY: ${p.settings.trustEnforcement ? 'ACTIVE 🛡️' : 'DISABLED'}\n` +
                `THRESHOLD: ${p.settings.trustThreshold}\n\n` +
                `DECISIONS LOGGED: ${trail.length}\n\n` +
                (trail.length > 0 ? trail.slice(-10).reverse().map((d: any) =>
                    `${d.timestamp} — ${d.operation}: ${d.allowed ? '✅ ALLOWED' : '🚫 BLOCKED'} ` +
                    `(${d.level} → required ${d.required})`
                ).join('\n') : 'No trust decisions yet.');
            p.showResultModal('Trust Boundary Status', status);
        },
    },
    {
        id: 'trust-audit',
        name: 'Run trust audit across vault',
        callback: (p) => p.trustAudit(),
    },
    {
        id: 'write-to-note',
        name: 'Write result to a new note',
        callback: (p) => p.promptForInput('📝 Note title:', async (title) => {
            if (p.settings.vaultWriteApproval) {
                const approved = await p.confirmModal('Create note?', `Create note "${title}" in vault?`);
                if (!approved) { new Notice('❌ Note creation cancelled'); return; }
            }
            p.promptForInput('📝 Note content:', async (content) => {
                const safeTitle = sanitizeFilename(title);
                const filePath = `Vault Scholar/${safeTitle}.md`;
                await p.app.vault.createFolder('Vault Scholar').catch(() => {});
                await p.app.vault.create(filePath, content);
                new Notice(`✅ Note created: ${filePath}`);
            });
        }),
    },
];

// Local utilities (kept here to avoid importing from monolith)
function truncate(str: string, max: number): string {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
}

function sanitizeFilename(name: string): string {
    return String(name || '').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
}