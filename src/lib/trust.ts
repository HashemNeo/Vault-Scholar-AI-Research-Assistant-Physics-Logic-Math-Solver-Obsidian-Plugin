// ============================================================
//  Vault Trust Boundary
//
//  Classifies every piece of content in the vault according to
//  a trust level (verification status) and a content source
//  (provenance). Enforces policies so that no content is treated
//  equally: unverified AI output cannot silently overwrite a
//  user's verified research, and every claim, equation, and
//  script carries its trust classification with it.
// ============================================================

import { sha256 } from './cas';

// ------------------------------------------------------------------
//  Trust Levels (verification status)
// ------------------------------------------------------------------

export const TRUST_LEVELS = {
    TRUSTED:   'TRUSTED',     // User-verified, highest confidence
    VERIFIED:  'VERIFIED',    // Cross-checked against authoritative sources
    INFERRED:  'INFERRED',    // Derived logically but not directly verified
    UNVERIFIED: 'UNVERIFIED', // No verification performed
} as const;

export type TrustLevel = typeof TRUST_LEVELS[keyof typeof TRUST_LEVELS];

export const TRUST_ORDER: Record<TrustLevel, number> = {
    [TRUST_LEVELS.TRUSTED]:   4,
    [TRUST_LEVELS.VERIFIED]:  3,
    [TRUST_LEVELS.INFERRED]:  2,
    [TRUST_LEVELS.UNVERIFIED]: 1,
};

// ------------------------------------------------------------------
//  Content Sources (provenance)
// ------------------------------------------------------------------

export const CONTENT_SOURCES = {
    USER_CREATED:      'USER-CREATED',       // Written directly by the human user
    AI_GENERATED:      'AI-GENERATED',       // Produced by an LLM
    EXTERNAL_SOURCED:  'EXTERNAL-SOURCED',   // Imported from outside the vault
    MATH_DERIVED:      'MATH-DERIVED',       // Result of a mathematical/physical derivation
    SIMULATION_OUTPUT: 'SIMULATION-OUTPUT',  // Output of a sandboxed simulation
    CODE_GENERATED:    'CODE-GENERATED',     // Output of the Coder Agent / AI codegen
} as const;

export type ContentSource = typeof CONTENT_SOURCES[keyof typeof CONTENT_SOURCES];

// Default source for content with no explicit classification.
export const DEFAULT_SOURCE: ContentSource = CONTENT_SOURCES.AI_GENERATED;
export const DEFAULT_LEVEL: TrustLevel = TRUST_LEVELS.UNVERIFIED;

// ------------------------------------------------------------------
//  Types
// ------------------------------------------------------------------

export interface TrustRecord {
    trustLevel: TrustLevel;
    contentSource: ContentSource;
    verified: boolean;
    verifiedBy: string | null;
    confidence: number;
    citations: string[];
    model: string | null;
    classifiedAt: string;
    hash: string;
    metadata: Record<string, unknown>;
}

export interface TrustClassifierOptions {
    source?: ContentSource;
    trustLevel?: TrustLevel;
    verifiedBy?: string | null;
    confidence?: number;
    citations?: string[];
    model?: string;
    metadata?: Record<string, unknown>;
    verificationMethod?: string;
}

export interface TrustBoundaryOptions {
    policies?: Record<string, TrustLevel>;
    onDecision?: (decision: TrustDecision) => void;
    enabled?: boolean;
}

export interface TrustDecision {
    operation: string;
    contentSource: ContentSource;
    level: TrustLevel;
    required: TrustLevel | null;
    timestamp: string;
    bypass: boolean;
    allowed: boolean;
    reason: string;
    canOverride: boolean;
}

// ------------------------------------------------------------------
//  TrustClassifier
// ------------------------------------------------------------------

