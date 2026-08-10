// ============================================================
//  Research Mode Engine (Phase 10)
//
//  Implements the 13-stage research pipeline:
//
//    Question → Query Expansion → Internet Search → Source Discovery →
//    Source Trust Classification → Source Retrieval → Evidence Extraction →
//    Cross-Source Comparison → Contradiction Detection → Answer Generation →
//    Citation Validation → Vault Proposal
//
//  Search providers are pluggable. Two built-in providers:
//    - 'duckduckgo' (default, zero-config, no API key)
//    - 'searxng'    (user-specified endpoint — self-hosted OR third-party;
//                    must support the JSON output API /search?format=json)
//
//  Downstream stages are provider-agnostic: they operate on a
//  normalized { url, title, snippet } structure.
//
//  Zero-dependency: uses requestUrl (Obsidian) or fetch when
//  available; tests inject a mocked fetcher.
// ============================================================

import { EvidenceGate, CLAIM_ORIGIN, normalizeUrl, isUrlLike, stripHtml, decodeEntities } from './evidence';
import { TrustClassifier, TRUST_LEVELS, CONTENT_SOURCES, TrustBoundary, TrustRecord } from './trust';
import { sha256 } from './cas';

// ------------------------------------------------------------------
//  Types
// ------------------------------------------------------------------

export interface SearchResult {
    url: string;
    title: string;
    snippet: string;
}

export interface RankedSearchResult extends SearchResult {
    trust: string;
    domain: string | null;
}

export interface SourceClassification {
    trust: string;
    domain: string | null;
    reason: string;
}

export interface RetrievedSource extends RankedSearchResult {
    content: string;
}

export interface EvidenceItem {
    claim: string;
    source: string;
    url: string;
    trust: string;
}

export interface Contradiction {
    topic: string;
    claimA: string;
    claimB: string;
    urlA: string;
    urlB: string;
    note: string;
}

export interface ResearchState {
    question: string;
    stages: Record<string, Record<string, unknown>>;
    sources: SearchResult[];
    rankedSources: RankedSearchResult[];
    retrieved: RetrievedSource[];
    extracted: EvidenceItem[];
    contradictions: Contradiction[];
    answer: string;
    citations: string[];
    vaultProposal: string;
    errors: string[];
}

export interface ResearchModeDeps {
    createFetcher?: () => (url: string) => Promise<string | { text?: string }>;
    generate?: (model: string, prompt: string, opts?: Record<string, unknown>) => Promise<string>;
    modelId?: string;
    settings?: Partial<ResearchModeSettings>;
    trustBoundary?: TrustBoundary | null;
}

export interface ResearchModeSettings {
    searchProvider: string;
    searxngUrl: string;
    searxngCategories: string;
    searxngMaxResults: number;
    maxSources: number;
    maxSearchResults: number;
    numCtxLong?: number;
}

export interface ResearchOptions {
    onStage?: (name: string, stage: Record<string, unknown>) => void;
}

// ------------------------------------------------------------------
//  Source Trust Classification
// ------------------------------------------------------------------

export const SOURCE_TRUST = {
    HIGH:   'HIGH',
    MEDIUM: 'MEDIUM',
    LOW:    'LOW',
} as const;

export type SourceTrust = typeof SOURCE_TRUST[keyof typeof SOURCE_TRUST];

// Domain ranking is a local heuristic. arxiv, .gov, .edu, etc. are
// considered HIGH; wikipedia/major news MEDIUM; blogs/forums LOW.
const HIGH_DOMAIN_RE = /(^|\.)(arxiv\.org|gov|edu|ac\.|scholar\.google\.com|doi\.org|nature\.com|sciencemag\.org|cell\.com|nejm\.org|pubmed\.ncbi\.nlm\.nih\.gov|phys\.org)$/i;
const MEDIUM_DOMAIN_RE = /(^|\.)(wikipedia\.org|bbc\.com|cnn\.com|reuters\.com|apnews\.com|nytimes\.com|theguardian\.com|economist\.com|npr\.org|pbs\.org|medium\.com|github\.io|stackexchange\.com|stackoverflow\.com)$/i;
const LOW_DOMAIN_RE = /(^|\.)(blogspot\.com|wordpress\.com|tumblr\.com|reddit\.com|quora\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com)$/i;

