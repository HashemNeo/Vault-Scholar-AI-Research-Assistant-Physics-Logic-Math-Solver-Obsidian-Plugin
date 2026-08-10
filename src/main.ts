// ============================================================
//  Vault Scholar — Secure Research, Math/Physics, Code &
//  Simulation Engine for Obsidian
//
//  Modular TypeScript + esbuild architecture.
//  Engines live in src/core/, libs in src/lib/, UI in src/ui/.
// ============================================================

import { Plugin, PluginSettingTab, Setting, Notice, Modal, App, MarkdownView, requestUrl, Platform } from 'obsidian';
import { exec, execFile, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import vm from 'vm';

import { TRUST_LEVELS, CONTENT_SOURCES, TrustClassifier, TrustBoundary, TrustRecord, TrustDecision } from './lib/trust';
import { EvidenceGate, CLAIM_ORIGIN, EVIDENCE_MARKERS } from './lib/evidence';
import { ResearchMode, SourceClassifier, SOURCE_TRUST } from './lib/research';
import { parseSettings, MODELS, OLLAMA_HOST, PLUGIN_ID, Settings } from './core/settings';
import { COMMANDS } from './core/commands';
import { InputModal, ResultModal, MainModal } from './ui/modals';
import { addSettingField, SETTING_FIELDS, addActionButtons } from './ui/components';
import { truncate, sanitizeFilename } from './utils/strings';

// ============================================================
//  OLLAMA CLIENT
// ============================================================

interface OllamaRequestOptions {
    numCtx?: number;
    temperature?: number;
    keepAlive?: string;
}

class OllamaClient {
    plugin: VaultScholarPlugin;
    host: string;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
        this.host = plugin.settings.ollamaHost;
    }

    async request(endpoint: string, body: Record<string, unknown>): Promise<any> {
        const url = `${this.host}${endpoint}`;
        const res = await requestUrl({
            url,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            throw: false,
        });
        if (res.status >= 400) {
            throw new Error(`Ollama error ${res.status}: ${res.text}`);
        }
        return res.json;
    }

    async chat(model: string, messages: Array<{ role: string; content: string }>, opts: OllamaRequestOptions = {}): Promise<string> {
        const body: Record<string, unknown> = {
            model,
            messages,
            stream: false,
            options: {
                num_ctx: opts.numCtx || this.plugin.settings.numCtx,
                temperature: opts.temperature ?? 0.7,
            },
        };
        if (opts.keepAlive) body.keep_alive = opts.keepAlive;
        const res = await this.request('/api/chat', body);
        return res.message ? res.message.content : '';
    }

    async generate(model: string, prompt: string, opts: OllamaRequestOptions = {}): Promise<string> {
        const body: Record<string, unknown> = {
            model,
            prompt,
            stream: false,
            options: {
                num_ctx: opts.numCtx || this.plugin.settings.numCtx,
                temperature: opts.temperature ?? 0.7,
            },
        };
        if (opts.keepAlive) body.keep_alive = opts.keepAlive;
        const res = await this.request('/api/generate', body);
        return res.response || '';
    }

    async embed(texts: string | string[]): Promise<number[][]> {
        const res = await this.request('/api/embed', {
            model: MODELS.embedding.id,
            input: Array.isArray(texts) ? texts : [texts],
        });
        return res.embeddings || [];
    }

    async listModels(): Promise<any[]> {
        const res = await this.request('/api/tags', {});
        return res.models || [];
    }

    async ps(): Promise<any[]> {
        const res = await this.request('/api/ps', {});
        return res.models || [];
    }

    async show(model: string): Promise<any> {
        const res = await this.request('/api/show', { model });
        return res;
    }

    async pull(model: string): Promise<any> {
        const res = await this.request('/api/pull', { model, stream: false });
        return res;
    }

    async unload(model: string): Promise<void> {
        try {
            await this.request('/api/generate', { model, keep_alive: 0, prompt: '' });
        } catch { /* ignore */ }
    }
}

// ============================================================
//  MODEL MANAGER (VRAM-aware)
// ============================================================

class ModelManager {
    plugin: VaultScholarPlugin;
    client: OllamaClient;
    activeModel: string;
    semanticMemory: string;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
        this.client = plugin.ollama;
        this.activeModel = plugin.settings.activeModel;
        this.semanticMemory = '';
    }

    async switchTo(modelId: string, opts: { force?: boolean } = {}): Promise<void> {
        if (modelId === this.activeModel && !opts.force) return;

        // Save semantic working memory
        this.semanticMemory = this.plugin.workingMemory || '';

        // Unload current model
        await this.client.unload(this.activeModel);

        // Load new model (warm up)
        await this.client.generate(modelId, 'Hello', { keepAlive: '5m' });

        this.activeModel = modelId;
        this.plugin.settings.activeModel = modelId;
        await this.plugin.saveSettings();
        this.plugin.updateStatusBar();
        new Notice(`🧠 Model switched to: ${modelId}`);
    }

    async ensureEmbeddingsLoaded(): Promise<void> {
        if (!this.plugin.settings.keepEmbeddingsLoaded) return;
        try {
            await this.client.embed(['warmup']);
        } catch { /* ignore */ }
    }
}

