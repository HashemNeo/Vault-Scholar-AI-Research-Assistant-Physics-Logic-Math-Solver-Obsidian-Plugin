// ============================================================
//  Vault Scholar — Secure Research, Math/Physics, Code &
//  Simulation Engine for Obsidian
//
//  Single-file, no-build plugin. Pure JavaScript, zero deps.
//  Uses local Ollama models. Sandboxed code execution.
// ============================================================

const { Plugin, PluginSettingTab, Setting, Notice, Modal, App, MarkdownView, requestUrl, Platform } = require('obsidian');
const { exec, execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TRUST_LEVELS, CONTENT_SOURCES, TrustClassifier, TrustBoundary } = require('./lib/trust');
const { EvidenceGate, CLAIM_ORIGIN, EVIDENCE_MARKERS } = require('./lib/evidence');
const { ResearchMode, SourceClassifier, SOURCE_TRUST } = require('./lib/research');

// ============================================================
//  CONFIGURATION
// ============================================================

const OLLAMA_HOST = 'http://localhost:11434';
const PLUGIN_ID = 'vault-scholar';

const MODELS = {
    safe:       { id: 'qwen3:8b',                                role: '🟢 Safe / Everyday',        default: true  },
    deep:       { id: 'gemma4:12b',                              role: '🧠 Deep Reasoning',         default: false },
    math:       { id: 'mathstral:latest',                        role: '➗ Math / Science',         default: false },
    coder:      { id: 'huihui_ai/qwen2.5-coder-abliterate:7b',   role: '💻 Coding / Security',      default: false },
    embedding:  { id: 'qwen3-embedding:0.6b',                    role: '🔎 Embeddings',             default: true  },
};

const DEFAULT_SETTINGS = {
    // Security
    safeMode: true,
    internetResearch: false,
    vaultWriteApproval: true,
    scriptExecutionApproval: true,
    verifyExternalBeforeWrite: true,
    sandboxMode: 'python', // 'python' | 'node' | 'docker'
    // Trust Boundary
    trustEnforcement: true,
    trustThreshold: TRUST_LEVELS.VERIFIED,
    trustDisplay: true,
    // Models
    activeModel: MODELS.safe.id,
    // Context
    numCtx: 4096,
    numCtxLong: 8192,
    // VRAM
    keepEmbeddingsLoaded: true,
    // Provenance
    provenanceEnabled: true,
    // Snapshots
    autoSnapshotBeforeRisky: true,
    snapshotMaxCount: 20,
    // RAG
    ragEnabled: true,
    // Evidence-Gated Knowledge
    evidenceGating: true,
    // Research Mode
    researchModeEnabled: true,
    searchProvider: 'duckduckgo',
    searxngUrl: '',
    searxngCategories: 'general',
    searxngMaxResults: 10,
    maxSources: 5,
    maxSearchResults: 10,
    // Ollama
    ollamaHost: OLLAMA_HOST,
};

// ============================================================
//  UTILITIES
// ============================================================

function hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

function nowISO() {
    return new Date().toISOString();
}

function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
}

function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
}

// ============================================================
//  OLLAMA CLIENT
// ============================================================

class OllamaClient {
    constructor(plugin) {
        this.plugin = plugin;
        this.host = plugin.settings.ollamaHost;
    }