export class SourceClassifier {
    /**
     * Classify a source URL's trust level (heuristic, local).
     */
    static classify(url: string): SourceClassification {
        const u = normalizeUrl(url);
        if (!u) {
            return { trust: SOURCE_TRUST.LOW, domain: null, reason: 'Invalid or missing URL' };
        }
        let host: string;
        try { host = new URL(u).hostname; } catch { return { trust: SOURCE_TRUST.LOW, domain: null, reason: 'Invalid URL' }; }
        host = host.toLowerCase().replace(/^www\./, '');

        if (HIGH_DOMAIN_RE.test(host)) {
            return { trust: SOURCE_TRUST.HIGH, domain: host, reason: 'High-authority domain (arxiv/gov/edu/academic)' };
        }
        if (MEDIUM_DOMAIN_RE.test(host)) {
            return { trust: SOURCE_TRUST.MEDIUM, domain: host, reason: 'Medium-authority domain (encyclopedia/major news)' };
        }
        if (LOW_DOMAIN_RE.test(host)) {
            return { trust: SOURCE_TRUST.LOW, domain: host, reason: 'Low-authority domain (blog/forum/social)' };
        }
        return { trust: SOURCE_TRUST.MEDIUM, domain: host, reason: 'Unknown domain — medium default' };
    }

    /**
     * Rank results by trust (HIGH first), stable within tiers.
     */
    static rank(results: SearchResult[]): RankedSearchResult[] {
        const ranked: RankedSearchResult[] = (results || []).map(r => {
            const c = SourceClassifier.classify(r.url);
            return { ...r, trust: c.trust, domain: c.domain };
        });
        const order: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        ranked.sort((a, b) => (order[b.trust] || 0) - (order[a.trust] || 0));
        return ranked;
    }
}

// ------------------------------------------------------------------
//  Search Providers
// ------------------------------------------------------------------

export type Fetcher = (url: string) => Promise<string | { text?: string }>;

export interface SearchProvider {
    search(query: string, maxResults?: number): Promise<SearchResult[]>;
}

export class DuckDuckGoProvider implements SearchProvider {
    fetcher: Fetcher;

    constructor(fetcher: Fetcher) {
        this.fetcher = fetcher;
    }

    /**
     * Search DuckDuckGo Lite HTML endpoint (no API key).
     */
    async search(query: string, maxResults = 10): Promise<SearchResult[]> {
        const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
        const raw = await this.fetcher(url);
        const html = typeof raw === 'string' ? raw : String(raw.text || '');
        const results: SearchResult[] = [];
        // Parse result links: <a class="result__a" href="...">Title</a>
        const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
        const links: Array<{ href: string; title: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(html)) !== null && links.length < maxResults) {
            links.push({ href: decodeEntities(m[1]), title: stripHtml(decodeEntities(m[2])) });
        }
        const snippets: string[] = [];
        while ((m = snippetRe.exec(html)) !== null && snippets.length < maxResults) {
            snippets.push(stripHtml(decodeEntities(m[1])));
        }
        for (let i = 0; i < links.length; i++) {
            const cleanUrl = cleanSearchUrl(links[i].href);
            if (!cleanUrl) continue;
            results.push({
                url: cleanUrl,
                title: links[i].title || '(untitled)',
                snippet: snippets[i] || '',
            });
        }
        return results.slice(0, maxResults);
    }
}

export class SearXNGProvider implements SearchProvider {
    fetcher: Fetcher;
    baseUrl: string;
    categories: string;
    maxResults: number;

    constructor(fetcher: Fetcher, baseUrl: string, categories = 'general', maxResults = 10) {
        this.fetcher = fetcher;
        this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
        this.categories = categories || 'general';
        this.maxResults = maxResults || 10;
    }