// ============================================================
//  TASK ROUTER
// ============================================================

class TaskRouter {
    plugin: VaultScholarPlugin;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
    }

    classify(input: string): string {
        const text = input.toLowerCase();
        const rules: Array<{ model: string; pattern: RegExp }> = [
            { model: 'math',    pattern: /(derive|derivation|integral|derivative|equation|solve|proof|theorem|calculus|algebra|physics|symmetry|invariant|lagrangian|hamiltonian|schr|maxwell|newton|fourier|laplace|eigen|tensor|vector field|differential)/ },
            { model: 'coder',   pattern: /(code|script|debug|vulnerab|security|exploit|function|class|api|syntax|error|bug|simulation script|python|javascript|typescript|sql|regex|audit)/ },
            { model: 'deep',    pattern: /(research|synthesize|analyze|compare|evaluate|critique|literature|paper|theory|concept|explain in depth|reason)/ },
        ];
        for (const rule of rules) {
            if (rule.pattern.test(text)) return rule.model;
        }
        return 'safe';
    }

    async route(input: string, opts: { model?: string } = {}): Promise<{ target: string; modelId: string }> {
        const target = opts.model || this.classify(input);
        const modelId = MODELS[target as keyof typeof MODELS] ? MODELS[target as keyof typeof MODELS].id : target;
        await this.plugin.modelManager.switchTo(modelId);
        return { target, modelId };
    }
}

// ============================================================
//  PROVENANCE ENGINE
// ============================================================

interface ProvenanceEntry {
    type?: string;
    content?: string;
    sourceNote?: string | null;
    model?: string;
    citations?: string[];
    verified?: boolean;
    verificationMethod?: string | null;
    trustLevel?: string;
    contentSource?: string;
    confidence?: number;
    verifiedBy?: string;
    metadata?: Record<string, unknown>;
}

class ProvenanceEngine {
    plugin: VaultScholarPlugin;
    dir: string;
    logFile: string;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
        this.dir = path.join(plugin.assetsDir, 'provenance');
        this.logFile = path.join(this.dir, 'provenance.jsonl');
    }

    init(): void {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    }

    async record(entry: ProvenanceEntry): Promise<Record<string, unknown>> {
        if (!this.plugin.settings.provenanceEnabled) return {};
        this.init();
        // Classify trust for this record
        const trust = TrustClassifier.classify(entry.content || '', {
            source: (entry.contentSource as any) || CONTENT_SOURCES.AI_GENERATED,
            trustLevel: entry.trustLevel as any,
            verifiedBy: entry.verifiedBy,
            confidence: entry.confidence,
            citations: entry.citations || [],
            model: entry.model || this.plugin.modelManager.activeModel,
            metadata: entry.metadata || {},
        });
        const record = {
            id: hashString(nowISO() + Math.random()),
            timestamp: nowISO(),
            type: entry.type || 'claim',
            content: entry.content || '',
            sourceNote: entry.sourceNote || null,
            model: entry.model || this.plugin.modelManager.activeModel,
            citations: entry.citations || [],
            verified: entry.verified ?? trust.verified,
            verificationMethod: entry.verificationMethod || null,
            hash: hashString(entry.content || ''),
            metadata: entry.metadata || {},
            // Trust Boundary metadata
            trustLevel: trust.trustLevel,
            contentSource: trust.contentSource,
            confidence: trust.confidence,
            verifiedBy: trust.verifiedBy,
        };
        fs.appendFileSync(this.logFile, JSON.stringify(record) + '\n');
        return record;
    }

    async getAll(): Promise<any[]> {
        if (!fs.existsSync(this.logFile)) return [];
        const lines = fs.readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean);
        return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }

    async getByType(type: string): Promise<any[]> {
        const all = await this.getAll();
        return all.filter(r => r.type === type);
    }
}

// ============================================================
//  SNAPSHOT MANAGER
// ============================================================

