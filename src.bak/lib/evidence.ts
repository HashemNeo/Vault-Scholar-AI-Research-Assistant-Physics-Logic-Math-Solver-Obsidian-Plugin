// ============================================================
//  Evidence-Gated Knowledge Engine (Phase 9)
//
//  No external factual information enters the vault without a
//  source. This module enforces six rules:
//
//    External factual claims:  MUST have source
//    User-created claims:      Allowed, user is source
//    AI inference:             Marked INFERENCE
//    Vault claims:             Distinguished from externally verified claims
//    Math derivations:         Marked with assumptions and domain of validity
//    Simulation output:        Marked SIMULATION RESULT, not absolute physical truth
//
//  For physics specifically, a simulation is not proof. It is:
//    Model + Assumptions + Equations + Numerical Method + Output
//
//  Integrates with lib/trust.js (TrustClassifier) — zero-dependency.
// ============================================================

'use strict';

const { TrustClassifier, TRUST_LEVELS, CONTENT_SOURCES } = require('./trust');
const { sha256 } = require('./cas');

// ------------------------------------------------------------------
//  Evidence Markers (standardized markdown tokens)
// ------------------------------------------------------------------

const EVIDENCE_MARKERS = {
    SOURCE:            '[SOURCE:',
    INFERENCE:         '[INFERENCE]',
    VAULT_CLAIM:       '[VAULT-CLAIM]',
    USER_CLAIM:        '[USER-CLAIM]',
    EXTERNAL_VERIFIED: '[EXTERNAL-VERIFIED]',
    SIMULATION_RESULT: '[SIMULATION RESULT]',
    ASSUMPTION:        '[ASSUMPTION:',
    DOMAIN:            '[DOMAIN:',
    CONTRADICTION:     '[CONTRADICTION:',
    UNVERIFIED:        '[UNVERIFIED]',
    VERIFIED:          '[VERIFIED]',
};

// ------------------------------------------------------------------
//  Claim Origins
//
//  Distinguishes where a claim comes from. This is orthogonal to
//  trust level: a VAULT_CLAIM may be highly trusted to the user but
//  is NOT the same as an EXTERNAL_VERIFIED claim backed by a
//  retrieved, validated external source.
// ------------------------------------------------------------------

const CLAIM_ORIGIN = {
    USER_CLAIM:        'USER-CLAIM',         // User-created; user is the source
    VAULT_CLAIM:       'VAULT-CLAIM',        // Claim stored in vault (may be user or prior AI)
    EXTERNAL_VERIFIED: 'EXTERNAL-VERIFIED',  // Backed by an external source that was retrieved/validated
    INFERENCE:         'INFERENCE',          // AI logical inference, not directly verified
    MATH_DERIVATION:   'MATH-DERIVATION',    // Math/physics derivation with assumptions + domain
    SIMULATION_RESULT: 'SIMULATION-RESULT',  // Output of a sandboxed simulation — NOT physical truth
};

// ------------------------------------------------------------------
//  Helpers
// ------------------------------------------------------------------

function normalizeUrl(url) {
    if (!url) return null;
    let u = String(url).trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try {
        return new URL(u).href;
    } catch {
        return null;
    }
}

function isUrlLike(text) {
    return /^https?:\/\/\S+$/i.test(String(text || '').trim());
}