    /**
     * Search a SearXNG instance JSON API.
     * User-specified endpoint — self-hosted OR third-party.
     * The user owns responsibility for the endpoint they configure.
     *
     * GET {baseUrl}/search?q={query}&format=json&categories={categories}
     */
    async search(query: string): Promise<SearchResult[]> {
        if (!this.baseUrl) {
            throw new Error('SearXNG URL not configured. Set "SearXNG URL" in Vault Scholar settings.');
        }
        const url = this.baseUrl + '/search?q=' + encodeURIComponent(query) +
            '&format=json&categories=' + encodeURIComponent(this.categories);
        const json = await this.fetcher(url);
        let data: { results?: Array<{ url?: string; title?: string; content?: string; snippet?: string }> };
        try {
            data = typeof json === 'string' ? JSON.parse(json) : (json as { results?: Array<{ url?: string; title?: string; content?: string; snippet?: string }> });
        } catch {
            throw new Error('SearXNG returned invalid JSON — check that the endpoint supports /search?format=json');
        }
        const rawResults = (data && data.results) || [];
        const results: SearchResult[] = [];
        for (const r of rawResults) {
            const u = normalizeUrl(r.url || '');
            if (!u) continue;
            results.push({
                url: u,
                title: stripHtml(decodeEntities(r.title || '(untitled)')),
                snippet: stripHtml(decodeEntities(r.content || r.snippet || '')),
            });
            if (results.length >= this.maxResults) break;
        }
        return results;
    }
}

export function createSearchProvider(providerName: string, fetcher: Fetcher, settings: Partial<ResearchModeSettings> = {}): SearchProvider {
    const name = String(providerName || 'duckduckgo').toLowerCase();
    if (name === 'searxng') {
        return new SearXNGProvider(fetcher, settings.searxngUrl || '', settings.searxngCategories, settings.searxngMaxResults);
    }
    return new DuckDuckGoProvider(fetcher);
}

function cleanSearchUrl(href: string): string | null {
    if (!href) return null;
    // DuckDuckGo wraps redirects in //duckduckgo.com/l/?uddg=...
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg) {
        try {
            return decodeURIComponent(uddg[1]);
        } catch { /* fallthrough */ }
    }
    return normalizeUrl(href);
}

// ------------------------------------------------------------------
//  ResearchMode — the full 13-stage pipeline
// ------------------------------------------------------------------

const MAX_FETCH_BYTES = 1024 * 1024; // 1 MB cap on retrieved text

export class ResearchMode {
    fetcher: Fetcher | null;
    generate: ((model: string, prompt: string, opts?: Record<string, unknown>) => Promise<string>) | null;
    modelId: string;
    settings: ResearchModeSettings;
    trustBoundary: TrustBoundary | null;
    _lastState: ResearchState | null;

    constructor(deps: ResearchModeDeps = {}) {
        this.fetcher = deps.createFetcher ? deps.createFetcher() : null;
        this.generate = deps.generate || null;
        this.modelId = deps.modelId || 'qwen3:8b';
        this.settings = Object.assign({
            searchProvider: 'duckduckgo',
            searxngUrl: '',
            searxngCategories: 'general',
            searxngMaxResults: 10,
            maxSources: 5,
            maxSearchResults: 10,
        }, deps.settings || {});
        this.trustBoundary = deps.trustBoundary || null;
        this._lastState = null;
    }

    /**
     * Run the full research pipeline.
     */
    async research(question: string, opts: ResearchOptions = {}): Promise<ResearchState> {
        const state: ResearchState = {
            question: String(question || '').trim(),
            stages: {},
            sources: [],
            rankedSources: [],
            retrieved: [],
            extracted: [],
            contradictions: [],
            answer: '',
            citations: [],
            vaultProposal: '',
            errors: [],
        };

        const runStage = async (name: string, fn: () => unknown): Promise<unknown> => {
            try {
                state.stages[name] = { status: 'running' };
                if (opts.onStage) opts.onStage(name, state.stages[name]);
                const result = await fn();
                state.stages[name] = { status: 'done', ...(result as Record<string, unknown>) };
                if (opts.onStage) opts.onStage(name, state.stages[name]);
                return result;
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                state.stages[name] = { status: 'error', error: msg };
                state.errors.push(name + ': ' + msg);
                throw e;
            }
        };

        // ---- Stage 1: Query Expansion ----
        const expansions = await runStage('queryExpansion', () => this.queryExpansion(state.question)) as string[];
        state.stages.queryExpansion.queries = expansions;

        // ---- Stage 2: Internet Search (per expanded query) ----
        const allRaw: SearchResult[] = [];
        for (const q of expansions) {
            const raw = await runStage('internetSearch', () => this.internetSearch(q)) as SearchResult[];
            allRaw.push(...raw);
        }
        const seenUrls = new Set<string>();
        state.sources = allRaw.filter(s => {
            if (!s || !s.url || seenUrls.has(s.url)) return false;
            seenUrls.add(s.url);
            return true;
        });

        // ---- Stage 3-4: Source Discovery + Trust Classification ----
        await runStage('sourceDiscovery', () => {
            const ranked = SourceClassifier.rank(state.sources).slice(0, this.settings.maxSources || 5);
            state.rankedSources = ranked;
            return { count: ranked.length, top: ranked.slice(0, 3) };
        });

        await this.continueResearch(state, opts, runStage);
        this._lastState = state;
        return state;
    }

