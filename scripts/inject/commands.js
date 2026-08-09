// Commands block injected before derive-math
const anchor1 = "id: 'derive-math',";

const commandsBlock = `        this.addCommand({
            id: 'research-mode',
            name: 'Research this (Research Mode)',
            callback: () => this.promptForInput('🔎 Research this (Research Mode):', async (question) => {
                if (!this.settings.internetResearch) {
                    new Notice('⚠️ Internet Research is OFF. Enable it in Settings → Vault Scholar.');
                    return;
                }
                if (!this.settings.researchModeEnabled) {
                    new Notice('⚠️ Research Mode is disabled in settings.');
                    return;
                }
                const stageNames = [];
                const state = await this.researchMode.research(question, {
                    onStage: (name) => { stageNames.push(name); new Notice('🔬 Stage: ' + name); },
                });
                await this.provenance.record({
                    type: 'research_mode',
                    content: state.answer || state.vaultProposal,
                    contentSource: CONTENT_SOURCES.EXTERNAL_SOURCED,
                    trustLevel: TRUST_LEVELS.VERIFIED,
                    citations: state.citations,
                    verificationMethod: 'research_mode_pipeline',
                    metadata: { question, stages: stageNames, contradictions: state.contradictions.length },
                });
                this.showResultModal('Research Mode Results', state.vaultProposal, state.citations);
            }),
        });

        this.addCommand({
            id: 'gate-content',
            name: 'Gate active note with Evidence-Gated Knowledge',
            callback: () => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) { new Notice('❌ No active note'); return; }
                const report = EvidenceGate.validateNote(view.editor.getValue());
                const text =
                    '🛡️ EVIDENCE GATE REPORT\\n' +
                    '=========================\\n\\n' +
                    'Valid: ' + (report.valid ? '✅ YES' : '❌ NO') + '\\n' +
                    'Total claims: ' + report.totalClaims + '\\n' +
                    'Allowed: ' + report.allowed + '\\n' +
                    'Blocked: ' + report.blocked + '\\n\\n' +
                    'Origins:\\n' +
                    Object.entries(report.summary.origins || {}).map(([k, v]) => '  ' + k + ': ' + v).join('\\n') +
                    '\\n\\nTrust levels:\\n' +
                    Object.entries(report.summary.trust || {}).map(([k, v]) => '  ' + k + ': ' + v).join('\\n') +
                    (report.issues.length > 0
                        ? '\\n\\n🚫 Blocked claims:\\n' + report.issues.map(i => '- ' + i.text + '\\n  → ' + i.reason).join('\\n')
                        : '');
                this.showResultModal('Evidence Gate Report', text);
            },
        });

        this.addCommand({
            id: 'lint-evidence',
            name: 'Lint vault for evidence',
            callback: async () => {
                const files = this.app.vault.getMarkdownFiles();
                let total = 0, blocked = 0, ok = 0;
                const details = [];
                for (const file of files) {
                    const content = await this.app.vault.cachedRead(file);
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
                    '🔍 VAULT EVIDENCE LINT\\n' +
                    '======================\\n\\n' +
                    'Files: ' + files.length + '\\n' +
                    'Total claims: ' + total + '\\n' +
                    'Blocked: ' + blocked + '\\n' +
                    'Files with issues: ' + details.length + '\\n\\n' +
                    (details.length > 0 ? details.join('\\n') : '✅ No unsourced external claims detected');
                this.showResultModal('Vault Evidence Lint', text);
            },
        });

        this.addCommand({
            id: 'format-simulation',
            name: 'Format simulation result header',
            callback: () => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                const header = EvidenceGate.simulationHeader(
                    'Unspecified model',
                    ['(none stated)'],
                    '(none stated)',
                    'Unspecified'
                );
                if (!view) {
                    this.showResultModal('Simulation Header Template', header);
                    new Notice('💡 No active note — header copied to result modal');
                    return;
                }
                const editor = view.editor;
                const doc = editor.getDoc();
                const cursor = doc.getCursor();
                doc.replaceRange(header + '\\n\\n', cursor);
                new Notice('✅ Simulation header inserted');
            },
        });

`;

module.exports = { commandsBlock, anchor1 };