class SnapshotManager {
    plugin: VaultScholarPlugin;
    dir: string;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
        this.dir = path.join(plugin.assetsDir, 'snapshots');
    }

    init(): void {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    }

    async createSnapshot(label = 'manual'): Promise<string> {
        this.init();
        const vaultPath = (this.plugin.app.vault.adapter as any).getBasePath();
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const name = `${ts}_${sanitizeFilename(label)}`;
        const dest = path.join(this.dir, name);
        fs.mkdirSync(dest, { recursive: true });

        const exclude = new Set(['.obsidian', '.trash', '.git', '.copilot-index', '.megaignore']);
        const copyRecursive = (src: string, dst: string): void => {
            const entries = fs.readdirSync(src, { withFileTypes: true });
            for (const entry of entries) {
                if (exclude.has(entry.name)) continue;
                const srcPath = path.join(src, entry.name);
                const dstPath = path.join(dst, entry.name);
                if (entry.isDirectory()) {
                    fs.mkdirSync(dstPath, { recursive: true });
                    copyRecursive(srcPath, dstPath);
                } else {
                    fs.copyFileSync(srcPath, dstPath);
                }
            }
        };
        copyRecursive(vaultPath, dest);

        // Prune old snapshots
        const snapshots = fs.readdirSync(this.dir).filter(f => fs.statSync(path.join(this.dir, f)).isDirectory());
        const max = this.plugin.settings.snapshotMaxCount;
        if (snapshots.length > max) {
            const toRemove = snapshots.sort().slice(0, snapshots.length - max);
            for (const s of toRemove) {
                fs.rmSync(path.join(this.dir, s), { recursive: true, force: true });
            }
        }

        new Notice(`📸 Snapshot created: ${name}`);
        return name;
    }

    listSnapshots(): string[] {
        if (!fs.existsSync(this.dir)) return [];
        return fs.readdirSync(this.dir).filter(f => fs.statSync(path.join(this.dir, f)).isDirectory()).sort().reverse();
    }

    async restoreSnapshot(name: string): Promise<boolean> {
        const src = path.join(this.dir, name);
        if (!fs.existsSync(src)) {
            new Notice('❌ Snapshot not found');
            return false;
        }
        const vaultPath = (this.plugin.app.vault.adapter as any).getBasePath();
        const exclude = new Set(['.obsidian', '.trash', '.git', '.copilot-index']);
        const copyRecursive = (srcDir: string, dstDir: string): void => {
            const entries = fs.readdirSync(srcDir, { withFileTypes: true });
            for (const entry of entries) {
                if (exclude.has(entry.name)) continue;
                const srcPath = path.join(srcDir, entry.name);
                const dstPath = path.join(dstDir, entry.name);
                if (entry.isDirectory()) {
                    fs.mkdirSync(dstPath, { recursive: true });
                    copyRecursive(srcPath, dstPath);
                } else {
                    fs.copyFileSync(srcPath, dstPath);
                }
            }
        };
        copyRecursive(src, vaultPath);
        new Notice(`♻️ Restored snapshot: ${name}`);
        return true;
    }
}

// ============================================================
//  RAG ENGINE
// ============================================================

interface RAGIndex {
    chunks: Array<{ text: string; note: string; hash: string }>;
    embeddings: number[][];
}