    /**
     * Pipeline stages 5-12 (continued from research()).
     * Kept as a separate method so research() stays readable.
     */
    async continueResearch(state: ResearchState, opts: ResearchOptions, runStage: (name: string, fn: () => unknown) => Promise<unknown>): Promise<void> {
        // ---- Stage 5-6: Source Retrieval ----
        await runStage('sourceRetrieval', async () => {
            const retrieved: RetrievedSource[] = [];
            for (const src of state.rankedSources) {
                try {
                    const text = await this.retrieveSource(src.url);
                    retrieved.push({ ...src, content: text });
                } catch (e) {
                    state.errors.push('retrieve ' + src.url + ': ' + (e instanceof Error ? e.message : String(e)));
                }
            }
            state.retrieved = retrieved;
            return { count: retrieved.length };
        });

        // ---- Stage 7: Evidence Extraction ----
        await runStage('evidenceExtraction', () => {
            const extracted = this.extractEvidence(state.retrieved);
            state.extracted = extracted;
            return { count: extracted.length };
        });

        // ---- Stage 8-9: Contradiction Detection ----
        await runStage('contradictionDetection', () => {
            const contradictions = this.detectContradictions(state.extracted);
            state.contradictions = contradictions;
            return { count: contradictions.length, contradictions };
        });

        // ---- Stage 10: Answer Generation ----
        await runStage('answerGeneration', async () => {
            const answer = await this.generateAnswer(state);
            state.answer = answer;
            return { length: answer.length };
        });

        // ---- Stage 11: Citation Validation ----
        await runStage('citationValidation', () => {
            const citations = this.validateCitations(state.answer, state.retrieved);
            state.citations = citations;
            return { count: citations.length, citations };
        });

        // ---- Stage 12: Vault Proposal ----
        await runStage('vaultProposal', () => {
            const proposal = this.buildVaultProposal(state);
            state.vaultProposal = proposal;
            const gate = EvidenceGate.validateNote(proposal);
            return { proposalLength: proposal.length, gate };
        });
    }