// HTML entity decode helper
// Uses String.fromCharCode(38) for '&' to avoid literal-entity
// corruption during source editing/formatting pipelines.
const AMP = String.fromCharCode(38);
function decodeEntities(str) {
    return String(str || '')
        .replace(new RegExp(AMP + 'amp;', 'g'), AMP)
        .replace(new RegExp(AMP + 'lt;', 'g'), '<')
        .replace(new RegExp(AMP + 'gt;', 'g'), '>')
        .replace(new RegExp(AMP + 'quot;', 'g'), '"')
        .replace(/&#39;/g, "'")
        .replace(new RegExp(AMP + 'nbsp;', 'g'), ' ');
}

function stripHtml(html) {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncate(str, max) {
    return String(str || '').length > max ? String(str || '').slice(0, max) + '…' : String(str || '');
}

function normalizeSources(sources) {
    if (!sources) return [];
    const list = Array.isArray(sources) ? sources : [sources];
    const out = [];
    for (const s of list) {
        const str = String(s || '').trim();
        if (!str) continue;
        if (isUrlLike(str)) {
            const norm = normalizeUrl(str);
            if (norm && !out.includes(norm)) out.push(norm);
        } else {
            if (!out.includes(str)) out.push(str);
        }
    }
    return out;
}

function inferContentSource(chunk) {
    const t = String(chunk || '');
    if (/(\[USER-CLAIM\])/.test(t)) return CONTENT_SOURCES.USER_CREATED;
    if (/(\[SIMULATION RESULT\])/.test(t)) return CONTENT_SOURCES.SIMULATION_OUTPUT;
    if (/\[ASSUMPTION:/.test(t) && /\[DOMAIN:/.test(t)) return CONTENT_SOURCES.MATH_DERIVED;
    if (/\[SOURCE:\s*https?:\/\//i.test(t)) return CONTENT_SOURCES.EXTERNAL_SOURCED;
    if (/(\[VAULT-CLAIM\])/.test(t)) return CONTENT_SOURCES.USER_CREATED;
    if (/(\[INFERENCE\])/.test(t)) return CONTENT_SOURCES.AI_GENERATED;
    return CONTENT_SOURCES.AI_GENERATED;
}

function inferOrigin(text, contentSource, sources, opts) {
    if (opts && opts.origin) return opts.origin;
    const t = String(text || '');
    if (/(\[USER-CLAIM\])/.test(t) || contentSource === CONTENT_SOURCES.USER_CREATED) {
        return CLAIM_ORIGIN.USER_CLAIM;
    }
    if (/(\[SIMULATION RESULT\])/.test(t) || contentSource === CONTENT_SOURCES.SIMULATION_OUTPUT) {
        return CLAIM_ORIGIN.SIMULATION_RESULT;
    }
    if (/\[ASSUMPTION:/.test(t) && /\[DOMAIN:/.test(t) || contentSource === CONTENT_SOURCES.MATH_DERIVED) {
        return CLAIM_ORIGIN.MATH_DERIVATION;
    }
    if (/(\[VAULT-CLAIM\])/.test(t)) {
        return CLAIM_ORIGIN.VAULT_CLAIM;
    }
    if (sources.length > 0 || /\[SOURCE:/.test(t)) {
        return CLAIM_ORIGIN.EXTERNAL_VERIFIED;
    }
    if (/(\[INFERENCE\])/.test(t) || contentSource === CONTENT_SOURCES.AI_GENERATED) {
        return CLAIM_ORIGIN.INFERENCE;
    }
    return CLAIM_ORIGIN.INFERENCE;
}

function finalizeDecision(allowed, ctx) {
    const record = TrustClassifier.classify(ctx.text, {
        source: ctx.contentSource,
        trustLevel: ctx.trustLevel,
        verified: allowed && (ctx.trustLevel === TRUST_LEVELS.TRUSTED || ctx.trustLevel === TRUST_LEVELS.VERIFIED),
        verifiedBy: allowed
            ? (ctx.trustLevel === TRUST_LEVELS.TRUSTED ? 'user' : (ctx.trustLevel === TRUST_LEVELS.VERIFIED ? 'evidence' : null))
            : null,
        citations: ctx.sources || [],
        metadata: Object.assign(
            { origin: ctx.origin },
            (ctx.opts && ctx.opts.metadata) || {},
            ctx.extra || {}
        ),
    });

    return {
        allowed,
        origin: ctx.origin,
        trustLevel: ctx.trustLevel,
        reason: ctx.reason,
        markers: ctx.markers,
        sources: ctx.sources || [],
        record,
        extra: ctx.extra || null,
    };
}

// ------------------------------------------------------------------
//  EvidenceGate
// ------------------------------------------------------------------

class EvidenceGate {
    /**
     * Build the canonical simulation header.
     *
     *   Model + Assumptions + Equations + Numerical Method + Output
     *
     * @param {string} model - Physical/mathematical model description.
     * @param {Array|string} assumptions - List of assumptions.
     * @param {string} equations - Equations used.
     * @param {string} numericalMethod - e.g. 'Euler (forward, dt=0.001)'
     * @returns {string} markdown block.
     */
    static simulationHeader(model, assumptions, equations, numericalMethod) {
        const assumptionList = Array.isArray(assumptions) ? assumptions : [assumptions];
        const lines = [];
        lines.push('> [SIMULATION RESULT] — Simulation output is NOT absolute physical truth');
        lines.push('>');
        lines.push('> **Model:** ' + (model || 'Unspecified'));
        lines.push('>');
        lines.push('> **Assumptions:**');
        if (assumptionList.length > 0) {
            for (const a of assumptionList) {
                if (a) lines.push('> - ' + String(a).trim());
            }
        } else {
            lines.push('> - (none stated)');
        }
        lines.push('>');
        lines.push('> **Equations:**');
        if (equations) {
            lines.push('>');
            lines.push('> ```text');
            lines.push('> ' + String(equations).trim().replace(/\n/g, '\n> '));
            lines.push('> ```');
        } else {
            lines.push('> - (none stated)');
        }
        lines.push('>');
        lines.push('> **Numerical Method:** ' + (numericalMethod || 'Unspecified'));
        lines.push('>');
        lines.push('> *Model + Assumptions + Equations + Numerical Method + Output — a simulation is not proof.*');
        return lines.join('\n');
    }

    /**
     * Gate a claim against the six evidence rules.
     *
     * @param {string} claim - The claim text.
     * @param {Object} opts
     *   - contentSource: CONTENT_SOURCES.* (default AI_GENERATED)
     *   - origin: one of CLAIM_ORIGIN.* (auto-inferred if omitted)
     *   - sources: array of source URLs / citation strings
     *   - assumptions: array (math derivations)
     *   - domainOfValidity: string (math derivations)
     *   - equations / numericalMethod / model: for sim results
     *   - userOverride: boolean (bypass gate)
     *   - verified: boolean (whether sources were validated)
     *   - metadata: extra metadata
     * @returns {{allowed, origin, trustLevel, reason, markers, sources, record, extra}}
     */
    static gate(claim, opts = {}) {
        const text = String(claim || '').trim();
        const sources = normalizeSources(opts.sources || opts.citations || []);
        const contentSource = opts.contentSource || CONTENT_SOURCES.AI_GENERATED;
        const origin = opts.origin || inferOrigin(text, contentSource, sources, opts);
        const markers = [];
        const problems = [];

        // ---- Rule 1: External factual claims MUST have source ----
        if (
            (contentSource === CONTENT_SOURCES.EXTERNAL_SOURCED || origin === CLAIM_ORIGIN.EXTERNAL_VERIFIED) &&
            sources.length === 0 &&
            !opts.userOverride
        ) {
            problems.push('External factual claim without a source is BLOCKED (Evidence-Gated Knowledge rule 1)');
            return {
                allowed: false,
                origin,
                trustLevel: TRUST_LEVELS.UNVERIFIED,
                reason: problems.join('; '),
                markers: ['[UNVERIFIED]'],
                sources: [],
                extra: null,
                record: TrustClassifier.classify(text, {
                    source: contentSource,
                    trustLevel: TRUST_LEVELS.UNVERIFIED,
                    metadata: { origin, evidenceProblems: problems },
                }),
            };
        }

        // ---- Rule 2: User-created claims — user is the source ----
        if (contentSource === CONTENT_SOURCES.USER_CREATED || origin === CLAIM_ORIGIN.USER_CLAIM) {
            markers.push(EVIDENCE_MARKERS.USER_CLAIM);
            return finalizeDecision(true, {
                origin: CLAIM_ORIGIN.USER_CLAIM,
                trustLevel: TRUST_LEVELS.TRUSTED,
                reason: 'User-created claim — user is the source',
                markers,
                sources,
                contentSource,
                text,
                opts,
            });
        }

        // ---- Rule 3: AI inference is marked INFERENCE ----
        if (contentSource === CONTENT_SOURCES.AI_GENERATED && sources.length === 0 && !opts.assumptions) {
            markers.push(EVIDENCE_MARKERS.INFERENCE);
            return finalizeDecision(true, {
                origin: CLAIM_ORIGIN.INFERENCE,
                trustLevel: TRUST_LEVELS.INFERRED,
                reason: 'AI inference — marked INFERENCE',
                markers,
                sources,
                contentSource,
                text,
                opts,
            });
        }

        // ---- Rule 4: Vault claims distinguished from external ----
        if (origin === CLAIM_ORIGIN.VAULT_CLAIM) {
            markers.push(EVIDENCE_MARKERS.VAULT_CLAIM);
            return finalizeDecision(true, {
                origin: CLAIM_ORIGIN.VAULT_CLAIM,
                trustLevel: TRUST_LEVELS.VERIFIED,
                reason: 'Vault claim — distinguished from externally verified (no external validation performed)',
                markers,
                sources: [],
                contentSource,
                text,
                opts,
            });
        }

        // ---- Rule 5: Math derivations — assumptions + domain ----
        if (contentSource === CONTENT_SOURCES.MATH_DERIVED || origin === CLAIM_ORIGIN.MATH_DERIVATION) {
            const assumptions = Array.isArray(opts.assumptions) ? opts.assumptions : [];
            const domain = String(opts.domainOfValidity || '').trim();

            if (assumptions.length === 0 || !domain) {
                problems.push('Math derivation missing assumptions and/or domain of validity — cannot be trusted');
            } else {
                markers.push('[ASSUMPTION: ' + assumptions.join('; ') + ']');
                markers.push('[DOMAIN: ' + domain + ']');
            }

            const complete = problems.length === 0;
            return finalizeDecision(complete, {
                origin: CLAIM_ORIGIN.MATH_DERIVATION,
                trustLevel: complete ? TRUST_LEVELS.VERIFIED : TRUST_LEVELS.UNVERIFIED,
                reason: complete
                    ? 'Math derivation with assumptions and domain of validity'
                    : problems.join('; '),
                markers,
                sources,
                contentSource,
                text,
                opts,
                extra: { assumptions, domainOfValidity: domain },
            });
        }

        // ---- Rule 6: Simulation output — SIMULATION RESULT, not truth ----
        if (contentSource === CONTENT_SOURCES.SIMULATION_OUTPUT || origin === CLAIM_ORIGIN.SIMULATION_RESULT) {
            const header = EvidenceGate.simulationHeader(
                opts.model,
                opts.assumptions,
                opts.equations,
                opts.numericalMethod
            );
            markers.push(EVIDENCE_MARKERS.SIMULATION_RESULT);
            return finalizeDecision(true, {
                origin: CLAIM_ORIGIN.SIMULATION_RESULT,
                trustLevel: TRUST_LEVELS.INFERRED,
                reason: 'Simulation output — marked SIMULATION RESULT, not absolute physical truth',
                markers,
                sources,
                contentSource,
                text,
                opts,
                extra: { simulationHeader: header },
            });
        }

        // ---- Default: AI-generated with sources → EXTERNAL-VERIFIED ----
        if (sources.length > 0) {
            markers.push('[SOURCE: ' + sources.join(', ') + ']');
            if (opts.verified) {
                markers.push(EVIDENCE_MARKERS.EXTERNAL_VERIFIED);
            }
            return finalizeDecision(true, {
                origin: CLAIM_ORIGIN.EXTERNAL_VERIFIED,
                trustLevel: opts.verified === false ? TRUST_LEVELS.UNVERIFIED : TRUST_LEVELS.VERIFIED,
                reason: opts.verified === false
                    ? 'Claim has sources but not validated'
                    : 'Externally verified claim with sources',
                markers,
                sources,
                contentSource,
                text,
                opts,
            });
        }

        // ---- Fallback: generic AI content without sources ----
        return finalizeDecision(true, {
            origin: CLAIM_ORIGIN.INFERENCE,
            trustLevel: TRUST_LEVELS.INFERRED,
            reason: 'AI-generated content — marked INFERENCE',
            markers: [EVIDENCE_MARKERS.INFERENCE],
            sources,
            contentSource,
            text,
            opts,
        });
    }

    /**
     * Parse evidence markers from markdown content.
     *
     * @param {string} content - Note or document text.
     * @returns {{markers: Object[], claims: Object[]}}
     */
    static parseEvidence(content) {
        const text = String(content || '');
        const markers = [];
        const claimBlocks = EvidenceGate.extractClaims(text);

        const markerPatterns = [
            { type: 'source', regex: /\[SOURCE:\s*([^\]]+)\]/gi },
            { type: 'assumption', regex: /\[ASSUMPTION:\s*([^\]]+)\]/gi },
            { type: 'domain', regex: /\[DOMAIN:\s*([^\]]+)\]/gi },
            { type: 'contradiction', regex: /\[CONTRADICTION:\s*([^\]]+)\]/gi },
            { type: 'inference', regex: /\[INFERENCE\]/gi },
            { type: 'vault_claim', regex: /\[VAULT-CLAIM\]/gi },
            { type: 'user_claim', regex: /\[USER-CLAIM\]/gi },
            { type: 'external_verified', regex: /\[EXTERNAL-VERIFIED\]/gi },
            { type: 'simulation_result', regex: /\[SIMULATION RESULT\]/gi },
            { type: 'unverified', regex: /\[UNVERIFIED\]/gi },
            { type: 'verified', regex: /\[VERIFIED\]/gi },
        ];

        for (const { type, regex } of markerPatterns) {
            let m;
            regex.lastIndex = 0;
            while ((m = regex.exec(text)) !== null) {
                markers.push({
                    type,
                    value: m[1] ? decodeEntities(m[1].trim()) : null,
                    index: m.index,
                    raw: m[0],
                });
            }
        }

        const claims = claimBlocks.map(block =>
            EvidenceGate.gate(block.text, { contentSource: block.contentSource })
        );

        return { markers, claims };
    }

    /**
     * Validate a full note against evidence rules.
     *
     * @param {string} noteContent - Full markdown note.
     * @returns {{valid: boolean, totalClaims: number, blocked: number,
     *            allowed: number, issues: Array, summary: Object}}
     */
    static validateNote(noteContent) {
        const text = String(noteContent || '');
        const claimBlocks = EvidenceGate.extractClaims(text);
        const issues = [];
        const summary = { allowed: 0, blocked: 0, origins: {}, trust: {} };

        for (const block of claimBlocks) {
            const result = EvidenceGate.gate(block.text, {
                contentSource: block.contentSource,
            });
            summary.origins[result.origin] = (summary.origins[result.origin] || 0) + 1;
            summary.trust[result.trustLevel] = (summary.trust[result.trustLevel] || 0) + 1;
            if (result.allowed) {
                summary.allowed++;
            } else {
                summary.blocked++;
                issues.push({
                    index: block.index,
                    text: truncate(block.text, 200),
                    reason: result.reason,
                });
            }
        }

        return {
            valid: summary.blocked === 0,
            totalClaims: claimBlocks.length,
            blocked: summary.blocked,
            allowed: summary.allowed,
            issues,
            summary,
        };
    }

    /**
     * Extract claim-like blocks from markdown content.
     * Heuristic: splits into sentences, groups into short paragraph
     * chunks, and tags each with a contentSource based on context
     * lines (e.g. a following `[SOURCE: ...]`, `[INFERENCE]`, etc.).
     *
     * @param {string} content
     * @returns {Array<{index, text, contentSource, origin, length}>}
     */
    static extractClaims(content) {
        const text = String(content || '');
        if (!text.trim()) return [];

        // Strip code blocks, frontmatter, headers, blockquotes, images
        const cleaned = text
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/^---[\s\S]*?---$/m, ' ')
            .replace(/#{1,6}\s.*$/gm, ' ')
            .replace(/^\s*>\s?/gm, ' ')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');

        const sentences = cleaned
            .split(/(?<=[.!?])\s+|\n+/)
            .map(s => s.trim())
            .filter(s => s.length > 20 && s.length < 500);

        const chunks = [];
        for (let i = 0; i < sentences.length; i += 3) {
            const chunk = sentences.slice(i, i + 3).join(' ');
            if (chunk.length < 20) continue;
            const index = text.indexOf(sentences[i]);
            chunks.push({
                index: index >= 0 ? index : 0,
                text: chunk,
                contentSource: inferContentSource(chunk),
                origin: inferOrigin(chunk, inferContentSource(chunk), [], {}),
                length: chunk.length,
            });
        }
        return chunks;
    }

    /**
     * Format a gated claim into markdown with its evidence markers.
     *
     * @param {string} claimText
     * @param {Object} result - Result from EvidenceGate.gate
     * @returns {string}
     */
    static formatClaim(claimText, result) {
        const lines = [];
        lines.push('- ' + String(claimText || '').trim());
        const meta = (result && result.markers ? result.markers : []).filter(Boolean);
        if (result && result.sources && result.sources.length > 0) {
            meta.push('[SOURCE: ' + result.sources.join(', ') + ']');
        }
        if (result && result.extra && result.extra.assumptions && result.extra.assumptions.length > 0) {
            meta.push('[ASSUMPTION: ' + result.extra.assumptions.join('; ') + ']');
        }
        if (result && result.extra && result.extra.domainOfValidity) {
            meta.push('[DOMAIN: ' + result.extra.domainOfValidity + ']');
        }
        if (meta.length > 0) {
            lines.push('   ' + meta.join(' '));
        }
        return lines.join('\n');
    }
}

// ------------------------------------------------------------------
//  Export
// ------------------------------------------------------------------

module.exports = {
    EVIDENCE_MARKERS,
    CLAIM_ORIGIN,
    EvidenceGate,
    normalizeSources,
    normalizeUrl,
    isUrlLike,
    stripHtml,
    decodeEntities,
    sha256,
};