export class TrustClassifier {
    /**
     * Classify content with a trust level and content source.
     */
    static classify(content: string, opts: TrustClassifierOptions = {}): TrustRecord {
        const text = String(content || '');
        const source = opts.source || DEFAULT_SOURCE;
        const trustLevel = opts.trustLevel || inferTrustLevel(text, source, opts);
        const confidence = clampConfidence(opts.confidence ?? inferConfidence(trustLevel, source));
        const now = new Date().toISOString();

        return {
            trustLevel,
            contentSource: source,
            verified: trustLevel === TRUST_LEVELS.TRUSTED || trustLevel === TRUST_LEVELS.VERIFIED,
            verifiedBy: opts.verifiedBy || (trustLevel === TRUST_LEVELS.TRUSTED ? 'user' : (trustLevel === TRUST_LEVELS.VERIFIED ? 'citation' : null)),
            confidence,
            citations: opts.citations || [],
            model: opts.model || null,
            classifiedAt: now,
            hash: sha256(text),
            metadata: opts.metadata || {},
        };
    }

    /**
     * Combine several trust records for the same content into one.
     */
    static merge(records: TrustRecord[]): TrustRecord | null {
        const valid = (records || []).filter(Boolean);
        if (valid.length === 0) return null;

        const authoritative = valid.filter(r =>
            isAuthoritativeSource(r.contentSource)
        );
        const pool = authoritative.length > 0 ? authoritative : valid;

        const best = pool.reduce((a, b) => {
            return TRUST_ORDER[b.trustLevel] > TRUST_ORDER[a.trustLevel] ? b : a;
        }, pool[0]);

        return {
            trustLevel: best.trustLevel,
            contentSource: best.contentSource,
            verified: best.verified,
            verifiedBy: best.verifiedBy,
            confidence: Math.round(pool.reduce((s, r) => s + (r.confidence || 0), 0) / pool.length),
            citations: [...new Set(valid.flatMap(r => r.citations || []))],
            model: valid.map(r => r.model).filter(Boolean).join(','),
            classifiedAt: new Date().toISOString(),
            hash: best.hash,
            metadata: Object.assign({}, ...valid.map(r => r.metadata || {})),
        };
    }

    /**
     * Check whether a trust record meets a minimum threshold.
     */
    static meetsThreshold(record: TrustRecord | null, minLevel: TrustLevel = TRUST_LEVELS.VERIFIED): boolean {
        if (!record) return false;
        return TRUST_ORDER[record.trustLevel] >= TRUST_ORDER[minLevel];
    }
}

// ------------------------------------------------------------------
//  TrustBoundary
// ------------------------------------------------------------------

// Operational policies: what minimum trust each operation requires.
export const DEFAULT_POLICIES: Record<string, TrustLevel> = {
    'vault.write':        TRUST_LEVELS.VERIFIED,      // Writing to the vault requires verification
    'vault.write.user':   TRUST_LEVELS.TRUSTED,       // Overwriting user-created content requires explicit trust
    'script.execute':     TRUST_LEVELS.VERIFIED,      // Executing scripts requires verification
    'research.cite':      TRUST_LEVELS.VERIFIED,      // Citations must be verified
    'simulation.run':     TRUST_LEVELS.INFERRED,      // Simulations may run on inferred models
    'code.deploy':        TRUST_LEVELS.VERIFIED,      // Deploying generated code requires verification
    'vault.restore':      TRUST_LEVELS.TRUSTED,       // Restoring snapshots requires user trust
    'ai.auto.apply':      TRUST_LEVELS.VERIFIED,      // Auto-applying AI edits requires verification
};

export class TrustBoundary {
    policies: Record<string, TrustLevel>;
    onDecision: ((decision: TrustDecision) => void) | null;
    decisions: TrustDecision[];
    enabled: boolean;

    constructor(opts: TrustBoundaryOptions = {}) {
        this.policies = { ...DEFAULT_POLICIES, ...(opts.policies || {}) };
        this.onDecision = opts.onDecision || null;
        this.decisions = [];
        this.enabled = opts.enabled !== false;
    }