    /**
     * Stage 1 — Expand the user question into search queries.
     * Uses the LLM if available; otherwise falls back to keyword variants.
     */
    async queryExpansion(question: string): Promise<string[]> {
        if (this.generate) {
            const prompt = [
                'You are a research query expansion assistant.',
                'Given the user question, generate 3 concise search queries (one per line, no numbering, no bullets).',
                '',
                'QUESTION:',
                question,
                '',
                'QUERIES:',
            ].join('\n');
            try {
                const out = await this.generate(this.modelId, prompt, { temperature: 0.3 });
                const lines = String(out || '').split('\n')
                    .map(l => l.trim())
                    .filter(l => l && !/^\d+[.)]/.test(l))
                    .slice(0, 5);
                if (lines.length >= 1) return lines;
            } catch { /* fall back */ }
        }
        // Fallback heuristic expansion
        return [question, question + ' research paper', question + ' evidence summary'];
    }

    /**
     * Stage 2 — Internet search via the configured provider.
     * Requires the fetcher; otherwise throws (fail closed).
     */
    async internetSearch(query: string): Promise<SearchResult[]> {
        if (!this.fetcher) {
            throw new Error('No network fetcher available — internet search is disabled');
        }
        const provider = createSearchProvider(
            this.settings.searchProvider,
            this.fetcher,
            this.settings
        );
        const maxResults = this.settings.maxSearchResults || 10;
        return provider.search(query, maxResults);
    }

    /**
     * Stage 3/4 — Source discovery + trust classification.
     * Exposed separately for testability; research() uses
     * SourceClassifier.rank directly.
     */
    sourceDiscovery(sources: SearchResult[]): RankedSearchResult[] {
        return SourceClassifier.rank(sources);
    }

    /**
     * Stage 5 — Retrieve a single source's text content.
     * Coerces the fetcher result to text; caps at MAX_FETCH_BYTES.
     */
    async retrieveSource(url: string): Promise<string> {
        if (!this.fetcher) throw new Error('No network fetcher available');
        const raw = await this.fetcher(url);
        let text: string;
        if (typeof raw === 'string') {
            text = stripHtml(raw);
        } else if (raw && typeof raw === 'object' && raw.text !== undefined) {
            text = stripHtml(String(raw.text));
        } else {
            text = stripHtml(String(raw));
        }
        return text.slice(0, MAX_FETCH_BYTES);
    }

    /**
     * Stage 7 — Extract evidence (claim-like sentences) from retrieved content.
     */
    extractEvidence(retrieved: RetrievedSource[]): EvidenceItem[] {
        const out: EvidenceItem[] = [];
        for (const src of (retrieved || [])) {
            if (!src.content) continue;
            const sentences = String(src.content)
                .split(/(?<=[.!?])\s+/)
                .map(s => s.trim())
                .filter(s => s.length > 40 && s.length < 400);
            for (const s of sentences.slice(0, 8)) {
                out.push({ claim: s, source: src.title || src.url, url: src.url, trust: src.trust || 'MEDIUM' });
            }
        }
        return out;
    }

    /**
     * Stage 8-9 — Detect contradictions across sources.
     * Heuristic: for claims sharing a topic keyword, one negates the other.
     */
    detectContradictions(extracted: EvidenceItem[]): Contradiction[] {
        const items = (extracted || []).filter(Boolean);
        const contradictions: Contradiction[] = [];
        const NEGATION = /\b(not|no|never|without|unlike|contrary|invalid|false|disprove|refute|fails?)\b/i;

        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const a = items[i];
                const b = items[j];
                if (a.url === b.url) continue;
                const topicA = extractTopic(a.claim);
                const topicB = extractTopic(b.claim);
                if (!topicA || topicA !== topicB) continue;
                const negA = NEGATION.test(a.claim);
                const negB = NEGATION.test(b.claim);
                if (negA !== negB) {
                    contradictions.push({
                        topic: topicA,
                        claimA: truncateText(a.claim, 200),
                        claimB: truncateText(b.claim, 200),
                        urlA: a.url,
                        urlB: b.url,
                        note: 'Sources disagree on "' + topicA + '"',
                    });
                }
            }
        }
        return contradictions.slice(0, 10);
    }

    /**
     * Stage 10 — Generate the final answer.
     * Requires the LLM; otherwise produces a structured fallback from
     * the retrieved evidence (still fully source-tagged).
     */
    async generateAnswer(state: ResearchState): Promise<string> {
        const sourcesText = state.retrieved.map((s, i) =>
            '[' + (i + 1) + '] ' + s.url + '\n' + truncateText(s.content || '', 2000)
        ).join('\n\n---\n\n');

        if (!this.generate) {
            // Fallback: structured synthesis from extracted evidence.
            const lines: string[] = [];
            lines.push('## Answer Summary');
            lines.push('');
            for (const e of state.extracted.slice(0, 10)) {
                lines.push('- ' + e.claim + ' [SOURCE: ' + e.url + ']');
            }
            if (state.contradictions.length > 0) {
                lines.push('');
                lines.push('## Contradictions Found');
                lines.push('');
                for (const c of state.contradictions) {
                    lines.push('- [CONTRADICTION: ' + truncateText(c.topic, 120) + ']');
                    lines.push('  - ' + truncateText(c.claimA, 150) + ' (' + c.urlA + ')');
                    lines.push('  - ' + truncateText(c.claimB, 150) + ' (' + c.urlB + ')');
                }
            }
            return lines.join('\n');
        }

        const prompt = [
            'You are a rigorous research assistant. Synthesize an evidence-based answer.',
            'IMPORTANT: Every factual claim must be followed by a source citation in the form [SOURCE: url].',
            'If any retrieved source contradicts another, state the contradiction explicitly with [CONTRADICTION: ...].',
            'Do not invent sources. Only cite the URLs provided below.',
            '',
            'QUESTION:',
            state.question,
            '',
            'RETRIEVED SOURCES:',
            sourcesText,
            '',
            'Provide:',
            '1. Executive summary',
            '2. Key findings (each cited with [SOURCE: url])',
            '3. Contradictions (if any) with [CONTRADICTION: ...]',
            '4. Gaps and open questions',
            '',
            'ANSWER:',
        ].join('\n');

        const answer = await this.generate(this.modelId, prompt, {
            temperature: 0.2,
            numCtx: this.settings.numCtxLong || 8192,
        });
        return String(answer || '').trim();
    }

    /**
     * Stage 11 — Validate citations: only URLs that were actually
     * retrieved in this run survive. Others are dropped.
     */
    validateCitations(answer: string, retrieved: RetrievedSource[]): string[] {
        const validUrls = new Set((retrieved || []).map(s => s.url).filter(Boolean));
        const cited: string[] = [];
        const re = /\[SOURCE:\s*([^\]]+)\]/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(String(answer || ''))) !== null) {
            const raw = m[1].trim();
            // Split comma-separated sources
            for (const part of raw.split(',')) {
                const u = normalizeUrl(part.trim());
                if (u && validUrls.has(u) && !cited.includes(u)) cited.push(u);
            }
        }
        return cited;
    }

    /**
     * Stage 12 — Build an evidence-gated markdown vault proposal.
     */
    buildVaultProposal(state: ResearchState): string {
        const lines: string[] = [];
        lines.push('---');
        lines.push('title: ' + summarize(state.question, 60));
        lines.push('type: research');
        lines.push('created: ' + new Date().toISOString().slice(0, 10));
        lines.push('research-provider: ' + (this.settings.searchProvider || 'duckduckgo'));
        lines.push('sources: ' + state.retrieved.length);
        lines.push('tags:');
        lines.push('  - research');
        lines.push('---');
        lines.push('');
        lines.push('# ' + summarize(state.question, 80));
        lines.push('');
        lines.push('## Answer Summary');
        lines.push('');
        for (const e of state.extracted.slice(0, 10)) {
            lines.push('- ' + e.claim + ' [SOURCE: ' + e.url + ']');
        }
        if (state.contradictions.length > 0) {
            lines.push('');
            lines.push('## Contradictions');
            lines.push('');
            for (const c of state.contradictions) {
                lines.push('- [CONTRADICTION: ' + truncateText(c.topic, 120) + ']');
                lines.push('  - ' + truncateText(c.claimA, 150) + ' (' + c.urlA + ')');
                lines.push('  - ' + truncateText(c.claimB, 150) + ' (' + c.urlB + ')');
            }
        }
        lines.push('');
        lines.push('## Sources');
        lines.push('');
        for (const s of state.retrieved) {
            lines.push('- [' + s.title + '](' + s.url + ') — trust: ' + (s.trust || 'MEDIUM'));
        }
        lines.push('');
        lines.push('## Evidence Gate');
        lines.push('');
        lines.push('> This proposal was produced by Research Mode. Each factual claim is');
        lines.push('> tagged with its source. Claims without sources are BLOCKED by the');
        lines.push('> Evidence Gate before this document may enter the vault.');
        return lines.join('\n') + '\n';
    }
}

// ------------------------------------------------------------------
//  Helpers (module-level)
// ------------------------------------------------------------------

function extractTopic(claim: string): string {
    const t = String(claim || '').trim();
    // Heuristic: pick the longest noun-ish token sequence (2-3 words).
    const words = t.replace(/[^a-zA-Z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 3);
    if (words.length === 0) return '';
    for (let n = 3; n >= 2; n--) {
        for (let i = 0; i + n <= words.length; i++) {
            const phrase = words.slice(i, i + n).join(' ').toLowerCase();
            if (phrase.length > 8) return phrase;
        }
    }
    return words[0].toLowerCase();
}

function truncateText(str: string, max: number): string {
    return String(str || '').length > max ? String(str || '').slice(0, max) + '…' : String(str || '');
}

function summarize(str: string, max: number): string {
    return truncateText(String(str || '').trim(), max);
}

export { MAX_FETCH_BYTES as maxFetchBytes };