class RAGEngine {
    plugin: VaultScholarPlugin;
    dir: string;
    indexFile: string;
    index: RAGIndex;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
        this.dir = path.join(plugin.assetsDir, 'vectorstore');
        this.indexFile = path.join(this.dir, 'index.json');
        this.index = { chunks: [], embeddings: [] };
    }

    init(): void {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
        if (fs.existsSync(this.indexFile)) {
            try {
                this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
            } catch { this.index = { chunks: [], embeddings: [] }; }
        }
    }

    save(): void {
        fs.writeFileSync(this.indexFile, JSON.stringify(this.index));
    }

    async indexNote(note: { path: string; content: string }): Promise<void> {
        if (!this.plugin.settings.ragEnabled) return;
        this.init();
        const content = note.content || '';
        if (content.length < 50) return;

        // Chunk by paragraphs (~500 chars)
        const chunks: string[] = [];
        const paragraphs = content.split(/\n\s*\n/);
        let current = '';
        for (const p of paragraphs) {
            if ((current + p).length > 500) {
                if (current) chunks.push(current.trim());
                current = p;
            } else {
                current += '\n\n' + p;
            }
        }
        if (current) chunks.push(current.trim());

        const embeddings = await this.plugin.ollama.embed(chunks);
        for (let i = 0; i < chunks.length; i++) {
            this.index.chunks.push({
                text: chunks[i],
                note: note.path,
                hash: hashString(chunks[i]),
            });
            this.index.embeddings.push(embeddings[i]);
        }
        this.save();
    }

    async indexVault(): Promise<void> {
        const files = this.plugin.app.vault.getMarkdownFiles();
        for (const file of files) {
            const content = await this.plugin.app.vault.cachedRead(file);
            await this.indexNote({ path: file.path, content });
        }
        new Notice(`🔎 Indexed ${files.length} notes`);
    }

    cosineSim(a: number[], b: number[]): number {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        if (na === 0 || nb === 0) return 0;
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    async search(query: string, topK = 5): Promise<Array<{ score: number; chunk: { text: string; note: string; hash: string } }>> {
        this.init();
        if (this.index.embeddings.length === 0) return [];
        const [qEmbed] = await this.plugin.ollama.embed([query]);
        const scored = this.index.embeddings.map((emb, i) => ({
            score: this.cosineSim(qEmbed, emb),
            chunk: this.index.chunks[i],
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK).filter(r => r.score > 0.3);
    }
}

// ============================================================
//  SANDBOX MANAGER
// ============================================================

interface SandboxResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode?: number | null;
    timedOut?: boolean;
    result?: string;
}

class SandboxManager {
    plugin: VaultScholarPlugin;
    dir: string;
    tempDir: string;
    _nodeOutput: string;
    _nodeError: string;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
        this.dir = path.join(plugin.assetsDir, 'sandbox');
        this.tempDir = path.join(this.dir, 'tmp');
        this._nodeOutput = '';
        this._nodeError = '';
    }

    init(): void {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
        if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
    }

    async runPython(code: string, opts: { timeout?: number } = {}): Promise<SandboxResult> {
        this.init();
        const timeout = opts.timeout || 15000;
        const scriptFile = path.join(this.tempDir, `script_${Date.now()}.py`);
        fs.writeFileSync(scriptFile, code);

        return new Promise<SandboxResult>((resolve) => {
            const child = spawn('python', [scriptFile], {
                cwd: this.tempDir,
                env: { ...process.env, PYTHONNOUSERSITE: '1' },
                windowsHide: true,
            });
            let stdout = '', stderr = '';
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                resolve({ ok: false, stdout, stderr: stderr + '\n[Timeout: killed after ' + timeout + 'ms]', timedOut: true });
            }, timeout);

            child.stdout.on('data', (d: Buffer) => stdout += d.toString());
            child.stderr.on('data', (d: Buffer) => stderr += d.toString());
            child.on('close', (code: number | null) => {
                clearTimeout(timer);
                fs.unlinkSync(scriptFile);
                resolve({ ok: code === 0, stdout, stderr, exitCode: code });
            });
        });
    }

    async runNode(code: string, opts: { timeout?: number } = {}): Promise<SandboxResult> {
        // Node vm sandbox — no require, no process, no network
        const timeout = opts.timeout || 5000;
        const sandbox = {
            console: {
                log: (...args: unknown[]) => { this._nodeOutput += args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n'; },
                error: (...args: unknown[]) => { this._nodeError += args.map(a => String(a)).join(' ') + '\n'; },
            },
            Math, JSON, Date, Array, Object, String, Number, Boolean, parseInt, parseFloat, isNaN, isFinite,
        };
        this._nodeOutput = '';
        this._nodeError = '';
        try {
            vm.createContext(sandbox);
            const result = vm.runInContext(code, sandbox, { timeout });
            return { ok: true, stdout: this._nodeOutput, stderr: this._nodeError, result: result !== undefined ? String(result) : '' };
        } catch (e) {
            return { ok: false, stdout: this._nodeOutput, stderr: this._nodeError + '\n' + (e instanceof Error ? e.message : String(e)) };
        }
    }

    async runDocker(code: string, opts: { timeout?: number } = {}): Promise<SandboxResult> {
        // Requires Docker installed. Uses python:3-slim image, no network.
        this.init();
        const timeout = opts.timeout || 20000;
        const scriptFile = path.join(this.tempDir, `script_${Date.now()}.py`);
        fs.writeFileSync(scriptFile, code);

        return new Promise<SandboxResult>((resolve) => {
            const cmd = `docker run --rm --network none --memory 512m --cpus 1 -v "${scriptFile}:/app/script.py:ro" python:3-slim python /app/script.py`;
            exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
                fs.unlinkSync(scriptFile);
                resolve({ ok: !err, stdout, stderr: stderr || (err ? err.message : ''), exitCode: err ? (err as any).code : 0 });
            });
        });
    }

    async run(code: string, language = 'python', opts: { timeout?: number } = {}): Promise<SandboxResult> {
        const mode = this.plugin.settings.sandboxMode;
        if (mode === 'docker') {
            return this.runDocker(code, opts);
        } else if (language === 'javascript' || language === 'js') {
            return this.runNode(code, opts);
        }
        return this.runPython(code, opts);
    }
}

// ============================================================
//  CODE AUDITOR
// ============================================================

interface AuditFinding {
    name: string;
    severity: string;
    match: string;
}