    /**
     * Evaluate whether an operation may proceed given the content's
     * trust record and the operation policy.
     */
    enforce(operation: string, record: TrustRecord | null, opts: { userOverride?: boolean } = {}): TrustDecision {
        const required = this.policies[operation];
        if (!required) {
            // Unknown operation: fail closed by default.
            return this._decide(operation, record, {
                allowed: false,
                reason: `No policy defined for operation "${operation}"`,
                canOverride: true,
            }, opts);
        }

        if (!this.enabled) {
            return this._decide(operation, record, {
                allowed: true,
                reason: 'Trust boundary disabled',
                canOverride: false,
            }, opts);
        }

        const level = record ? record.trustLevel : DEFAULT_LEVEL;
        const passed = TRUST_ORDER[level] >= TRUST_ORDER[required];
        const canOverride = record ? isAuthoritativeSource(record.contentSource) || record.trustLevel === TRUST_LEVELS.TRUSTED : false;

        if (passed) {
            return this._decide(operation, record, {
                allowed: true,
                reason: `${level} meets required ${required}`,
                canOverride: false,
            }, opts);
        }

        // Fail closed, but user may override for authoritative sources.
        return this._decide(operation, record, {
            allowed: false,
            reason: `Trust level ${level} is below required ${required} for "${operation}"`,
            canOverride,
        }, opts);
    }

    _decide(operation: string, record: TrustRecord | null, decision: Omit<TrustDecision, 'operation' | 'contentSource' | 'level' | 'required' | 'timestamp' | 'bypass'>, opts: { userOverride?: boolean }): TrustDecision {
        const full: TrustDecision = {
            ...decision,
            operation,
            contentSource: record ? record.contentSource : DEFAULT_SOURCE,
            level: record ? record.trustLevel : DEFAULT_LEVEL,
            required: this.policies[operation] || null,
            timestamp: new Date().toISOString(),
            bypass: !!opts.userOverride,
        };

        if (opts.userOverride && full.canOverride) {
            full.allowed = true;
            full.reason = `Overridden by user (original: ${full.reason})`;
        }

        this.decisions.push(full);
        if (this.onDecision) {
            try { this.onDecision(full); } catch { /* ignore */ }
        }
        return full;
    }

    /**
     * Export the audit trail of all enforcement decisions.
     */
    auditTrail(): TrustDecision[] {
        return this.decisions.slice();
    }

    /**
     * Clear the in-memory audit trail.
     */
    clear(): void {
        this.decisions = [];
    }
}

// ------------------------------------------------------------------
//  Helpers
// ------------------------------------------------------------------

function inferTrustLevel(text: string, source: ContentSource, opts: TrustClassifierOptions): TrustLevel {
    if (opts.trustLevel) {
        if (TRUST_ORDER[opts.trustLevel]) return opts.trustLevel;
    }

    // Trusted/first-party sources are inherently more trustworthy.
    if (source === CONTENT_SOURCES.USER_CREATED) return TRUST_LEVELS.TRUSTED;
    if (source === CONTENT_SOURCES.MATH_DERIVED || source === CONTENT_SOURCES.SIMULATION_OUTPUT) {
        // Math derivations and simulation outputs can be verified by CAS/sandbox.
        return opts.verificationMethod ? TRUST_LEVELS.VERIFIED : TRUST_LEVELS.INFERRED;
    }

    // Citations raise AI/external content to VERIFIED only when present.
    if ((opts.citations && opts.citations.length > 0) || opts.verifiedBy) {
        return TRUST_LEVELS.VERIFIED;
    }

    // External sourced content begins UNVERIFIED until checked.
    return DEFAULT_LEVEL;
}

function inferConfidence(level: TrustLevel, source: ContentSource): number {
    switch (level) {
        case TRUST_LEVELS.TRUSTED:   return 95;
        case TRUST_LEVELS.VERIFIED:  return 80;
        case TRUST_LEVELS.INFERRED:  return 60;
        default:                     return 30;
    }
}

function clampConfidence(n: number): number {
    n = Number(n);
    if (!isFinite(n)) n = 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function isAuthoritativeSource(source: ContentSource): boolean {
    return source === CONTENT_SOURCES.USER_CREATED ||
           source === CONTENT_SOURCES.MATH_DERIVED ||
           source === CONTENT_SOURCES.SIMULATION_OUTPUT;
}