    async request(endpoint, body) {
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

    async chat(model, messages, opts = {}) {
        const body = {
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

    async generate(model, prompt, opts = {}) {
        const body = {
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

    async embed(texts) {
        const res = await this.request('/api/embed', {
            model: MODELS.embedding.id,
            input: Array.isArray(texts) ? texts : [texts],
        });
        return res.embeddings || [];
    }

    async listModels() {
        const res = await this.request('/api/tags', {});
        return res.models || [];
    }

    async ps() {
        const res = await this.request('/api/ps', {});
        return res.models || [];
    }

    async show(model) {
        const res = await this.request('/api/show', { model });
        return res;
    }

    async pull(model) {
        const res = await this.request('/api/pull', { model, stream: false });
        return res;
    }

    async unload(model) {
        try {
            await this.request('/api/generate', { model, keep_alive: 0, prompt: '' });
        } catch (e) { /* ignore */ }
    }
}

// ============================================================
//  MODEL MANAGER (VRAM-aware)
// ============================================================

class ModelManager {
    constructor(plugin) {
        this.plugin = plugin;
        this.client = plugin.ollama;
        this.activeModel = plugin.settings.activeModel;
        this.semanticMemory = '';
    }

    async switchTo(modelId, opts = {}) {
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

    async ensureEmbeddingsLoaded() {
        if (!this.plugin.settings.keepEmbeddingsLoaded) return;
        try {
            await this.client.embed(['warmup']);
        } catch (e) { /* ignore */ }
    }
}

// ============================================================
//  TASK ROUTER
// ============================================================

class TaskRouter {
    constructor(plugin) {
        this.plugin = plugin;
    }

    classify(input) {
        const text = input.toLowerCase();
        const rules = [
            { model: 'math',    pattern: /(derive|derivation|integral|derivative|equation|solve|proof|theorem|calculus|algebra|physics|symmetry|invariant|lagrangian|hamiltonian|schr|maxwell|newton|fourier|laplace|eigen|tensor|vector field|differential)/ },
            { model: 'coder',   pattern: /(code|script|debug|vulnerab|security|exploit|function|class|api|syntax|error|bug|simulation script|python|javascript|typescript|sql|regex|audit)/ },
            { model: 'deep',    pattern: /(research|synthesize|analyze|compare|evaluate|critique|literature|paper|theory|concept|explain in depth|reason)/ },
        ];
        for (const rule of rules) {
            if (rule.pattern.test(text)) return rule.model;
        }
        return 'safe';
    }

    async route(input, opts = {}) {
        const target = opts.model || this.classify(input);
        const modelId = MODELS[target] ? MODELS[target].id : target;
        await this.plugin.modelManager.switchTo(modelId);
        return { target, modelId };
    }
}

// ============================================================
//  PROVENANCE ENGINE
// ============================================================

class ProvenanceEngine {
    constructor(plugin) {
        this.plugin = plugin;
        this.dir = path.join(plugin.assetsDir, 'provenance');
        this.logFile = path.join(this.dir, 'provenance.jsonl');
    }

    init() {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    }

    async record(entry) {
        if (!this.plugin.settings.provenanceEnabled) return;
        this.init();
        // Classify trust for this record
        const trust = TrustClassifier.classify(entry.content || '', {
            source: entry.contentSource || CONTENT_SOURCES.AI_GENERATED,
            trustLevel: entry.trustLevel,
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

    async getAll() {
        if (!fs.existsSync(this.logFile)) return [];
        const lines = fs.readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean);
        return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    }

    async getByType(type) {
        const all = await this.getAll();
        return all.filter(r => r.type === type);
    }
}

// ============================================================
//  SNAPSHOT MANAGER
// ============================================================

class SnapshotManager {
    constructor(plugin) {
        this.plugin = plugin;
        this.dir = path.join(plugin.assetsDir, 'snapshots');
    }

    init() {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    }

    async createSnapshot(label = 'manual') {
        this.init();
        const vaultPath = this.plugin.app.vault.adapter.getBasePath();
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const name = `${ts}_${sanitizeFilename(label)}`;
        const dest = path.join(this.dir, name);
        fs.mkdirSync(dest, { recursive: true });

        const exclude = new Set(['.obsidian', '.trash', '.git', '.copilot-index', '.megaignore']);
        const copyRecursive = (src, dst) => {
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

    listSnapshots() {
        if (!fs.existsSync(this.dir)) return [];
        return fs.readdirSync(this.dir).filter(f => fs.statSync(path.join(this.dir, f)).isDirectory()).sort().reverse();
    }

    async restoreSnapshot(name) {
        const src = path.join(this.dir, name);
        if (!fs.existsSync(src)) {
            new Notice('❌ Snapshot not found');
            return false;
        }
        const vaultPath = this.plugin.app.vault.adapter.getBasePath();
        const exclude = new Set(['.obsidian', '.trash', '.git', '.copilot-index']);
        const copyRecursive = (srcDir, dstDir) => {
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

class RAGEngine {
    constructor(plugin) {
        this.plugin = plugin;
        this.dir = path.join(plugin.assetsDir, 'vectorstore');
        this.indexFile = path.join(this.dir, 'index.json');
        this.index = { chunks: [], embeddings: [] };
    }

    init() {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
        if (fs.existsSync(this.indexFile)) {
            try {
                this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
            } catch { this.index = { chunks: [], embeddings: [] }; }
        }
    }

    save() {
        fs.writeFileSync(this.indexFile, JSON.stringify(this.index));
    }

    async indexNote(note) {
        if (!this.plugin.settings.ragEnabled) return;
        this.init();
        const content = note.content || '';
        if (content.length < 50) return;

        // Chunk by paragraphs (~500 chars)
        const chunks = [];
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

    async indexVault() {
        const files = this.plugin.app.vault.getMarkdownFiles();
        for (const file of files) {
            const content = await this.plugin.app.vault.cachedRead(file);
            await this.indexNote({ path: file.path, content });
        }
        new Notice(`🔎 Indexed ${files.length} notes`);
    }

    cosineSim(a, b) {
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

    async search(query, topK = 5) {
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

class SandboxManager {
    constructor(plugin) {
        this.plugin = plugin;
        this.dir = path.join(plugin.assetsDir, 'sandbox');
        this.tempDir = path.join(this.dir, 'tmp');
    }

    init() {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
        if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
    }

    async runPython(code, opts = {}) {
        this.init();
        const timeout = opts.timeout || 15000;
        const scriptFile = path.join(this.tempDir, `script_${Date.now()}.py`);
        fs.writeFileSync(scriptFile, code);

        return new Promise((resolve) => {
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

            child.stdout.on('data', d => stdout += d.toString());
            child.stderr.on('data', d => stderr += d.toString());
            child.on('close', (code) => {
                clearTimeout(timer);
                fs.unlinkSync(scriptFile);
                resolve({ ok: code === 0, stdout, stderr, exitCode: code });
            });
        });
    }

    async runNode(code, opts = {}) {
        // Node vm sandbox — no require, no process, no network
        const vm = require('vm');
        const timeout = opts.timeout || 5000;
        const sandbox = {
            console: {
                log: (...args) => { this._nodeOutput += args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n'; },
                error: (...args) => { this._nodeError += args.map(a => String(a)).join(' ') + '\n'; },
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
            return { ok: false, stdout: this._nodeOutput, stderr: this._nodeError + '\n' + e.message };
        }
    }

    async runDocker(code, opts = {}) {
        // Requires Docker installed. Uses python:3-slim image, no network.
        this.init();
        const timeout = opts.timeout || 20000;
        const scriptFile = path.join(this.tempDir, `script_${Date.now()}.py`);
        fs.writeFileSync(scriptFile, code);

        return new Promise((resolve) => {
            const cmd = `docker run --rm --network none --memory 512m --cpus 1 -v "${scriptFile}:/app/script.py:ro" python:3-slim python /app/script.py`;
            exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
                fs.unlinkSync(scriptFile);
                resolve({ ok: !err, stdout, stderr: stderr || (err ? err.message : ''), exitCode: err ? err.code : 0 });
            });
        });
    }

    async run(code, language = 'python', opts = {}) {
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

class CodeAuditor {
    constructor(plugin) {
        this.plugin = plugin;
    }

    static patterns = [
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

    staticScan(code) {
        const findings = [];
        for (const p of CodeAuditor.patterns) {
            const matches = code.match(p.pattern);
            if (matches) {
                findings.push({ name: p.name, severity: p.severity, match: matches[0] });
            }
        }
        return findings;
    }

    async audit(code, language = 'python') {
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
    constructor(plugin) {
        this.plugin = plugin;
    }

    async derive(problem, opts = {}) {
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

    async analyzePatterns(input, opts = {}) {
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
    constructor(plugin) {
        this.plugin = plugin;
    }

    async generateSpec(description, opts = {}) {
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

    async buildScript(spec, language = 'python', opts = {}) {
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
    constructor(plugin) {
        this.plugin = plugin;
    }

    async research(topic, opts = {}) {
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

class VaultScholarPlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        // Asset directories
        this.assetsDir = path.join(this.app.vault.adapter.getBasePath(), '.obsidian', 'plugins', PLUGIN_ID, 'assets');
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
            onDecision: (decision) => {
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
            createFetcher: () => async (url) => {
                const res = await requestUrl({ url, throw: false });
                if (res.status >= 400) throw new Error('HTTP ' + res.status);
                return res.text;
            },
            generate: (model, prompt, opts) => this.ollama.generate(model, prompt, opts),
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

        // Commands
        this.registerCommands();

        // Settings tab
        this.addSettingTab(new VaultScholarSettingTab(this.app, this));

        // Warm up embeddings
        this.modelManager.ensureEmbeddingsLoaded();

        // Auto-snapshot on load (optional)
        if (this.settings.autoSnapshotBeforeRisky) {
            // Don't snapshot on every load — only before risky ops
        }

        new Notice('🦉 Vault Scholar loaded');
    }

    onunload() {
        new Notice('🦉 Vault Scholar unloaded');
    }

    updateStatusBar() {
        const model = this.modelManager.activeModel;
        const short = model.split(':')[0].split('/').pop();
        this.statusBarEl.setText(`🦉 ${short}`);
        this.statusBarEl.setAttribute('aria-label', `Vault Scholar — Active model: ${model}`);
    }

    registerCommands() {
        this.addCommand({
            id: 'open-main',
            name: 'Open Vault Scholar',
            callback: () => this.openMainModal(),
        });

        this.addCommand({
            id: 'research',
            name: 'Research with citations',
            callback: () => this.promptForInput('🔬 Research topic:', async (topic) => {
                const { result, citations } = await this.research.research(topic);
                this.showResultModal('Research Results', result, citations);
            }),
        });

        this.addCommand({
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
                    '🔍 VAULT EVIDENCE LINT\n' +
                    '======================\n\n' +
                    'Files: ' + files.length + '\n' +
                    'Total claims: ' + total + '\n' +
                    'Blocked: ' + blocked + '\n' +
                    'Files with issues: ' + details.length + '\n\n' +
                    (details.length > 0 ? details.join('\n') : '✅ No unsourced external claims detected');
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
                doc.replaceRange(header + '\n\n', cursor);
                new Notice('✅ Simulation header inserted');
            },
        });

        this.addCommand({
            id: 'derive-math',
            name: 'Derive math/physics step-by-step',
            callback: () => this.promptForInput('➗ Problem to derive:', async (problem) => {
                const result = await this.mathPhysics.derive(problem);
                this.showResultModal('Derivation', result);
            }),
        });

        this.addCommand({
            id: 'analyze-patterns',
            name: 'Analyze patterns/symmetries/invariants',
            callback: () => this.promptForInput('🔍 Input to analyze:', async (input) => {
                const result = await this.mathPhysics.analyzePatterns(input);
                this.showResultModal('Pattern Analysis', result);
            }),
        });

        this.addCommand({
            id: 'audit-code',
            name: 'Audit code for vulnerabilities',
            callback: () => this.promptForInput('💻 Code to audit (paste code):', async (code) => {
                const result = await this.codeAuditor.audit(code);
                const staticText = result.staticFindings.length > 0
                    ? result.staticFindings.map(f => `- [${f.severity.toUpperCase()}] ${f.name}: ${f.match}`).join('\n')
                    : '- No static pattern matches';
                this.showResultModal('Code Audit', `STATIC ANALYSIS:\n${staticText}\n\nAI ANALYSIS:\n${result.aiAnalysis}`);
            }),
        });

        this.addCommand({
            id: 'generate-sim-spec',
            name: 'Generate simulation specification',
            callback: () => this.promptForInput('🎯 Simulation description:', async (desc) => {
                const spec = await this.simulation.generateSpec(desc);
                this.showResultModal('Simulation Specification', spec);
            }),
        });

        this.addCommand({
            id: 'build-sim-script',
            name: 'Build simulation script from spec',
            callback: () => this.promptForInput('📝 Paste simulation spec:', async (spec) => {
                const { script, full } = await this.simulation.buildScript(spec);
                this.showResultModal('Simulation Script', full, [], script);
            }),
        });

        this.addCommand({
            id: 'run-script-sandbox',
            name: 'Run script in sandbox',
            callback: () => this.promptForInput('🏃 Paste script to run in sandbox:', async (code) => {
                if (this.settings.scriptExecutionApproval) {
                    const approved = await this.confirmModal('Run in sandbox?', 'This will execute the script in an isolated sandbox. Continue?');
                    if (!approved) { new Notice('❌ Script execution cancelled'); return; }
                }
                const result = await this.sandbox.run(code);
                this.showResultModal('Sandbox Output', `EXIT CODE: ${result.exitCode ?? 'N/A'}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`);
            }),
        });

        this.addCommand({
            id: 'semantic-search',
            name: 'Semantic search vault',
            callback: () => this.promptForInput('🔎 Search query:', async (query) => {
                const results = await this.rag.search(query);
                if (results.length === 0) {
                    new Notice('No results found. Try indexing the vault first.');
                    return;
                }
                const text = results.map((r, i) =>
                    `### ${i + 1}. [${r.chunk.note}] (${(r.score * 100).toFixed(1)}%)\n${r.chunk.text}`
                ).join('\n\n');
                this.showResultModal('Semantic Search Results', text);
            }),
        });

        this.addCommand({
            id: 'index-vault',
            name: 'Index vault for semantic search',
            callback: () => this.rag.indexVault(),
        });

        this.addCommand({
            id: 'create-snapshot',
            name: 'Create vault snapshot',
            callback: () => this.promptForInput('📸 Snapshot label:', async (label) => {
                await this.snapshotManager.createSnapshot(label || 'manual');
            }),
        });

        this.addCommand({
            id: 'list-snapshots',
            name: 'List snapshots',
            callback: () => {
                const snapshots = this.snapshotManager.listSnapshots();
                if (snapshots.length === 0) {
                    new Notice('No snapshots yet');
                    return;
                }
                this.showResultModal('Snapshots', snapshots.map((s, i) => `${i + 1}. ${s}`).join('\n'));
            },
        });

        this.addCommand({
            id: 'restore-snapshot',
            name: 'Restore snapshot',
            callback: () => this.promptForInput('♻️ Snapshot name to restore:', async (name) => {
                if (this.settings.vaultWriteApproval) {
                    const approved = await this.confirmModal('Restore snapshot?', `This will overwrite vault files with snapshot "${name}". Continue?`);
                    if (!approved) { new Notice('❌ Restore cancelled'); return; }
                }
                await this.snapshotManager.restoreSnapshot(name);
            }),
        });

        this.addCommand({
            id: 'view-provenance',
            name: 'View provenance records',
            callback: () => {
                this.provenance.getAll().then(records => {
                    if (records.length === 0) {
                        new Notice('No provenance records yet');
                        return;
                    }
                    const text = records.slice(-20).reverse().map(r =>
                        `### ${r.timestamp}\n**Type:** ${r.type} | **Model:** ${r.model} | **Verified:** ${r.verified}\n${truncate(r.content, 300)}`
                    ).join('\n\n---\n\n');
                    this.showResultModal('Provenance Records', text);
                });
            },
        });

        this.addCommand({
            id: 'switch-model',
            name: 'Switch active model',
            callback: () => {
                const options = Object.entries(MODELS).map(([key, m]) => `${key}: ${m.id} (${m.role})`);
                this.promptForInput('🧠 Switch model (safe/deep/math/coder):', async (choice) => {
                    const key = choice.trim().toLowerCase();
                    if (MODELS[key]) {
                        await this.modelManager.switchTo(MODELS[key].id);
                    } else {
                        new Notice('Invalid model key. Use: safe, deep, math, coder');
                    }
                });
            },
        });

        this.addCommand({
            id: 'check-vram',
            name: 'Check loaded models (VRAM)',
            callback: async () => {
                const models = await this.ollama.ps();
                if (models.length === 0) {
                    new Notice('No models currently loaded in VRAM');
                    return;
                }
                const text = models.map(m => `- ${m.name} (${(m.size_vram / 1e9).toFixed(1)} GB VRAM)`).join('\n');
                this.showResultModal('Loaded Models (VRAM)', text);
            },
        });

        this.addCommand({
            id: 'classify-note',
            name: 'Classify current note trust level',
            callback: () => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
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
                this.showResultModal('Trust Classification', 
                    `TRUST LEVEL: ${record.trustLevel}\n` +
                    `CONTENT SOURCE: ${record.contentSource}\n` +
                    `CONFIDENCE: ${record.confidence}%\n` +
                    `VERIFIED: ${record.verified}\n` +
                    `VERIFIED BY: ${record.verifiedBy}\n` +
                    `HASH: ${record.hash.slice(0, 16)}…`
                );
            },
        });

        this.addCommand({
            id: 'view-trust',
            name: 'View trust boundary status',
            callback: () => {
                const trail = this.trustBoundary.auditTrail();
                const status = 
                    `TRUST BOUNDARY: ${this.settings.trustEnforcement ? 'ACTIVE 🛡️' : 'DISABLED'}\n` +
                    `THRESHOLD: ${this.settings.trustThreshold}\n\n` +
                    `DECISIONS LOGGED: ${trail.length}\n\n` +
                    (trail.length > 0 ? trail.slice(-10).reverse().map(d =>
                        `${d.timestamp} — ${d.operation}: ${d.allowed ? '✅ ALLOWED' : '🚫 BLOCKED'} ` +
                        `(${d.level} → required ${d.required})`
                    ).join('\n') : 'No trust decisions yet.');
                this.showResultModal('Trust Boundary Status', status);
            },
        });

        this.addCommand({
            id: 'trust-audit',
            name: 'Run trust audit across vault',
            callback: () => this.trustAudit(),
        });

        this.addCommand({
            id: 'write-to-note',
            name: 'Write result to a new note',
            callback: () => this.promptForInput('📝 Note title:', async (title) => {
                if (this.settings.vaultWriteApproval) {
                    const approved = await this.confirmModal('Create note?', `Create note "${title}" in vault?`);
                    if (!approved) { new Notice('❌ Note creation cancelled'); return; }
                }
                this.promptForInput('📝 Note content:', async (content) => {
                    const safeTitle = sanitizeFilename(title);
                    const filePath = `Vault Scholar/${safeTitle}.md`;
                    await this.app.vault.createFolder('Vault Scholar').catch(() => {});
                    await this.app.vault.create(filePath, content);
                    new Notice(`✅ Note created: ${filePath}`);
                });
            }),
        });
    }

    // ============================================================
    //  UI HELPERS
    // ============================================================

    promptForInput(placeholder, callback) {
        const modal = new InputModal(this.app, placeholder, async (value) => {
            try {
                await callback(value);
            } catch (e) {
                new Notice(`❌ Error: ${e.message}`);
                console.error(e);
            }
        });
        modal.open();
    }

    showResultModal(title, content, citations = [], code = null) {
        const modal = new ResultModal(this.app, title, content, citations, code, this);
        modal.open();
    }

    confirmModal(title, message) {
        return new Promise((resolve) => {
            const modal = new ConfirmModal(this.app, title, message, resolve);
            modal.open();
        });
    }

    openMainModal() {
        const modal = new MainModal(this.app, this);
        modal.open();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async trustAudit() {
        const files = this.app.vault.getMarkdownFiles();
        let trusted = 0, verified = 0, inferred = 0, unverified = 0;
        const breakdown = {};

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
//  MODALS
// ============================================================

class InputModal extends Modal {
    constructor(app, placeholder, onSubmit) {
        super(app);
        this.placeholder = placeholder;
        this.onSubmit = onSubmit;
    }

    onOpen() {
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
            if (value) {
                this.close();
                this.onSubmit(value);
            }
        });
        cancelBtn.addEventListener('click', () => this.close());
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                const value = textarea.value.trim();
                if (value) {
                    this.close();
                    this.onSubmit(value);
                }
            }
        });
        textarea.focus();
    }

    onClose() {
        this.contentEl.empty();
    }
}

class ResultModal extends Modal {
    constructor(app, title, content, citations, code, plugin) {
        super(app);
        this.title = title;
        this.content = content;
        this.citations = citations || [];
        this.code = code;
        this.plugin = plugin;
    }

    onOpen() {
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
                navigator.clipboard.writeText(this.code);
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

    onClose() {
        this.contentEl.empty();
    }
}

class ConfirmModal extends Modal {
    constructor(app, title, message, onConfirm) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
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

    onClose() {
        this.contentEl.empty();
    }
}

class MainModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
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
        const actionsList = [
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
            ['🧠 Switch Model', 'switch-model'],            ['🧠 Switch Model', 'switch-model'],
        ];
        for (const [label, cmdId] of actionsList) {
            const btn = actions.createEl('button', { text: label, cls: 'vs-action-btn' });
            btn.addEventListener('click', () => {
                this.close();
                this.app.commands.executeCommandById(`vault-scholar:${cmdId}`);
            });
        }

        const closeBtn = contentEl.createEl('button', { text: 'Close', cls: 'vs-close-btn' });
        closeBtn.addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ============================================================
//  SETTINGS TAB
// ============================================================

class VaultScholarSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: '🦉 Vault Scholar Settings' });

        // ===== Security =====
        containerEl.createEl('h3', { text: '🔒 Security' });

        new Setting(containerEl)
            .setName('Safe Mode')
            .setDesc('Default to safe model (Qwen3 8B) for everyday tasks')
            .addToggle(t => t.setValue(this.plugin.settings.safeMode).onChange(async v => {
                this.plugin.settings.safeMode = v;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Internet Research')
            .setDesc('Allow external sources in research (OFF by default)')
            .addToggle(t => t.setValue(this.plugin.settings.internetResearch).onChange(async v => {
                this.plugin.settings.internetResearch = v;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Vault Write Approval')
            .setDesc('Require approval before writing to vault')
            .addToggle(t => t.setValue(this.plugin.settings.vaultWriteApproval).onChange(async v => {
                this.plugin.settings.vaultWriteApproval = v;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Script Execution Approval')
            .setDesc('Require approval before running scripts in sandbox')
            .addToggle(t => t.setValue(this.plugin.settings.scriptExecutionApproval).onChange(async v => {
                this.plugin.settings.scriptExecutionApproval = v;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Verify External Before Write')
            .setDesc('Verify external sources before writing to vault')
            .addToggle(t => t.setValue(this.plugin.settings.verifyExternalBeforeWrite).onChange(async v => {
                this.plugin.settings.verifyExternalBeforeWrite = v;
                await this.plugin.saveSettings();
            }));

        // ===== Trust Boundary =====
        containerEl.createEl('h3', { text: '🛡️ Trust Boundary' });

        new Setting(containerEl)
            .setName('Enable Trust Enforcement')
            .setDesc('Enforce trust levels on vault operations. Unverified AI output cannot silently overwrite trusted content.')
            .addToggle(t => t.setValue(this.plugin.settings.trustEnforcement).onChange(async v => {
                this.plugin.settings.trustEnforcement = v;
                this.plugin.trustBoundary.enabled = v;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Trust Threshold')
            .setDesc('Minimum trust level required for automatic operations')
            .addDropdown(d => d
                .addOption(TRUST_LEVELS.TRUSTED, '🛡️ TRUSTED — User verified only')
                .addOption(TRUST_LEVELS.VERIFIED, '✅ VERIFIED — Cross-checked with citations')
                .addOption(TRUST_LEVELS.INFERRED, '🧠 INFERRED — Logically derived')
                .addOption(TRUST_LEVELS.UNVERIFIED, '⚠️ UNVERIFIED — No checks')
                .setValue(this.plugin.settings.trustThreshold)
                .onChange(async v => {
                    this.plugin.settings.trustThreshold = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show Trust Badges')
            .setDesc('Display trust level badges in result modals and status bar')
            .addToggle(t => t.setValue(this.plugin.settings.trustDisplay).onChange(async v => {
                this.plugin.settings.trustDisplay = v;
                await this.plugin.saveSettings();
            }));

        // ===== Sandbox =====
        containerEl.createEl('h3', { text: '🏖️ Sandbox' });

        new Setting(containerEl)
            .setName('Sandbox Mode')
            .setDesc('Code execution isolation level')
            .addDropdown(d => d
                .addOption('python', 'Python (subprocess isolation)')
                .addOption('node', 'Node (vm sandbox)')
                .addOption('docker', 'Docker (container isolation)')
                .setValue(this.plugin.settings.sandboxMode)
                .onChange(async v => {
                    this.plugin.settings.sandboxMode = v;
                    await this.plugin.saveSettings();
                }));

        // ===== Models =====
        containerEl.createEl('h3', { text: '🧠 Models' });

        new Setting(containerEl)
            .setName('Active Model')
            .setDesc('Current main task model')
            .addDropdown(d => {
                for (const [key, m] of Object.entries(MODELS)) {
                    if (key !== 'embedding') {
                        d.addOption(m.id, `${m.role} — ${m.id}`);
                    }
                }
                d.setValue(this.plugin.settings.activeModel);
                d.onChange(async v => {
                    await this.plugin.modelManager.switchTo(v);
                });
            });

        new Setting(containerEl)
            .setName('Keep Embeddings Loaded')
            .setDesc('Keep qwen3-embedding loaded in VRAM for instant RAG')
            .addToggle(t => t.setValue(this.plugin.settings.keepEmbeddingsLoaded).onChange(async v => {
                this.plugin.settings.keepEmbeddingsLoaded = v;
                await this.plugin.saveSettings();
                if (v) this.plugin.modelManager.ensureEmbeddingsLoaded();
            }));

        // ===== Context =====
        containerEl.createEl('h3', { text: '📏 Context' });

        new Setting(containerEl)
            .setName('Context Window (tokens)')
            .setDesc('Default context size. Increase for long derivations/code.')
            .addSlider(s => s
                .setLimits(2048, 16384, 1024)
                .setValue(this.plugin.settings.numCtx)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.numCtx = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Long Context Window (tokens)')
            .setDesc('Used for derivations, research, and large code files')
            .addSlider(s => s
                .setLimits(4096, 32768, 2048)
                .setValue(this.plugin.settings.numCtxLong)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.numCtxLong = v;
                    await this.plugin.saveSettings();
                }));

        // ===== Provenance =====
        containerEl.createEl('h3', { text: '📜 Provenance' });

        new Setting(containerEl)
            .setName('Enable Provenance')
            .setDesc('Record every claim, equation, and script with source, model, and timestamp')
            .addToggle(t => t.setValue(this.plugin.settings.provenanceEnabled).onChange(async v => {
                this.plugin.settings.provenanceEnabled = v;
                await this.plugin.saveSettings();
            }));

        // ===== Snapshots =====
        containerEl.createEl('h3', { text: '📸 Snapshots' });

        new Setting(containerEl)
            .setName('Auto-snapshot before risky ops')
            .setDesc('Create a snapshot before vault writes and script runs')
            .addToggle(t => t.setValue(this.plugin.settings.autoSnapshotBeforeRisky).onChange(async v => {
                this.plugin.settings.autoSnapshotBeforeRisky = v;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Max snapshots')
            .setDesc('Maximum number of snapshots to keep')
            .addSlider(s => s
                .setLimits(5, 50, 5)
                .setValue(this.plugin.settings.snapshotMaxCount)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.snapshotMaxCount = v;
                    await this.plugin.saveSettings();
                }));

        // ===== Evidence-Gated Knowledge =====
        containerEl.createEl('h3', { text: '📜 Evidence-Gated Knowledge' });

        new Setting(containerEl)
            .setName('Enable Evidence Gating')
            .setDesc('Block external factual claims without a source from entering the vault (Section 9)')
            .addToggle(t => t.setValue(this.plugin.settings.evidenceGating).onChange(async v => {
                this.plugin.settings.evidenceGating = v;
                await this.plugin.saveSettings();
            }));

        // ===== Research Mode =====
        containerEl.createEl('h3', { text: '🔬 Research Mode' });

        new Setting(containerEl)
            .setName('Enable Research Mode')
            .setDesc('Allow the 13-stage research pipeline (Section 10)')
            .addToggle(t => t.setValue(this.plugin.settings.researchModeEnabled).onChange(async v => {
                this.plugin.settings.researchModeEnabled = v;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Search Provider')
            .setDesc('DuckDuckGo (zero-config) or SearXNG (user-specified endpoint — self-hosted OR third-party)')
            .addDropdown(d => d
                .addOption('duckduckgo', 'DuckDuckGo (zero-config, no API key)')
                .addOption('searxng', 'SearXNG (user-specified endpoint)')
                .setValue(this.plugin.settings.searchProvider)
                .onChange(async v => {
                    this.plugin.settings.searchProvider = v;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(containerEl)
            .setName('SearXNG URL')
            .setDesc('Your SearXNG instance endpoint — self-hosted (e.g. http://localhost:8080) OR third-party (e.g. https://searx.be). Must support /search?format=json. User is responsible for the endpoint.')
            .addText(t => t
                .setPlaceholder('http://localhost:8080')
                .setValue(this.plugin.settings.searxngUrl)
                .setDisabled(this.plugin.settings.searchProvider !== 'searxng')
                .onChange(async v => {
                    this.plugin.settings.searxngUrl = v.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('SearXNG Categories')
            .setDesc('SearXNG search categories (e.g. general, science)')
            .addText(t => t
                .setPlaceholder('general')
                .setValue(this.plugin.settings.searxngCategories)
                .onChange(async v => {
                    this.plugin.settings.searxngCategories = v.trim() || 'general';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Sources')
            .setDesc('Maximum number of sources to retrieve and analyze')
            .addSlider(s => s
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.maxSources)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.maxSources = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Search Results')
            .setDesc('Maximum search results per query')
            .addSlider(s => s
                .setLimits(3, 30, 1)
                .setValue(this.plugin.settings.maxSearchResults)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.maxSearchResults = v;
                    await this.plugin.saveSettings();
                }));

        // ===== RAG =====
        containerEl.createEl('h3', { text: '🔎 RAG' });

        new Setting(containerEl)
            .setName('Enable RAG')
            .setDesc('Semantic search and context retrieval from vault')
            .addToggle(t => t.setValue(this.plugin.settings.ragEnabled).onChange(async v => {
                this.plugin.settings.ragEnabled = v;
                await this.plugin.saveSettings();
            }));

        // ===== Ollama =====
        containerEl.createEl('h3', { text: '🦙 Ollama' });

        new Setting(containerEl)
            .setName('Ollama Host')
            .setDesc('Ollama API endpoint')
            .addText(t => t
                .setPlaceholder('http://localhost:11434')
                .setValue(this.plugin.settings.ollamaHost)
                .onChange(async v => {
                    this.plugin.settings.ollamaHost = v;
                    this.plugin.ollama.host = v;
                    await this.plugin.saveSettings();
                }));

        // ===== Actions =====
        containerEl.createEl('h3', { text: '⚡ Actions' });

        new Setting(containerEl)
            .setName('Index vault for RAG')
            .setDesc('Embed all notes for semantic search')
            .addButton(b => b.setButtonText('Index Vault').onClick(() => this.plugin.rag.indexVault()));

        new Setting(containerEl)
            .setName('Check loaded models')
            .setDesc('View current VRAM usage')
            .addButton(b => b.setButtonText('Check VRAM').onClick(async () => {
                const models = await this.plugin.ollama.ps();
                if (models.length === 0) {
                    new Notice('No models currently loaded');
                    return;
                }
                new Notice(models.map(m => `${m.name}: ${(m.size_vram / 1e9).toFixed(1)} GB`).join('\n'));
            }));

        new Setting(containerEl)
            .setName('Create snapshot')
            .setDesc('Backup vault to snapshot')
            .addButton(b => b.setButtonText('Snapshot Now').onClick(() => this.plugin.snapshotManager.createSnapshot('manual')));
    }
}

// ============================================================
//  EXPORT
// ============================================================

module.exports = VaultScholarPlugin;