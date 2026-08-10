// ============================================================
//  Modal Components
//
//  Single abstract BaseModal<T> with openAsync(): Promise<T>.
//  Replaces the 4 separate modal classes in main.ts with a
//  unified, promise-based API.
// ============================================================

import { Modal, App, Notice } from 'obsidian';
import { sanitizeFilename } from '../utils/strings';

/**
 * Base modal that resolves a Promise<T> when closed.
 * Subclasses call this.resolve(value) to complete.
 */
export abstract class BaseModal<T> extends Modal {
    protected resolve!: (value: T) => void;
    protected reject!: (reason?: unknown) => void;
    private _promise: Promise<T> | null = null;

    openAsync(): Promise<T> {
        if (!this._promise) {
            this._promise = new Promise<T>((resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;
            });
        }
        this.open();
        return this._promise;
    }

    protected complete(value: T): void {
        this.close();
        if (this.resolve) this.resolve(value);
    }

    protected fail(reason?: unknown): void {
        this.close();
        if (this.reject) this.reject(reason);
    }
}

export class InputModal extends BaseModal<string> {
    placeholder: string;

    constructor(app: App, placeholder: string) {
        super(app);
        this.placeholder = placeholder;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: this.placeholder });

        const textarea = contentEl.createEl('textarea', {
            attr: { rows: '6', style: 'width: 100%; font-family: monospace;' },
        });
        textarea.placeholder = 'Type here...';

        const btnRow = contentEl.createDiv({ cls: 'vs-btn-row' });
        const submitBtn = btnRow.createEl('button', { text: 'Submit', cls: 'mod-cta' });
        const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });

        submitBtn.addEventListener('click', () => {
            const value = textarea.value.trim();
            if (value) this.complete(value);
        });
        cancelBtn.addEventListener('click', () => this.complete(''));
        textarea.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                const value = textarea.value.trim();
                if (value) this.complete(value);
            }
        });
        textarea.focus();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class ResultModal extends BaseModal<void> {
    title: string;
    content: string;
    citations: string[];
    code: string | null;
    plugin: any;

    constructor(app: App, title: string, content: string, citations: string[] = [], code: string | null = null, plugin: any = null) {
        super(app);
        this.title = title;
        this.content = content;
        this.citations = citations || [];
        this.code = code;
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('vs-result-modal');
        contentEl.createEl('h2', { text: this.title });

        if (this.citations.length > 0) {
            const citeEl = contentEl.createDiv({ cls: 'vs-citations' });
            citeEl.createEl('strong', { text: 'Citations: ' });
            citeEl.createEl('span', { text: this.citations.join(', ') });
        }

        const pre = contentEl.createEl('pre', { cls: 'vs-result-content' });
        pre.setText(this.content);

        const btnRow = contentEl.createDiv({ cls: 'vs-btn-row' });

        if (this.code) {
            const copyBtn = btnRow.createEl('button', { text: '📋 Copy Code' });
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(this.code!);
                new Notice('Code copied to clipboard');
            });
        }

        const copyBtn = btnRow.createEl('button', { text: '📋 Copy Result' });
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.content);
            new Notice('Result copied to clipboard');
        });

        const saveBtn = btnRow.createEl('button', { text: '💾 Save to Note' });
        saveBtn.addEventListener('click', async () => {
            const safeTitle = sanitizeFilename(this.title);
            const filePath = `Vault Scholar/${safeTitle}.md`;
            await this.plugin.app.vault.createFolder('Vault Scholar').catch(() => {});
            await this.plugin.app.vault.create(filePath, this.content);
            new Notice(`✅ Saved to ${filePath}`);
            this.close();
        });

        const closeBtn = btnRow.createEl('button', { text: 'Close' });
        closeBtn.addEventListener('click', () => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class MainModal extends BaseModal<void> {
    plugin: any;

    constructor(app: App, plugin: any) {
        super(app);
        this.plugin = plugin;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('vs-main-modal');
        contentEl.createEl('h2', { text: '🦉 Vault Scholar' });

        const status = contentEl.createDiv({ cls: 'vs-status' });
        status.createEl('p', { text: `Active Model: ${this.plugin.modelManager.activeModel}` });
        status.createEl('p', { text: `Sandbox: ${this.plugin.settings.sandboxMode.toUpperCase()}` });
        status.createEl('p', { text: `Internet Research: ${this.plugin.settings.internetResearch ? 'ON' : 'OFF'}` });
        status.createEl('p', { text: `Vault Write Approval: ${this.plugin.settings.vaultWriteApproval ? 'REQUIRED' : 'AUTO'}` });
        status.createEl('p', { text: `Script Execution Approval: ${this.plugin.settings.scriptExecutionApproval ? 'REQUIRED' : 'AUTO'}` });
        status.createEl('p', { text: `Trust Boundary: ${this.plugin.settings.trustEnforcement ? '🛡️ ACTIVE' : '⚠️ DISABLED'} (${this.plugin.settings.trustThreshold})` });

        const actions = contentEl.createDiv({ cls: 'vs-actions' });
        const actionsList: Array<[string, string]> = [
            ['🔬 Research', 'research'],
            ['➗ Derive Math', 'derive-math'],
            ['🔍 Analyze Patterns', 'analyze-patterns'],
            ['💻 Audit Code', 'audit-code'],
            ['🎯 Sim Spec', 'generate-sim-spec'],
            ['📝 Build Sim Script', 'build-sim-script'],
            ['🏃 Run in Sandbox', 'run-script-sandbox'],
            ['🔎 Semantic Search', 'semantic-search'],
            ['📸 Snapshot', 'create-snapshot'],
            ['♻️ Restore', 'restore-snapshot'],
            ['📜 Provenance', 'view-provenance'],
            ['🛡️ Trust Status', 'view-trust'],
            ['🔒 Trust Audit', 'trust-audit'],
            ['🔬 Research Mode', 'research-mode'],
            ['🛡️ Evidence Gate', 'gate-content'],
            ['🧠 Switch Model', 'switch-model'],
        ];
        for (const [label, cmdId] of actionsList) {
            const btn = actions.createEl('button', { text: label, cls: 'vs-action-btn' });
            btn.addEventListener('click', () => {
                this.close();
                (this.app as any).commands.executeCommandById(`vault-scholar:${cmdId}`);
            });
        }

        const closeBtn = contentEl.createEl('button', { text: 'Close', cls: 'vs-close-btn' });
        closeBtn.addEventListener('click', () => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}