class CodeAuditor {
    plugin: VaultScholarPlugin;

    static patterns: Array<{ name: string; pattern: RegExp; severity: string }> = [
        { name: 'SQL Injection', pattern: /(SELECT|INSERT|UPDATE|DELETE).*(\+|\$\{).*(WHERE|VALUES)/i, severity: 'critical' },
        { name: 'Command Injection', pattern: /(exec|system|popen|spawn|shell_exec|eval)\s*\(/i, severity: 'critical' },
        { name: 'Path Traversal', pattern: /(\.\.\/|\.\.\\)/, severity: 'high' },
        { name: 'Hardcoded Secret', pattern: /(password|secret|api[_-]?key|token)\s*[=:]\s*['"][^'"]{8,}['"]/i, severity: 'high' },
        { name: 'Insecure Deserialization', pattern: /(pickle\.loads|eval\(|Function\(|new Function)/, severity: 'high' },
        { name: 'Unsafe Eval', pattern: /\beval\s*\(/, severity: 'high' },
        { name: 'Weak Crypto', pattern: /(md5|sha1|DES|RC4)\s*\(/i, severity: 'medium' },
        { name: 'Insecure Random', pattern: /(Math\.random|random\(\))/, severity: 'low' },
        { name: 'Buffer Overflow Risk', pattern: /(strcpy|strcat|sprintf|gets)\s*\(/, severity: 'critical' },
        { name: 'Race Condition', pattern: /(thread|fork|spawn).*(shared|global|static)/i, severity: 'medium' },
        { name: 'Unvalidated Input', pattern: /(input\(|getParameter|request\.get|req\.query|req\.body)/i, severity: 'medium' },
        { name: 'Insecure File Write', pattern: /(open\(.*['"]w['"]|writeFile|fwrite)/i, severity: 'medium' },
    ];

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
    }

    staticScan(code: string): AuditFinding[] {
        const findings: AuditFinding[] = [];
        for (const p of CodeAuditor.patterns) {
            const matches = code.match(p.pattern);
            if (matches) {
                findings.push({ name: p.name, severity: p.severity, match: matches[0] });
            }
        }
        return findings;
    }

    async audit(code: string, language = 'python'): Promise<{ staticFindings: AuditFinding[]; aiAnalysis: string }> {
        const staticFindings = this.staticScan(code);

        // Use coder model for deeper analysis
        const prompt = `You are a security auditor. Analyze this ${language} code for vulnerabilities, security issues, and bugs.

CODE:
\`\`\`${language}
${code}
\`\`\`

Respond with a structured list of findings. For each finding include:
- Severity (critical/high/medium/low)
- Location (line or function)
- Description
- Recommended fix

If no issues found, say "No vulnerabilities detected."

FINDINGS:`;

        const modelId = MODELS.coder.id;
        const aiAnalysis = await this.plugin.ollama.generate(modelId, prompt, { numCtx: this.plugin.settings.numCtxLong });

        return { staticFindings, aiAnalysis };
    }
}

// ============================================================
//  MATH / PHYSICS ENGINE
// ============================================================

class MathPhysicsEngine {
    plugin: VaultScholarPlugin;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
    }

    async derive(problem: string, opts: { context?: string; sourceNote?: string | null } = {}): Promise<string> {
        const prompt = `You are a rigorous mathematician and physicist. Derive the solution to the following problem step-by-step, showing every step clearly.

PROBLEM:
${problem}

${opts.context ? 'CONTEXT:\n' + opts.context + '\n' : ''}

Provide:
1. Problem restatement
2. Step-by-step derivation (each step numbered and explained)
3. Final result
4. Verification / sanity check
5. Any assumptions made

DERIVATION:`;

        const modelId = MODELS.math.id;
        const result = await this.plugin.ollama.generate(modelId, prompt, { numCtx: this.plugin.settings.numCtxLong });

        await this.plugin.provenance.record({
            type: 'derivation',
            content: result,
            sourceNote: opts.sourceNote || null,
            model: modelId,
            contentSource: CONTENT_SOURCES.MATH_DERIVED,
            trustLevel: TRUST_LEVELS.INFERRED,
            metadata: { problem },
        });

        return result;
    }

    async analyzePatterns(input: string, opts: { context?: string; sourceNote?: string | null } = {}): Promise<string> {
        const prompt = `You are an expert in mathematical and physical pattern recognition. Analyze the following for logical patterns, symmetries, and invariants.

INPUT:
${input}

${opts.context ? 'CONTEXT:\n' + opts.context + '\n' : ''}

Provide:
1. Detected patterns
2. Symmetries (if any)
3. Invariants (quantities that don't change)
4. Conservation laws (if applicable)
5. Implications

ANALYSIS:`;

        const modelId = MODELS.math.id;
        const result = await this.plugin.ollama.generate(modelId, prompt, { numCtx: this.plugin.settings.numCtxLong });

        await this.plugin.provenance.record({
            type: 'pattern_analysis',
            content: result,
            sourceNote: opts.sourceNote || null,
            model: modelId,
            contentSource: CONTENT_SOURCES.AI_GENERATED,
            trustLevel: TRUST_LEVELS.INFERRED,
            metadata: { input },
        });

        return result;
    }
}

// ============================================================
//  SIMULATION ENGINE
// ============================================================

class SimulationEngine {
    plugin: VaultScholarPlugin;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
    }

    async generateSpec(description: string, opts: { context?: string; sourceNote?: string | null } = {}): Promise<string> {
        const prompt = `You are a simulation specification generator. Create a detailed, executable simulation specification from the following description.

DESCRIPTION:
${description}

${opts.context ? 'CONTEXT:\n' + opts.context + '\n' : ''}

Generate a structured specification with:
1. Simulation name and purpose
2. Physical/mathematical model (equations)
3. Initial conditions
4. Parameters and constants
5. Numerical method (e.g., Euler, RK4)
6. Time stepping (dt, total time)
7. Outputs and visualizations
8. Validation criteria

SPECIFICATION:`;

        const modelId = MODELS.math.id;
        const result = await this.plugin.ollama.generate(modelId, prompt, { numCtx: this.plugin.settings.numCtxLong });

        await this.plugin.provenance.record({
            type: 'simulation_spec',
            content: result,
            sourceNote: opts.sourceNote || null,
            model: modelId,
            contentSource: CONTENT_SOURCES.AI_GENERATED,
            trustLevel: TRUST_LEVELS.INFERRED,
            metadata: { description },
        });

        return result;
    }

    async buildScript(spec: string, language = 'python', opts: { sourceNote?: string | null } = {}): Promise<{ script: string; full: string }> {
        const prompt = `You are an expert simulation coder. Write a complete, runnable ${language} script that implements the following simulation specification.

SPECIFICATION:
${spec}

Requirements:
- Complete, self-contained script
- No external dependencies beyond standard library (or numpy/matplotlib if needed)
- Clear comments
- Proper error handling
- Output results to stdout
- Include validation checks

SCRIPT:`;

        const modelId = MODELS.coder.id;
        const result = await this.plugin.ollama.generate(modelId, prompt, { numCtx: this.plugin.settings.numCtxLong });

        // Extract code block
        const codeMatch = result.match(/```(?:python|javascript|js)?\s*\n([\s\S]*?)```/);
        const code = codeMatch ? codeMatch[1] : result;

        await this.plugin.provenance.record({
            type: 'simulation_script',
            content: code,
            sourceNote: opts.sourceNote || null,
            model: modelId,
            contentSource: CONTENT_SOURCES.CODE_GENERATED,
            trustLevel: TRUST_LEVELS.UNVERIFIED,
            metadata: { spec, language },
        });

        return { script: code, full: result };
    }
}

// ============================================================
//  RESEARCH ENGINE
// ============================================================

class ResearchEngine {
    plugin: VaultScholarPlugin;

    constructor(plugin: VaultScholarPlugin) {
        this.plugin = plugin;
    }

    async research(topic: string, opts: { sourceNote?: string | null; externalSources?: boolean } = {}): Promise<{ result: string; citations: string[] }> {
        // Gather context from RAG if available
        let context = '';
        if (this.plugin.settings.ragEnabled) {
            const results = await this.plugin.rag.search(topic, 5);
            if (results.length > 0) {
                context = 'RELEVANT VAULT NOTES:\n' + results.map(r =>
                    `[${r.chunk.note}] (relevance ${(r.score * 100).toFixed(1)}%):\n${r.chunk.text}`
                ).join('\n\n---\n\n');
            }
        }

        const prompt = `You are a rigorous research assistant. Research the following topic and provide a comprehensive, well-cited synthesis.

TOPIC:
${topic}

${context ? context + '\n' : ''}
${opts.externalSources ? 'EXTERNAL SOURCES: You may reference external knowledge, but clearly mark each claim with [VERIFY] if it needs verification.\n' : 'EXTERNAL SOURCES: Do NOT use external sources. Base your answer only on the provided vault context and your internal knowledge, clearly marking any uncertain claims with [UNCERTAIN].\n'}

Provide:
1. Executive summary
2. Key findings (each with citation to source note or [VERIFY]/[UNCERTAIN] marker)
3. Evidence assessment
4. Gaps and open questions
5. References

RESEARCH:`;

        const modelId = MODELS.deep.id;
        const result = await this.plugin.ollama.generate(modelId, prompt, { numCtx: this.plugin.settings.numCtxLong });

        // Record provenance with citations
        const citations = context ? context.match(/\[([^\]]+\.md)\]/g)?.map(c => c.slice(1, -1)) || [] : [];
        await this.plugin.provenance.record({
            type: 'research',
            content: result,
            sourceNote: opts.sourceNote || null,
            model: modelId,
            citations,
            verified: !opts.externalSources,
            verificationMethod: opts.externalSources ? 'needs_verification' : 'vault_context_only',
            contentSource: opts.externalSources ? CONTENT_SOURCES.EXTERNAL_SOURCED : CONTENT_SOURCES.AI_GENERATED,
            trustLevel: opts.externalSources ? TRUST_LEVELS.UNVERIFIED : (citations.length > 0 ? TRUST_LEVELS.VERIFIED : TRUST_LEVELS.INFERRED),
            metadata: { topic },
        });

        return { result, citations };
    }
}

// ============================================================
//  MAIN PLUGIN
// ============================================================

export default class VaultScholarPlugin extends Plugin {
    settings!: Settings;
    assetsDir!: string;
    workingMemory: string = '';
    statusBarEl!: HTMLElement;

    ollama!: OllamaClient;
    modelManager!: ModelManager;
    taskRouter!: TaskRouter;
    provenance!: ProvenanceEngine;
    snapshotManager!: SnapshotManager;
    rag!: RAGEngine;
    sandbox!: SandboxManager;
    codeAuditor!: CodeAuditor;
    mathPhysics!: MathPhysicsEngine;
    simulation!: SimulationEngine;
    research!: ResearchEngine;
    researchMode!: ResearchMode;
    trustBoundary!: TrustBoundary;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Asset directories
        this.assetsDir = path.join((this.app.vault.adapter as any).getBasePath(), '.obsidian', 'plugins', PLUGIN_ID, 'assets');
        if (!fs.existsSync(this.assetsDir)) fs.mkdirSync(this.assetsDir, { recursive: true });

        // Initialize engines
        this.ollama = new OllamaClient(this);
        this.modelManager = new ModelManager(this);
        this.taskRouter = new TaskRouter(this);
        this.provenance = new ProvenanceEngine(this);
        this.snapshotManager = new SnapshotManager(this);
        this.rag = new RAGEngine(this);
        this.sandbox = new SandboxManager(this);
        this.codeAuditor = new CodeAuditor(this);
        this.mathPhysics = new MathPhysicsEngine(this);
        this.simulation = new SimulationEngine(this);
        this.research = new ResearchEngine(this);
        // Trust Boundary
        this.trustBoundary = new TrustBoundary({
            enabled: this.settings.trustEnforcement,
            onDecision: (decision: TrustDecision) => {
                // Log trust decisions to provenance
                this.provenance.record({
                    type: 'trust_decision',
                    content: `${decision.operation}: ${decision.allowed ? 'ALLOWED' : 'BLOCKED'} (${decision.level} vs ${decision.required})`,
                    contentSource: CONTENT_SOURCES.AI_GENERATED,
                    trustLevel: decision.level,
                    verifiedBy: 'trust_boundary',
                    metadata: { decision },
                });
            },
        });

        // Research Mode (uses trustBoundary)
        this.researchMode = new ResearchMode({
            createFetcher: () => async (url: string) => {
                const res = await requestUrl({ url, throw: false });
                if (res.status >= 400) throw new Error('HTTP ' + res.status);
                return res.text;
            },
            generate: (model: string, prompt: string, opts?: Record<string, unknown>) => this.ollama.generate(model, prompt, opts as any),
            modelId: MODELS.deep.id,
            settings: {
                searchProvider: this.settings.searchProvider,
                searxngUrl: this.settings.searxngUrl,
                searxngCategories: this.settings.searxngCategories,
                searxngMaxResults: this.settings.searxngMaxResults,
                maxSources: this.settings.maxSources,
                maxSearchResults: this.settings.maxSearchResults,
                numCtxLong: this.settings.numCtxLong,
            },
            trustBoundary: this.trustBoundary,
        });

        this.provenance.init();
        this.snapshotManager.init();
        this.rag.init();
        this.sandbox.init();
        this.workingMemory = '';

        // Status bar
        this.statusBarEl = this.addStatusBarItem();
        this.updateStatusBar();

        // Ribbon
        this.addRibbonIcon('brain-circuit', 'Vault Scholar', () => {
            this.openMainModal();
        });

        // Commands (data-driven)
        this.registerCommands();

        // Settings tab (data-driven)
        this.addSettingTab(new VaultScholarSettingTab(this.app, this));

        // Warm up embeddings
        this.modelManager.ensureEmbeddingsLoaded();

        new Notice('🦉 Vault Scholar loaded');
    }

    onunload(): void {
        new Notice('🦉 Vault Scholar unloaded');
    }

    updateStatusBar(): void {
        const model = this.modelManager.activeModel;
        const short = model.split(':')[0].split('/').pop();
        this.statusBarEl.setText(`🦉 ${short}`);
        this.statusBarEl.setAttribute('aria-label', `Vault Scholar — Active model: ${model}`);
    }

    registerCommands(): void {
        for (const cmd of COMMANDS) {
            this.addCommand({
                id: cmd.id,
                name: cmd.name,
                callback: () => cmd.callback(this as any),
            });
        }
    }

    // ============================================================
    //  UI HELPERS
    // ============================================================

    async promptForInput(placeholder: string, callback: (value: string) => Promise<void> | void): Promise<void> {
        const modal = new InputModal(this.app, placeholder);
        const value = await modal.openAsync();
        if (!value) return;
        try {
            await callback(value);
        } catch (e) {
            new Notice(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
            console.error(e);
        }
    }

    showResultModal(title: string, content: string, citations: string[] = [], code: string | null = null): void {
        const modal = new ResultModal(this.app, title, content, citations, code, this);
        modal.open();
    }

    confirmModal(title: string, message: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const modal = new ConfirmModal(this.app, title, message, resolve);
            modal.open();
        });
    }

    openMainModal(): void {
        const modal = new MainModal(this.app, this);
        modal.open();
    }

    async loadSettings(): Promise<void> {
        this.settings = parseSettings(await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    async trustAudit(): Promise<void> {
        const files = this.app.vault.getMarkdownFiles();
        let trusted = 0, verified = 0, inferred = 0, unverified = 0;
        const breakdown: Record<string, number> = {};

        for (const file of files) {
            const content = await this.app.vault.cachedRead(file);
            const record = TrustClassifier.classify(content, {
                source: CONTENT_SOURCES.USER_CREATED,
                trustLevel: TRUST_LEVELS.TRUSTED,
                verifiedBy: 'user',
            });
            switch (record.trustLevel) {
                case TRUST_LEVELS.TRUSTED: trusted++; break;
                case TRUST_LEVELS.VERIFIED: verified++; break;
                case TRUST_LEVELS.INFERRED: inferred++; break;
                default: unverified++; break;
            }
            breakdown[record.trustLevel] = (breakdown[record.trustLevel] || 0) + 1;
        }

        const text =
            `🔒 TRUST AUDIT\n` +
            `=============\n\n` +
            `📊 Total notes: ${files.length}\n\n` +
            `🛡️ TRUSTED:   ${trusted}\n` +
            `✅ VERIFIED:  ${verified}\n` +
            `🧠 INFERRED:  ${inferred}\n` +
            `⚠️ UNVERIFIED: ${unverified}\n\n` +
            `Source breakdown:\n` +
            Object.entries(breakdown).map(([k, v]) => `  ${k}: ${v}`).join('\n') +
            `\n\nTrust boundary ${this.settings.trustEnforcement ? 'ACTIVE' : 'DISABLED'}`;

        this.showResultModal('Trust Audit', text);
    }
}

// ============================================================
//  CONFIRM MODAL (kept local — simple boolean promise)
// ============================================================

class ConfirmModal extends Modal {
    title: string;
    message: string;
    onConfirm: (value: boolean) => void;

    constructor(app: App, title: string, message: string, onConfirm: (value: boolean) => void) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: this.title });
        contentEl.createEl('p', { text: this.message });

        const btnRow = contentEl.createDiv({ cls: 'vs-btn-row' });
        const yesBtn = btnRow.createEl('button', { text: '✅ Yes', cls: 'mod-cta' });
        const noBtn = btnRow.createEl('button', { text: '❌ No' });

        yesBtn.addEventListener('click', () => {
            this.close();
            this.onConfirm(true);
        });
        noBtn.addEventListener('click', () => {
            this.close();
            this.onConfirm(false);
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

// ============================================================
//  SETTINGS TAB (data-driven)
// ============================================================

class VaultScholarSettingTab extends PluginSettingTab {
    plugin: VaultScholarPlugin;

    constructor(app: App, plugin: VaultScholarPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: '🦉 Vault Scholar Settings' });

        // Data-driven fields
        for (const def of SETTING_FIELDS) {
            addSettingField(containerEl, this.plugin, def);
        }

        // Action buttons
        addActionButtons(containerEl, this.plugin);
    }
}

// ============================================================
//  UTILITIES
// ============================================================

function hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
}

function nowISO(): string {
    return new Date().toISOString();
}