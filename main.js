'use strict'
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// vault-scholar/src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VaultScholarPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");
var import_child_process = require("child_process");
var import_fs2 = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));
var import_crypto2 = __toESM(require("crypto"));
var import_vm = __toESM(require("vm"));

// vault-scholar/src/lib/cas.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_crypto = __toESM(require("crypto"));
function sha256(data) {
  return import_crypto.default.createHash("sha256").update(data).digest("hex");
}

// vault-scholar/src/lib/trust.ts
var TRUST_LEVELS = {
  TRUSTED: "TRUSTED",
  // User-verified, highest confidence
  VERIFIED: "VERIFIED",
  // Cross-checked against authoritative sources
  INFERRED: "INFERRED",
  // Derived logically but not directly verified
  UNVERIFIED: "UNVERIFIED"
  // No verification performed
};
var TRUST_ORDER = {
  [TRUST_LEVELS.TRUSTED]: 4,
  [TRUST_LEVELS.VERIFIED]: 3,
  [TRUST_LEVELS.INFERRED]: 2,
  [TRUST_LEVELS.UNVERIFIED]: 1
};
var CONTENT_SOURCES = {
  USER_CREATED: "USER-CREATED",
  // Written directly by the human user
  AI_GENERATED: "AI-GENERATED",
  // Produced by an LLM
  EXTERNAL_SOURCED: "EXTERNAL-SOURCED",
  // Imported from outside the vault
  MATH_DERIVED: "MATH-DERIVED",
  // Result of a mathematical/physical derivation
  SIMULATION_OUTPUT: "SIMULATION-OUTPUT",
  // Output of a sandboxed simulation
  CODE_GENERATED: "CODE-GENERATED"
  // Output of the Coder Agent / AI codegen
};
var DEFAULT_SOURCE = CONTENT_SOURCES.AI_GENERATED;
var DEFAULT_LEVEL = TRUST_LEVELS.UNVERIFIED;
var TrustClassifier = class {
  /**
   * Classify content with a trust level and content source.
   */
  static classify(content, opts = {}) {
    var _a;
    const text = String(content || "");
    const source = opts.source || DEFAULT_SOURCE;
    const trustLevel = opts.trustLevel || inferTrustLevel(text, source, opts);
    const confidence = clampConfidence((_a = opts.confidence) != null ? _a : inferConfidence(trustLevel, source));
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return {
      trustLevel,
      contentSource: source,
      verified: trustLevel === TRUST_LEVELS.TRUSTED || trustLevel === TRUST_LEVELS.VERIFIED,
      verifiedBy: opts.verifiedBy || (trustLevel === TRUST_LEVELS.TRUSTED ? "user" : trustLevel === TRUST_LEVELS.VERIFIED ? "citation" : null),
      confidence,
      citations: opts.citations || [],
      model: opts.model || null,
      classifiedAt: now,
      hash: sha256(text),
      metadata: opts.metadata || {}
    };
  }
  /**
   * Combine several trust records for the same content into one.
   */
  static merge(records) {
    const valid = (records || []).filter(Boolean);
    if (valid.length === 0) return null;
    const authoritative = valid.filter(
      (r) => isAuthoritativeSource(r.contentSource)
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
      citations: [...new Set(valid.flatMap((r) => r.citations || []))],
      model: valid.map((r) => r.model).filter(Boolean).join(","),
      classifiedAt: (/* @__PURE__ */ new Date()).toISOString(),
      hash: best.hash,
      metadata: Object.assign({}, ...valid.map((r) => r.metadata || {}))
    };
  }
  /**
   * Check whether a trust record meets a minimum threshold.
   */
  static meetsThreshold(record, minLevel = TRUST_LEVELS.VERIFIED) {
    if (!record) return false;
    return TRUST_ORDER[record.trustLevel] >= TRUST_ORDER[minLevel];
  }
};
var DEFAULT_POLICIES = {
  "vault.write": TRUST_LEVELS.VERIFIED,
  // Writing to the vault requires verification
  "vault.write.user": TRUST_LEVELS.TRUSTED,
  // Overwriting user-created content requires explicit trust
  "script.execute": TRUST_LEVELS.VERIFIED,
  // Executing scripts requires verification
  "research.cite": TRUST_LEVELS.VERIFIED,
  // Citations must be verified
  "simulation.run": TRUST_LEVELS.INFERRED,
  // Simulations may run on inferred models
  "code.deploy": TRUST_LEVELS.VERIFIED,
  // Deploying generated code requires verification
  "vault.restore": TRUST_LEVELS.TRUSTED,
  // Restoring snapshots requires user trust
  "ai.auto.apply": TRUST_LEVELS.VERIFIED
  // Auto-applying AI edits requires verification
};
var TrustBoundary = class {
  constructor(opts = {}) {
    this.policies = { ...DEFAULT_POLICIES, ...opts.policies || {} };
    this.onDecision = opts.onDecision || null;
    this.decisions = [];
    this.enabled = opts.enabled !== false;
  }
  /**
   * Evaluate whether an operation may proceed given the content's
   * trust record and the operation policy.
   */
  enforce(operation, record, opts = {}) {
    const required = this.policies[operation];
    if (!required) {
      return this._decide(operation, record, {
        allowed: false,
        reason: `No policy defined for operation "${operation}"`,
        canOverride: true
      }, opts);
    }
    if (!this.enabled) {
      return this._decide(operation, record, {
        allowed: true,
        reason: "Trust boundary disabled",
        canOverride: false
      }, opts);
    }
    const level = record ? record.trustLevel : DEFAULT_LEVEL;
    const passed = TRUST_ORDER[level] >= TRUST_ORDER[required];
    const canOverride = record ? isAuthoritativeSource(record.contentSource) || record.trustLevel === TRUST_LEVELS.TRUSTED : false;
    if (passed) {
      return this._decide(operation, record, {
        allowed: true,
        reason: `${level} meets required ${required}`,
        canOverride: false
      }, opts);
    }
    return this._decide(operation, record, {
      allowed: false,
      reason: `Trust level ${level} is below required ${required} for "${operation}"`,
      canOverride
    }, opts);
  }
  _decide(operation, record, decision, opts) {
    const full = {
      ...decision,
      operation,
      contentSource: record ? record.contentSource : DEFAULT_SOURCE,
      level: record ? record.trustLevel : DEFAULT_LEVEL,
      required: this.policies[operation] || null,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      bypass: !!opts.userOverride
    };
    if (opts.userOverride && full.canOverride) {
      full.allowed = true;
      full.reason = `Overridden by user (original: ${full.reason})`;
    }
    this.decisions.push(full);
    if (this.onDecision) {
      try {
        this.onDecision(full);
      } catch (e) {
      }
    }
    return full;
  }
  /**
   * Export the audit trail of all enforcement decisions.
   */
  auditTrail() {
    return this.decisions.slice();
  }
  /**
   * Clear the in-memory audit trail.
   */
  clear() {
    this.decisions = [];
  }
};
function inferTrustLevel(text, source, opts) {
  if (opts.trustLevel) {
    if (TRUST_ORDER[opts.trustLevel]) return opts.trustLevel;
  }
  if (source === CONTENT_SOURCES.USER_CREATED) return TRUST_LEVELS.TRUSTED;
  if (source === CONTENT_SOURCES.MATH_DERIVED || source === CONTENT_SOURCES.SIMULATION_OUTPUT) {
    return opts.verificationMethod ? TRUST_LEVELS.VERIFIED : TRUST_LEVELS.INFERRED;
  }
  if (opts.citations && opts.citations.length > 0 || opts.verifiedBy) {
    return TRUST_LEVELS.VERIFIED;
  }
  return DEFAULT_LEVEL;
}
function inferConfidence(level, source) {
  switch (level) {
    case TRUST_LEVELS.TRUSTED:
      return 95;
    case TRUST_LEVELS.VERIFIED:
      return 80;
    case TRUST_LEVELS.INFERRED:
      return 60;
    default:
      return 30;
  }
}
function clampConfidence(n) {
  n = Number(n);
  if (!isFinite(n)) n = 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function isAuthoritativeSource(source) {
  return source === CONTENT_SOURCES.USER_CREATED || source === CONTENT_SOURCES.MATH_DERIVED || source === CONTENT_SOURCES.SIMULATION_OUTPUT;
}

// vault-scholar/src/lib/evidence.ts
var EVIDENCE_MARKERS = {
  SOURCE: "[SOURCE:",
  INFERENCE: "[INFERENCE]",
  VAULT_CLAIM: "[VAULT-CLAIM]",
  USER_CLAIM: "[USER-CLAIM]",
  EXTERNAL_VERIFIED: "[EXTERNAL-VERIFIED]",
  SIMULATION_RESULT: "[SIMULATION RESULT]",
  ASSUMPTION: "[ASSUMPTION:",
  DOMAIN: "[DOMAIN:",
  CONTRADICTION: "[CONTRADICTION:",
  UNVERIFIED: "[UNVERIFIED]",
  VERIFIED: "[VERIFIED]"
};
var CLAIM_ORIGIN = {
  USER_CLAIM: "USER-CLAIM",
  // User-created; user is the source
  VAULT_CLAIM: "VAULT-CLAIM",
  // Claim stored in vault (may be user or prior AI)
  EXTERNAL_VERIFIED: "EXTERNAL-VERIFIED",
  // Backed by an external source that was retrieved/validated
  INFERENCE: "INFERENCE",
  // AI logical inference, not directly verified
  MATH_DERIVATION: "MATH-DERIVATION",
  // Math/physics derivation with assumptions + domain
  SIMULATION_RESULT: "SIMULATION-RESULT"
  // Output of a sandboxed simulation — NOT physical truth
};
function normalizeUrl(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    return new URL(u).href;
  } catch (e) {
    return null;
  }
}
function isUrlLike(text) {
  return /^https?:\/\/\S+$/i.test(String(text || "").trim());
}
var AMP = String.fromCharCode(38);
function decodeEntities(str) {
  return String(str || "").replace(new RegExp(AMP + "amp;", "g"), AMP).replace(new RegExp(AMP + "lt;", "g"), "<").replace(new RegExp(AMP + "gt;", "g"), ">").replace(new RegExp(AMP + "quot;", "g"), '"').replace(/&#39;/g, "'").replace(new RegExp(AMP + "nbsp;", "g"), " ");
}
function stripHtml(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function truncate(str, max) {
  return String(str || "").length > max ? String(str || "").slice(0, max) + "\u2026" : String(str || "");
}
function normalizeSources(sources) {
  if (!sources) return [];
  const list = Array.isArray(sources) ? sources : [sources];
  const out = [];
  for (const s of list) {
    const str = String(s || "").trim();
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
  const t = String(chunk || "");
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
  const t = String(text || "");
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
    verifiedBy: allowed ? ctx.trustLevel === TRUST_LEVELS.TRUSTED ? "user" : ctx.trustLevel === TRUST_LEVELS.VERIFIED ? "evidence" : null : null,
    citations: ctx.sources || [],
    metadata: Object.assign(
      { origin: ctx.origin },
      ctx.opts && ctx.opts.metadata || {},
      ctx.extra || {}
    )
  });
  return {
    allowed,
    origin: ctx.origin,
    trustLevel: ctx.trustLevel,
    reason: ctx.reason,
    markers: ctx.markers,
    sources: ctx.sources || [],
    record,
    extra: ctx.extra || null
  };
}
var EvidenceGate = class _EvidenceGate {
  /**
   * Build the canonical simulation header.
   *
   *   Model + Assumptions + Equations + Numerical Method + Output
   */
  static simulationHeader(model, assumptions, equations, numericalMethod) {
    const assumptionList = Array.isArray(assumptions) ? assumptions : [assumptions];
    const lines = [];
    lines.push("> [SIMULATION RESULT] \u2014 Simulation output is NOT absolute physical truth");
    lines.push(">");
    lines.push("> **Model:** " + (model || "Unspecified"));
    lines.push(">");
    lines.push("> **Assumptions:**");
    if (assumptionList.length > 0) {
      for (const a of assumptionList) {
        if (a) lines.push("> - " + String(a).trim());
      }
    } else {
      lines.push("> - (none stated)");
    }
    lines.push(">");
    lines.push("> **Equations:**");
    if (equations) {
      lines.push(">");
      lines.push("> ```text");
      lines.push("> " + String(equations).trim().replace(/\n/g, "\n> "));
      lines.push("> ```");
    } else {
      lines.push("> - (none stated)");
    }
    lines.push(">");
    lines.push("> **Numerical Method:** " + (numericalMethod || "Unspecified"));
    lines.push(">");
    lines.push("> *Model + Assumptions + Equations + Numerical Method + Output \u2014 a simulation is not proof.*");
    return lines.join("\n");
  }
  /**
   * Gate a claim against the six evidence rules.
   */
  static gate(claim, opts = {}) {
    const text = String(claim || "").trim();
    const sources = normalizeSources(opts.sources || opts.citations || []);
    const contentSource = opts.contentSource || CONTENT_SOURCES.AI_GENERATED;
    const origin = opts.origin || inferOrigin(text, contentSource, sources, opts);
    const markers = [];
    const problems = [];
    if ((contentSource === CONTENT_SOURCES.EXTERNAL_SOURCED || origin === CLAIM_ORIGIN.EXTERNAL_VERIFIED) && sources.length === 0 && !opts.userOverride) {
      problems.push("External factual claim without a source is BLOCKED (Evidence-Gated Knowledge rule 1)");
      return {
        allowed: false,
        origin,
        trustLevel: TRUST_LEVELS.UNVERIFIED,
        reason: problems.join("; "),
        markers: ["[UNVERIFIED]"],
        sources: [],
        extra: null,
        record: TrustClassifier.classify(text, {
          source: contentSource,
          trustLevel: TRUST_LEVELS.UNVERIFIED,
          metadata: { origin, evidenceProblems: problems }
        })
      };
    }
    if (contentSource === CONTENT_SOURCES.USER_CREATED || origin === CLAIM_ORIGIN.USER_CLAIM) {
      markers.push(EVIDENCE_MARKERS.USER_CLAIM);
      return finalizeDecision(true, {
        origin: CLAIM_ORIGIN.USER_CLAIM,
        trustLevel: TRUST_LEVELS.TRUSTED,
        reason: "User-created claim \u2014 user is the source",
        markers,
        sources,
        contentSource,
        text,
        opts
      });
    }
    if (contentSource === CONTENT_SOURCES.AI_GENERATED && sources.length === 0 && !opts.assumptions) {
      markers.push(EVIDENCE_MARKERS.INFERENCE);
      return finalizeDecision(true, {
        origin: CLAIM_ORIGIN.INFERENCE,
        trustLevel: TRUST_LEVELS.INFERRED,
        reason: "AI inference \u2014 marked INFERENCE",
        markers,
        sources,
        contentSource,
        text,
        opts
      });
    }
    if (origin === CLAIM_ORIGIN.VAULT_CLAIM) {
      markers.push(EVIDENCE_MARKERS.VAULT_CLAIM);
      return finalizeDecision(true, {
        origin: CLAIM_ORIGIN.VAULT_CLAIM,
        trustLevel: TRUST_LEVELS.VERIFIED,
        reason: "Vault claim \u2014 distinguished from externally verified (no external validation performed)",
        markers,
        sources: [],
        contentSource,
        text,
        opts
      });
    }
    if (contentSource === CONTENT_SOURCES.MATH_DERIVED || origin === CLAIM_ORIGIN.MATH_DERIVATION) {
      const assumptions = Array.isArray(opts.assumptions) ? opts.assumptions : [];
      const domain = String(opts.domainOfValidity || "").trim();
      if (assumptions.length === 0 || !domain) {
        problems.push("Math derivation missing assumptions and/or domain of validity \u2014 cannot be trusted");
      } else {
        markers.push("[ASSUMPTION: " + assumptions.join("; ") + "]");
        markers.push("[DOMAIN: " + domain + "]");
      }
      const complete = problems.length === 0;
      return finalizeDecision(complete, {
        origin: CLAIM_ORIGIN.MATH_DERIVATION,
        trustLevel: complete ? TRUST_LEVELS.VERIFIED : TRUST_LEVELS.UNVERIFIED,
        reason: complete ? "Math derivation with assumptions and domain of validity" : problems.join("; "),
        markers,
        sources,
        contentSource,
        text,
        opts,
        extra: { assumptions, domainOfValidity: domain }
      });
    }
    if (contentSource === CONTENT_SOURCES.SIMULATION_OUTPUT || origin === CLAIM_ORIGIN.SIMULATION_RESULT) {
      const header = _EvidenceGate.simulationHeader(
        opts.model,
        opts.assumptions,
        opts.equations,
        opts.numericalMethod
      );
      markers.push(EVIDENCE_MARKERS.SIMULATION_RESULT);
      return finalizeDecision(true, {
        origin: CLAIM_ORIGIN.SIMULATION_RESULT,
        trustLevel: TRUST_LEVELS.INFERRED,
        reason: "Simulation output \u2014 marked SIMULATION RESULT, not absolute physical truth",
        markers,
        sources,
        contentSource,
        text,
        opts,
        extra: { simulationHeader: header }
      });
    }
    if (sources.length > 0) {
      markers.push("[SOURCE: " + sources.join(", ") + "]");
      if (opts.verified) {
        markers.push(EVIDENCE_MARKERS.EXTERNAL_VERIFIED);
      }
      return finalizeDecision(true, {
        origin: CLAIM_ORIGIN.EXTERNAL_VERIFIED,
        trustLevel: opts.verified === false ? TRUST_LEVELS.UNVERIFIED : TRUST_LEVELS.VERIFIED,
        reason: opts.verified === false ? "Claim has sources but not validated" : "Externally verified claim with sources",
        markers,
        sources,
        contentSource,
        text,
        opts
      });
    }
    return finalizeDecision(true, {
      origin: CLAIM_ORIGIN.INFERENCE,
      trustLevel: TRUST_LEVELS.INFERRED,
      reason: "AI-generated content \u2014 marked INFERENCE",
      markers: [EVIDENCE_MARKERS.INFERENCE],
      sources,
      contentSource,
      text,
      opts
    });
  }
  /**
   * Parse evidence markers from markdown content.
   */
  static parseEvidence(content) {
    const text = String(content || "");
    const markers = [];
    const claimBlocks = _EvidenceGate.extractClaims(text);
    const markerPatterns = [
      { type: "source", regex: /\[SOURCE:\s*([^\]]+)\]/gi },
      { type: "assumption", regex: /\[ASSUMPTION:\s*([^\]]+)\]/gi },
      { type: "domain", regex: /\[DOMAIN:\s*([^\]]+)\]/gi },
      { type: "contradiction", regex: /\[CONTRADICTION:\s*([^\]]+)\]/gi },
      { type: "inference", regex: /\[INFERENCE\]/gi },
      { type: "vault_claim", regex: /\[VAULT-CLAIM\]/gi },
      { type: "user_claim", regex: /\[USER-CLAIM\]/gi },
      { type: "external_verified", regex: /\[EXTERNAL-VERIFIED\]/gi },
      { type: "simulation_result", regex: /\[SIMULATION RESULT\]/gi },
      { type: "unverified", regex: /\[UNVERIFIED\]/gi },
      { type: "verified", regex: /\[VERIFIED\]/gi }
    ];
    for (const { type, regex } of markerPatterns) {
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(text)) !== null) {
        markers.push({
          type,
          value: m[1] ? decodeEntities(m[1].trim()) : null,
          index: m.index,
          raw: m[0]
        });
      }
    }
    const claims = claimBlocks.map(
      (block) => _EvidenceGate.gate(block.text, { contentSource: block.contentSource })
    );
    return { markers, claims };
  }
  /**
   * Validate a full note against evidence rules.
   */
  static validateNote(noteContent) {
    const text = String(noteContent || "");
    const claimBlocks = _EvidenceGate.extractClaims(text);
    const issues = [];
    const summary = { allowed: 0, blocked: 0, origins: {}, trust: {} };
    for (const block of claimBlocks) {
      const result = _EvidenceGate.gate(block.text, {
        contentSource: block.contentSource
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
          reason: result.reason
        });
      }
    }
    return {
      valid: summary.blocked === 0,
      totalClaims: claimBlocks.length,
      blocked: summary.blocked,
      allowed: summary.allowed,
      issues,
      summary
    };
  }
  /**
   * Extract claim-like blocks from markdown content.
   * Heuristic: splits into sentences, groups into short paragraph
   * chunks, and tags each with a contentSource based on context
   * lines (e.g. a following `[SOURCE: ...]`, `[INFERENCE]`, etc.).
   */
  static extractClaims(content) {
    const text = String(content || "");
    if (!text.trim()) return [];
    const cleaned = text.replace(/```[\s\S]*?```/g, " ").replace(/^---[\s\S]*?---$/m, " ").replace(/#{1,6}\s.*$/gm, " ").replace(/^\s*>\s?/gm, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
    const sentences = cleaned.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 20 && s.length < 500);
    const chunks = [];
    for (let i = 0; i < sentences.length; i += 3) {
      const chunk = sentences.slice(i, i + 3).join(" ");
      if (chunk.length < 20) continue;
      const index = text.indexOf(sentences[i]);
      chunks.push({
        index: index >= 0 ? index : 0,
        text: chunk,
        contentSource: inferContentSource(chunk),
        origin: inferOrigin(chunk, inferContentSource(chunk), [], {}),
        length: chunk.length
      });
    }
    return chunks;
  }
  /**
   * Format a gated claim into markdown with its evidence markers.
   */
  static formatClaim(claimText, result) {
    const lines = [];
    lines.push("- " + String(claimText || "").trim());
    const meta = (result && result.markers ? result.markers : []).filter(Boolean);
    if (result && result.sources && result.sources.length > 0) {
      meta.push("[SOURCE: " + result.sources.join(", ") + "]");
    }
    if (result && result.extra && Array.isArray(result.extra.assumptions) && result.extra.assumptions.length > 0) {
      meta.push("[ASSUMPTION: " + result.extra.assumptions.join("; ") + "]");
    }
    if (result && result.extra && result.extra.domainOfValidity) {
      meta.push("[DOMAIN: " + String(result.extra.domainOfValidity) + "]");
    }
    if (meta.length > 0) {
      lines.push("   " + meta.join(" "));
    }
    return lines.join("\n");
  }
};

// vault-scholar/src/lib/research.ts
var SOURCE_TRUST = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW"
};
var HIGH_DOMAIN_RE = /(^|\.)(arxiv\.org|gov|edu|ac\.|scholar\.google\.com|doi\.org|nature\.com|sciencemag\.org|cell\.com|nejm\.org|pubmed\.ncbi\.nlm\.nih\.gov|phys\.org)$/i;
var MEDIUM_DOMAIN_RE = /(^|\.)(wikipedia\.org|bbc\.com|cnn\.com|reuters\.com|apnews\.com|nytimes\.com|theguardian\.com|economist\.com|npr\.org|pbs\.org|medium\.com|github\.io|stackexchange\.com|stackoverflow\.com)$/i;
var LOW_DOMAIN_RE = /(^|\.)(blogspot\.com|wordpress\.com|tumblr\.com|reddit\.com|quora\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com)$/i;
var SourceClassifier = class _SourceClassifier {
  /**
   * Classify a source URL's trust level (heuristic, local).
   */
  static classify(url) {
    const u = normalizeUrl(url);
    if (!u) {
      return { trust: SOURCE_TRUST.LOW, domain: null, reason: "Invalid or missing URL" };
    }
    let host;
    try {
      host = new URL(u).hostname;
    } catch (e) {
      return { trust: SOURCE_TRUST.LOW, domain: null, reason: "Invalid URL" };
    }
    host = host.toLowerCase().replace(/^www\./, "");
    if (HIGH_DOMAIN_RE.test(host)) {
      return { trust: SOURCE_TRUST.HIGH, domain: host, reason: "High-authority domain (arxiv/gov/edu/academic)" };
    }
    if (MEDIUM_DOMAIN_RE.test(host)) {
      return { trust: SOURCE_TRUST.MEDIUM, domain: host, reason: "Medium-authority domain (encyclopedia/major news)" };
    }
    if (LOW_DOMAIN_RE.test(host)) {
      return { trust: SOURCE_TRUST.LOW, domain: host, reason: "Low-authority domain (blog/forum/social)" };
    }
    return { trust: SOURCE_TRUST.MEDIUM, domain: host, reason: "Unknown domain \u2014 medium default" };
  }
  /**
   * Rank results by trust (HIGH first), stable within tiers.
   */
  static rank(results) {
    const ranked = (results || []).map((r) => {
      const c = _SourceClassifier.classify(r.url);
      return { ...r, trust: c.trust, domain: c.domain };
    });
    const order = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    ranked.sort((a, b) => (order[b.trust] || 0) - (order[a.trust] || 0));
    return ranked;
  }
};
var DuckDuckGoProvider = class {
  constructor(fetcher) {
    this.fetcher = fetcher;
  }
  /**
   * Search DuckDuckGo Lite HTML endpoint (no API key).
   */
  async search(query, maxResults = 10) {
    const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
    const raw = await this.fetcher(url);
    const html = typeof raw === "string" ? raw : String(raw.text || "");
    const results = [];
    const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const links = [];
    let m;
    while ((m = linkRe.exec(html)) !== null && links.length < maxResults) {
      links.push({ href: decodeEntities(m[1]), title: stripHtml(decodeEntities(m[2])) });
    }
    const snippets = [];
    while ((m = snippetRe.exec(html)) !== null && snippets.length < maxResults) {
      snippets.push(stripHtml(decodeEntities(m[1])));
    }
    for (let i = 0; i < links.length; i++) {
      const cleanUrl = cleanSearchUrl(links[i].href);
      if (!cleanUrl) continue;
      results.push({
        url: cleanUrl,
        title: links[i].title || "(untitled)",
        snippet: snippets[i] || ""
      });
    }
    return results.slice(0, maxResults);
  }
};
var SearXNGProvider = class {
  constructor(fetcher, baseUrl, categories = "general", maxResults = 10) {
    this.fetcher = fetcher;
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
    this.categories = categories || "general";
    this.maxResults = maxResults || 10;
  }
  /**
   * Search a SearXNG instance JSON API.
   * User-specified endpoint — self-hosted OR third-party.
   * The user owns responsibility for the endpoint they configure.
   *
   * GET {baseUrl}/search?q={query}&format=json&categories={categories}
   */
  async search(query) {
    if (!this.baseUrl) {
      throw new Error('SearXNG URL not configured. Set "SearXNG URL" in Vault Scholar settings.');
    }
    const url = this.baseUrl + "/search?q=" + encodeURIComponent(query) + "&format=json&categories=" + encodeURIComponent(this.categories);
    const json = await this.fetcher(url);
    let data;
    try {
      data = typeof json === "string" ? JSON.parse(json) : json;
    } catch (e) {
      throw new Error("SearXNG returned invalid JSON \u2014 check that the endpoint supports /search?format=json");
    }
    const rawResults = data && data.results || [];
    const results = [];
    for (const r of rawResults) {
      const u = normalizeUrl(r.url || "");
      if (!u) continue;
      results.push({
        url: u,
        title: stripHtml(decodeEntities(r.title || "(untitled)")),
        snippet: stripHtml(decodeEntities(r.content || r.snippet || ""))
      });
      if (results.length >= this.maxResults) break;
    }
    return results;
  }
};
function createSearchProvider(providerName, fetcher, settings = {}) {
  const name = String(providerName || "duckduckgo").toLowerCase();
  if (name === "searxng") {
    return new SearXNGProvider(fetcher, settings.searxngUrl || "", settings.searxngCategories, settings.searxngMaxResults);
  }
  return new DuckDuckGoProvider(fetcher);
}
function cleanSearchUrl(href) {
  if (!href) return null;
  const uddg = /[?&]uddg=([^&]+)/.exec(href);
  if (uddg) {
    try {
      return decodeURIComponent(uddg[1]);
    } catch (e) {
    }
  }
  return normalizeUrl(href);
}
var MAX_FETCH_BYTES = 1024 * 1024;
var ResearchMode = class {
  constructor(deps = {}) {
    this.fetcher = deps.createFetcher ? deps.createFetcher() : null;
    this.generate = deps.generate || null;
    this.modelId = deps.modelId || "qwen3:8b";
    this.settings = Object.assign({
      searchProvider: "duckduckgo",
      searxngUrl: "",
      searxngCategories: "general",
      searxngMaxResults: 10,
      maxSources: 5,
      maxSearchResults: 10
    }, deps.settings || {});
    this.trustBoundary = deps.trustBoundary || null;
    this._lastState = null;
  }
  /**
   * Run the full research pipeline.
   */
  async research(question, opts = {}) {
    const state = {
      question: String(question || "").trim(),
      stages: {},
      sources: [],
      rankedSources: [],
      retrieved: [],
      extracted: [],
      contradictions: [],
      answer: "",
      citations: [],
      vaultProposal: "",
      errors: []
    };
    const runStage = async (name, fn) => {
      try {
        state.stages[name] = { status: "running" };
        if (opts.onStage) opts.onStage(name, state.stages[name]);
        const result = await fn();
        state.stages[name] = { status: "done", ...result };
        if (opts.onStage) opts.onStage(name, state.stages[name]);
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        state.stages[name] = { status: "error", error: msg };
        state.errors.push(name + ": " + msg);
        throw e;
      }
    };
    const expansions = await runStage("queryExpansion", () => this.queryExpansion(state.question));
    state.stages.queryExpansion.queries = expansions;
    const allRaw = [];
    for (const q of expansions) {
      const raw = await runStage("internetSearch", () => this.internetSearch(q));
      allRaw.push(...raw);
    }
    const seenUrls = /* @__PURE__ */ new Set();
    state.sources = allRaw.filter((s) => {
      if (!s || !s.url || seenUrls.has(s.url)) return false;
      seenUrls.add(s.url);
      return true;
    });
    await runStage("sourceDiscovery", () => {
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
  async continueResearch(state, opts, runStage) {
    await runStage("sourceRetrieval", async () => {
      const retrieved = [];
      for (const src of state.rankedSources) {
        try {
          const text = await this.retrieveSource(src.url);
          retrieved.push({ ...src, content: text });
        } catch (e) {
          state.errors.push("retrieve " + src.url + ": " + (e instanceof Error ? e.message : String(e)));
        }
      }
      state.retrieved = retrieved;
      return { count: retrieved.length };
    });
    await runStage("evidenceExtraction", () => {
      const extracted = this.extractEvidence(state.retrieved);
      state.extracted = extracted;
      return { count: extracted.length };
    });
    await runStage("contradictionDetection", () => {
      const contradictions = this.detectContradictions(state.extracted);
      state.contradictions = contradictions;
      return { count: contradictions.length, contradictions };
    });
    await runStage("answerGeneration", async () => {
      const answer = await this.generateAnswer(state);
      state.answer = answer;
      return { length: answer.length };
    });
    await runStage("citationValidation", () => {
      const citations = this.validateCitations(state.answer, state.retrieved);
      state.citations = citations;
      return { count: citations.length, citations };
    });
    await runStage("vaultProposal", () => {
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
  async queryExpansion(question) {
    if (this.generate) {
      const prompt = [
        "You are a research query expansion assistant.",
        "Given the user question, generate 3 concise search queries (one per line, no numbering, no bullets).",
        "",
        "QUESTION:",
        question,
        "",
        "QUERIES:"
      ].join("\n");
      try {
        const out = await this.generate(this.modelId, prompt, { temperature: 0.3 });
        const lines = String(out || "").split("\n").map((l) => l.trim()).filter((l) => l && !/^\d+[.)]/.test(l)).slice(0, 5);
        if (lines.length >= 1) return lines;
      } catch (e) {
      }
    }
    return [question, question + " research paper", question + " evidence summary"];
  }
  /**
   * Stage 2 — Internet search via the configured provider.
   * Requires the fetcher; otherwise throws (fail closed).
   */
  async internetSearch(query) {
    if (!this.fetcher) {
      throw new Error("No network fetcher available \u2014 internet search is disabled");
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
  sourceDiscovery(sources) {
    return SourceClassifier.rank(sources);
  }
  /**
   * Stage 5 — Retrieve a single source's text content.
   * Coerces the fetcher result to text; caps at MAX_FETCH_BYTES.
   */
  async retrieveSource(url) {
    if (!this.fetcher) throw new Error("No network fetcher available");
    const raw = await this.fetcher(url);
    let text;
    if (typeof raw === "string") {
      text = stripHtml(raw);
    } else if (raw && typeof raw === "object" && raw.text !== void 0) {
      text = stripHtml(String(raw.text));
    } else {
      text = stripHtml(String(raw));
    }
    return text.slice(0, MAX_FETCH_BYTES);
  }
  /**
   * Stage 7 — Extract evidence (claim-like sentences) from retrieved content.
   */
  extractEvidence(retrieved) {
    const out = [];
    for (const src of retrieved || []) {
      if (!src.content) continue;
      const sentences = String(src.content).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 40 && s.length < 400);
      for (const s of sentences.slice(0, 8)) {
        out.push({ claim: s, source: src.title || src.url, url: src.url, trust: src.trust || "MEDIUM" });
      }
    }
    return out;
  }
  /**
   * Stage 8-9 — Detect contradictions across sources.
   * Heuristic: for claims sharing a topic keyword, one negates the other.
   */
  detectContradictions(extracted) {
    const items = (extracted || []).filter(Boolean);
    const contradictions = [];
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
            note: 'Sources disagree on "' + topicA + '"'
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
  async generateAnswer(state) {
    const sourcesText = state.retrieved.map(
      (s, i) => "[" + (i + 1) + "] " + s.url + "\n" + truncateText(s.content || "", 2e3)
    ).join("\n\n---\n\n");
    if (!this.generate) {
      const lines = [];
      lines.push("## Answer Summary");
      lines.push("");
      for (const e of state.extracted.slice(0, 10)) {
        lines.push("- " + e.claim + " [SOURCE: " + e.url + "]");
      }
      if (state.contradictions.length > 0) {
        lines.push("");
        lines.push("## Contradictions Found");
        lines.push("");
        for (const c of state.contradictions) {
          lines.push("- [CONTRADICTION: " + truncateText(c.topic, 120) + "]");
          lines.push("  - " + truncateText(c.claimA, 150) + " (" + c.urlA + ")");
          lines.push("  - " + truncateText(c.claimB, 150) + " (" + c.urlB + ")");
        }
      }
      return lines.join("\n");
    }
    const prompt = [
      "You are a rigorous research assistant. Synthesize an evidence-based answer.",
      "IMPORTANT: Every factual claim must be followed by a source citation in the form [SOURCE: url].",
      "If any retrieved source contradicts another, state the contradiction explicitly with [CONTRADICTION: ...].",
      "Do not invent sources. Only cite the URLs provided below.",
      "",
      "QUESTION:",
      state.question,
      "",
      "RETRIEVED SOURCES:",
      sourcesText,
      "",
      "Provide:",
      "1. Executive summary",
      "2. Key findings (each cited with [SOURCE: url])",
      "3. Contradictions (if any) with [CONTRADICTION: ...]",
      "4. Gaps and open questions",
      "",
      "ANSWER:"
    ].join("\n");
    const answer = await this.generate(this.modelId, prompt, {
      temperature: 0.2,
      numCtx: this.settings.numCtxLong || 8192
    });
    return String(answer || "").trim();
  }
  /**
   * Stage 11 — Validate citations: only URLs that were actually
   * retrieved in this run survive. Others are dropped.
   */
  validateCitations(answer, retrieved) {
    const validUrls = new Set((retrieved || []).map((s) => s.url).filter(Boolean));
    const cited = [];
    const re = /\[SOURCE:\s*([^\]]+)\]/gi;
    let m;
    while ((m = re.exec(String(answer || ""))) !== null) {
      const raw = m[1].trim();
      for (const part of raw.split(",")) {
        const u = normalizeUrl(part.trim());
        if (u && validUrls.has(u) && !cited.includes(u)) cited.push(u);
      }
    }
    return cited;
  }
  /**
   * Stage 12 — Build an evidence-gated markdown vault proposal.
   */
  buildVaultProposal(state) {
    const lines = [];
    lines.push("---");
    lines.push("title: " + summarize(state.question, 60));
    lines.push("type: research");
    lines.push("created: " + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
    lines.push("research-provider: " + (this.settings.searchProvider || "duckduckgo"));
    lines.push("sources: " + state.retrieved.length);
    lines.push("tags:");
    lines.push("  - research");
    lines.push("---");
    lines.push("");
    lines.push("# " + summarize(state.question, 80));
    lines.push("");
    lines.push("## Answer Summary");
    lines.push("");
    for (const e of state.extracted.slice(0, 10)) {
      lines.push("- " + e.claim + " [SOURCE: " + e.url + "]");
    }
    if (state.contradictions.length > 0) {
      lines.push("");
      lines.push("## Contradictions");
      lines.push("");
      for (const c of state.contradictions) {
        lines.push("- [CONTRADICTION: " + truncateText(c.topic, 120) + "]");
        lines.push("  - " + truncateText(c.claimA, 150) + " (" + c.urlA + ")");
        lines.push("  - " + truncateText(c.claimB, 150) + " (" + c.urlB + ")");
      }
    }
    lines.push("");
    lines.push("## Sources");
    lines.push("");
    for (const s of state.retrieved) {
      lines.push("- [" + s.title + "](" + s.url + ") \u2014 trust: " + (s.trust || "MEDIUM"));
    }
    lines.push("");
    lines.push("## Evidence Gate");
    lines.push("");
    lines.push("> This proposal was produced by Research Mode. Each factual claim is");
    lines.push("> tagged with its source. Claims without sources are BLOCKED by the");
    lines.push("> Evidence Gate before this document may enter the vault.");
    return lines.join("\n") + "\n";
  }
};
function extractTopic(claim) {
  const t = String(claim || "").trim();
  const words = t.replace(/[^a-zA-Z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 3);
  if (words.length === 0) return "";
  for (let n = 3; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(" ").toLowerCase();
      if (phrase.length > 8) return phrase;
    }
  }
  return words[0].toLowerCase();
}
function truncateText(str, max) {
  return String(str || "").length > max ? String(str || "").slice(0, max) + "\u2026" : String(str || "");
}
function summarize(str, max) {
  return truncateText(String(str || "").trim(), max);
}

// vault-scholar/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// vault-scholar/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// vault-scholar/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// vault-scholar/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// vault-scholar/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// vault-scholar/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path3, errorMaps, issueData } = params;
  const fullPath = [...path3, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// vault-scholar/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message == null ? void 0 : message.message;
})(errorUtil || (errorUtil = {}));

// vault-scholar/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path3, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path3;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    var _a, _b;
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message != null ? message : ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: (_a = message != null ? message : required_error) != null ? _a : ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: (_b = message != null ? message : invalid_type_error) != null ? _b : ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    var _a;
    const ctx = {
      common: {
        issues: [],
        async: (_a = params == null ? void 0 : params.async) != null ? _a : false,
        contextualErrorMap: params == null ? void 0 : params.errorMap
      },
      path: (params == null ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    var _a, _b;
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if ((_b = (_a = err == null ? void 0 : err.message) == null ? void 0 : _a.toLowerCase()) == null ? void 0 : _b.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params == null ? void 0 : params.errorMap,
        async: true
      },
      path: (params == null ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && (decoded == null ? void 0 : decoded.typ) !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch (e) {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch (e) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    var _a, _b;
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof (options == null ? void 0 : options.precision) === "undefined" ? null : options == null ? void 0 : options.precision,
      offset: (_a = options == null ? void 0 : options.offset) != null ? _a : false,
      local: (_b = options == null ? void 0 : options.local) != null ? _b : false,
      ...errorUtil.errToObj(options == null ? void 0 : options.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof (options == null ? void 0 : options.precision) === "undefined" ? null : options == null ? void 0 : options.precision,
      ...errorUtil.errToObj(options == null ? void 0 : options.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options == null ? void 0 : options.position,
      ...errorUtil.errToObj(options == null ? void 0 : options.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  var _a;
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: (_a = params == null ? void 0 : params.coerce) != null ? _a : false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: (params == null ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch (e) {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  var _a;
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: (_a = params == null ? void 0 : params.coerce) != null ? _a : false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: (params == null ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: (params == null ? void 0 : params.coerce) || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          var _a, _b, _c, _d;
          const defaultError = (_c = (_b = (_a = this._def).errorMap) == null ? void 0 : _b.call(_a, issue, ctx).message) != null ? _c : ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: (_d = errorUtil.errToObj(message).message) != null ? _d : defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      var _a, _b;
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          var _a2, _b2;
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = (_b2 = (_a2 = params.fatal) != null ? _a2 : fatal) != null ? _b2 : true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = (_b = (_a = params.fatal) != null ? _a : fatal) != null ? _b : true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// vault-scholar/src/core/settings.ts
var OLLAMA_HOST = "http://localhost:11434";
var PLUGIN_ID = "vault-scholar";
var MODELS = {
  safe: { id: "qwen3:8b", role: "\u{1F7E2} Safe / Everyday", default: true },
  deep: { id: "gemma4:12b", role: "\u{1F9E0} Deep Reasoning", default: false },
  math: { id: "mathstral:latest", role: "\u2797 Math / Science", default: false },
  coder: { id: "huihui_ai/qwen2.5-coder-abliterate:7b", role: "\u{1F4BB} Coding / Security", default: false },
  embedding: { id: "qwen3-embedding:0.6b", role: "\u{1F50E} Embeddings", default: true }
};
var SettingsSchema = external_exports.object({
  // Security
  safeMode: external_exports.boolean().default(true),
  internetResearch: external_exports.boolean().default(false),
  vaultWriteApproval: external_exports.boolean().default(true),
  scriptExecutionApproval: external_exports.boolean().default(true),
  verifyExternalBeforeWrite: external_exports.boolean().default(true),
  sandboxMode: external_exports.enum(["python", "node", "docker"]).default("python"),
  // Trust Boundary
  trustEnforcement: external_exports.boolean().default(true),
  trustThreshold: external_exports.enum([TRUST_LEVELS.TRUSTED, TRUST_LEVELS.VERIFIED, TRUST_LEVELS.INFERRED, TRUST_LEVELS.UNVERIFIED]).default(TRUST_LEVELS.VERIFIED),
  trustDisplay: external_exports.boolean().default(true),
  // Models
  activeModel: external_exports.string().default(MODELS.safe.id),
  // Context
  numCtx: external_exports.number().default(4096),
  numCtxLong: external_exports.number().default(8192),
  // VRAM
  keepEmbeddingsLoaded: external_exports.boolean().default(true),
  // Provenance
  provenanceEnabled: external_exports.boolean().default(true),
  // Snapshots
  autoSnapshotBeforeRisky: external_exports.boolean().default(true),
  snapshotMaxCount: external_exports.number().default(20),
  // RAG
  ragEnabled: external_exports.boolean().default(true),
  // Evidence-Gated Knowledge
  evidenceGating: external_exports.boolean().default(true),
  // Research Mode
  researchModeEnabled: external_exports.boolean().default(true),
  searchProvider: external_exports.enum(["duckduckgo", "searxng"]).default("duckduckgo"),
  searxngUrl: external_exports.string().default(""),
  searxngCategories: external_exports.string().default("general"),
  searxngMaxResults: external_exports.number().default(10),
  maxSources: external_exports.number().default(5),
  maxSearchResults: external_exports.number().default(10),
  // Ollama
  ollamaHost: external_exports.string().default(OLLAMA_HOST)
});
function parseSettings(raw) {
  return SettingsSchema.parse(raw || {});
}

// vault-scholar/src/core/commands.ts
var import_obsidian = require("obsidian");
var COMMANDS = [
  {
    id: "open-main",
    name: "Open Vault Scholar",
    callback: (p) => p.openMainModal()
  },
  {
    id: "research",
    name: "Research with citations",
    callback: (p) => p.promptForInput("\u{1F52C} Research topic:", async (topic) => {
      const { result, citations } = await p.research.research(topic);
      p.showResultModal("Research Results", result, citations);
    })
  },
  {
    id: "research-mode",
    name: "Research this (Research Mode)",
    callback: (p) => p.promptForInput("\u{1F50E} Research this (Research Mode):", async (question) => {
      if (!p.settings.internetResearch) {
        new import_obsidian.Notice("\u26A0\uFE0F Internet Research is OFF. Enable it in Settings \u2192 Vault Scholar.");
        return;
      }
      if (!p.settings.researchModeEnabled) {
        new import_obsidian.Notice("\u26A0\uFE0F Research Mode is disabled in settings.");
        return;
      }
      const stageNames = [];
      const state = await p.researchMode.research(question, {
        onStage: (name) => {
          stageNames.push(name);
          new import_obsidian.Notice("\u{1F52C} Stage: " + name);
        }
      });
      await p.provenance.record({
        type: "research_mode",
        content: state.answer || state.vaultProposal,
        contentSource: CONTENT_SOURCES.EXTERNAL_SOURCED,
        trustLevel: TRUST_LEVELS.VERIFIED,
        citations: state.citations,
        verificationMethod: "research_mode_pipeline",
        metadata: { question, stages: stageNames, contradictions: state.contradictions.length }
      });
      p.showResultModal("Research Mode Results", state.vaultProposal, state.citations);
    })
  },
  {
    id: "gate-content",
    name: "Gate active note with Evidence-Gated Knowledge",
    callback: (p) => {
      const view = p.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
      if (!view) {
        new import_obsidian.Notice("\u274C No active note");
        return;
      }
      const report = EvidenceGate.validateNote(view.editor.getValue());
      const text = "\u{1F6E1}\uFE0F EVIDENCE GATE REPORT\n=========================\n\nValid: " + (report.valid ? "\u2705 YES" : "\u274C NO") + "\nTotal claims: " + report.totalClaims + "\nAllowed: " + report.allowed + "\nBlocked: " + report.blocked + "\n\nOrigins:\n" + Object.entries(report.summary.origins || {}).map(([k, v]) => "  " + k + ": " + v).join("\n") + "\n\nTrust levels:\n" + Object.entries(report.summary.trust || {}).map(([k, v]) => "  " + k + ": " + v).join("\n") + (report.issues.length > 0 ? "\n\n\u{1F6AB} Blocked claims:\n" + report.issues.map((i) => "- " + i.text + "\n  \u2192 " + i.reason).join("\n") : "");
      p.showResultModal("Evidence Gate Report", text);
    }
  },
  {
    id: "lint-evidence",
    name: "Lint vault for evidence",
    callback: async (p) => {
      const files = p.app.vault.getMarkdownFiles();
      let total = 0, blocked = 0, ok = 0;
      const details = [];
      for (const file of files) {
        const content = await p.app.vault.cachedRead(file);
        const report = EvidenceGate.validateNote(content);
        total += report.totalClaims;
        blocked += report.blocked;
        if (report.blocked > 0) {
          details.push(file.path + ": " + report.blocked + " blocked");
        } else {
          ok++;
        }
      }
      const text = "\u{1F50D} VAULT EVIDENCE LINT\n======================\n\nFiles: " + files.length + "\nTotal claims: " + total + "\nBlocked: " + blocked + "\nFiles with issues: " + details.length + "\n\n" + (details.length > 0 ? details.join("\n") : "\u2705 No unsourced external claims detected");
      p.showResultModal("Vault Evidence Lint", text);
    }
  },
  {
    id: "format-simulation",
    name: "Format simulation result header",
    callback: (p) => {
      const view = p.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
      const header = EvidenceGate.simulationHeader(
        "Unspecified model",
        ["(none stated)"],
        "(none stated)",
        "Unspecified"
      );
      if (!view) {
        p.showResultModal("Simulation Header Template", header);
        new import_obsidian.Notice("\u{1F4A1} No active note \u2014 header copied to result modal");
        return;
      }
      const editor = view.editor;
      const doc = editor.getDoc();
      const cursor = doc.getCursor();
      doc.replaceRange(header + "\n\n", cursor);
      new import_obsidian.Notice("\u2705 Simulation header inserted");
    }
  },
  {
    id: "derive-math",
    name: "Derive math/physics step-by-step",
    callback: (p) => p.promptForInput("\u2797 Problem to derive:", async (problem) => {
      const result = await p.mathPhysics.derive(problem);
      p.showResultModal("Derivation", result);
    })
  },
  {
    id: "analyze-patterns",
    name: "Analyze patterns/symmetries/invariants",
    callback: (p) => p.promptForInput("\u{1F50D} Input to analyze:", async (input) => {
      const result = await p.mathPhysics.analyzePatterns(input);
      p.showResultModal("Pattern Analysis", result);
    })
  },
  {
    id: "audit-code",
    name: "Audit code for vulnerabilities",
    callback: (p) => p.promptForInput("\u{1F4BB} Code to audit (paste code):", async (code) => {
      const result = await p.codeAuditor.audit(code);
      const staticText = result.staticFindings.length > 0 ? result.staticFindings.map((f) => `- [${f.severity.toUpperCase()}] ${f.name}: ${f.match}`).join("\n") : "- No static pattern matches";
      p.showResultModal("Code Audit", `STATIC ANALYSIS:
${staticText}

AI ANALYSIS:
${result.aiAnalysis}`);
    })
  },
  {
    id: "generate-sim-spec",
    name: "Generate simulation specification",
    callback: (p) => p.promptForInput("\u{1F3AF} Simulation description:", async (desc) => {
      const spec = await p.simulation.generateSpec(desc);
      p.showResultModal("Simulation Specification", spec);
    })
  },
  {
    id: "build-sim-script",
    name: "Build simulation script from spec",
    callback: (p) => p.promptForInput("\u{1F4DD} Paste simulation spec:", async (spec) => {
      const { script, full } = await p.simulation.buildScript(spec);
      p.showResultModal("Simulation Script", full, [], script);
    })
  },
  {
    id: "run-script-sandbox",
    name: "Run script in sandbox",
    callback: (p) => p.promptForInput("\u{1F3C3} Paste script to run in sandbox:", async (code) => {
      var _a;
      if (p.settings.scriptExecutionApproval) {
        const approved = await p.confirmModal("Run in sandbox?", "This will execute the script in an isolated sandbox. Continue?");
        if (!approved) {
          new import_obsidian.Notice("\u274C Script execution cancelled");
          return;
        }
      }
      const result = await p.sandbox.run(code);
      p.showResultModal("Sandbox Output", `EXIT CODE: ${(_a = result.exitCode) != null ? _a : "N/A"}

STDOUT:
${result.stdout}

STDERR:
${result.stderr}`);
    })
  },
  {
    id: "semantic-search",
    name: "Semantic search vault",
    callback: (p) => p.promptForInput("\u{1F50E} Search query:", async (query) => {
      const results = await p.rag.search(query);
      if (results.length === 0) {
        new import_obsidian.Notice("No results found. Try indexing the vault first.");
        return;
      }
      const text = results.map(
        (r, i) => `### ${i + 1}. [${r.chunk.note}] (${(r.score * 100).toFixed(1)}%)
${r.chunk.text}`
      ).join("\n\n");
      p.showResultModal("Semantic Search Results", text);
    })
  },
  {
    id: "index-vault",
    name: "Index vault for semantic search",
    callback: (p) => p.rag.indexVault()
  },
  {
    id: "create-snapshot",
    name: "Create vault snapshot",
    callback: (p) => p.promptForInput("\u{1F4F8} Snapshot label:", async (label) => {
      await p.snapshotManager.createSnapshot(label || "manual");
    })
  },
  {
    id: "list-snapshots",
    name: "List snapshots",
    callback: (p) => {
      const snapshots = p.snapshotManager.listSnapshots();
      if (snapshots.length === 0) {
        new import_obsidian.Notice("No snapshots yet");
        return;
      }
      p.showResultModal("Snapshots", snapshots.map((s, i) => `${i + 1}. ${s}`).join("\n"));
    }
  },
  {
    id: "restore-snapshot",
    name: "Restore snapshot",
    callback: (p) => p.promptForInput("\u267B\uFE0F Snapshot name to restore:", async (name) => {
      if (p.settings.vaultWriteApproval) {
        const approved = await p.confirmModal("Restore snapshot?", `This will overwrite vault files with snapshot "${name}". Continue?`);
        if (!approved) {
          new import_obsidian.Notice("\u274C Restore cancelled");
          return;
        }
      }
      await p.snapshotManager.restoreSnapshot(name);
    })
  },
  {
    id: "view-provenance",
    name: "View provenance records",
    callback: (p) => {
      p.provenance.getAll().then((records) => {
        if (records.length === 0) {
          new import_obsidian.Notice("No provenance records yet");
          return;
        }
        const text = records.slice(-20).reverse().map(
          (r) => `### ${r.timestamp}
**Type:** ${r.type} | **Model:** ${r.model} | **Verified:** ${r.verified}
${truncate2(r.content, 300)}`
        ).join("\n\n---\n\n");
        p.showResultModal("Provenance Records", text);
      });
    }
  },
  {
    id: "switch-model",
    name: "Switch active model",
    callback: (p) => {
      p.promptForInput("\u{1F9E0} Switch model (safe/deep/math/coder):", async (choice) => {
        const key = choice.trim().toLowerCase();
        if (MODELS[key]) {
          await p.modelManager.switchTo(MODELS[key].id);
        } else {
          new import_obsidian.Notice("Invalid model key. Use: safe, deep, math, coder");
        }
      });
    }
  },
  {
    id: "check-vram",
    name: "Check loaded models (VRAM)",
    callback: async (p) => {
      const models = await p.ollama.ps();
      if (models.length === 0) {
        new import_obsidian.Notice("No models currently loaded in VRAM");
        return;
      }
      const text = models.map((m) => `- ${m.name} (${(m.size_vram / 1e9).toFixed(1)} GB VRAM)`).join("\n");
      p.showResultModal("Loaded Models (VRAM)", text);
    }
  },
  {
    id: "classify-note",
    name: "Classify current note trust level",
    callback: (p) => {
      const view = p.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
      if (!view) {
        new import_obsidian.Notice("\u274C No active note open");
        return;
      }
      const content = view.editor.getValue();
      const record = TrustClassifier.classify(content, {
        source: CONTENT_SOURCES.USER_CREATED,
        trustLevel: TRUST_LEVELS.TRUSTED,
        verifiedBy: "user"
      });
      new import_obsidian.Notice(`\u{1F6E1}\uFE0F Note classified: ${record.trustLevel} (${record.contentSource})`);
      p.showResultModal(
        "Trust Classification",
        `TRUST LEVEL: ${record.trustLevel}
CONTENT SOURCE: ${record.contentSource}
CONFIDENCE: ${record.confidence}%
VERIFIED: ${record.verified}
VERIFIED BY: ${record.verifiedBy}
HASH: ${record.hash.slice(0, 16)}\u2026`
      );
    }
  },
  {
    id: "view-trust",
    name: "View trust boundary status",
    callback: (p) => {
      const trail = p.trustBoundary.auditTrail();
      const status = `TRUST BOUNDARY: ${p.settings.trustEnforcement ? "ACTIVE \u{1F6E1}\uFE0F" : "DISABLED"}
THRESHOLD: ${p.settings.trustThreshold}

DECISIONS LOGGED: ${trail.length}

` + (trail.length > 0 ? trail.slice(-10).reverse().map(
        (d) => `${d.timestamp} \u2014 ${d.operation}: ${d.allowed ? "\u2705 ALLOWED" : "\u{1F6AB} BLOCKED"} (${d.level} \u2192 required ${d.required})`
      ).join("\n") : "No trust decisions yet.");
      p.showResultModal("Trust Boundary Status", status);
    }
  },
  {
    id: "trust-audit",
    name: "Run trust audit across vault",
    callback: (p) => p.trustAudit()
  },
  {
    id: "write-to-note",
    name: "Write result to a new note",
    callback: (p) => p.promptForInput("\u{1F4DD} Note title:", async (title) => {
      if (p.settings.vaultWriteApproval) {
        const approved = await p.confirmModal("Create note?", `Create note "${title}" in vault?`);
        if (!approved) {
          new import_obsidian.Notice("\u274C Note creation cancelled");
          return;
        }
      }
      p.promptForInput("\u{1F4DD} Note content:", async (content) => {
        const safeTitle = sanitizeFilename(title);
        const filePath = `Vault Scholar/${safeTitle}.md`;
        await p.app.vault.createFolder("Vault Scholar").catch(() => {
        });
        await p.app.vault.create(filePath, content);
        new import_obsidian.Notice(`\u2705 Note created: ${filePath}`);
      });
    })
  }
];
function truncate2(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "\u2026" : str;
}
function sanitizeFilename(name) {
  return String(name || "").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 60);
}

// vault-scholar/src/ui/modals.ts
var import_obsidian2 = require("obsidian");

// vault-scholar/src/utils/strings.ts
function sanitizeFilename2(name) {
  return String(name || "").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 60);
}

// vault-scholar/src/ui/modals.ts
var BaseModal = class extends import_obsidian2.Modal {
  constructor() {
    super(...arguments);
    this._promise = null;
  }
  openAsync() {
    if (!this._promise) {
      this._promise = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
      });
    }
    this.open();
    return this._promise;
  }
  complete(value) {
    this.close();
    if (this.resolve) this.resolve(value);
  }
  fail(reason) {
    this.close();
    if (this.reject) this.reject(reason);
  }
};
var InputModal = class extends BaseModal {
  constructor(app, placeholder) {
    super(app);
    this.placeholder = placeholder;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.placeholder });
    const textarea = contentEl.createEl("textarea", {
      attr: { rows: "6", style: "width: 100%; font-family: monospace;" }
    });
    textarea.placeholder = "Type here...";
    const btnRow = contentEl.createDiv({ cls: "vs-btn-row" });
    const submitBtn = btnRow.createEl("button", { text: "Submit", cls: "mod-cta" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    submitBtn.addEventListener("click", () => {
      const value = textarea.value.trim();
      if (value) this.complete(value);
    });
    cancelBtn.addEventListener("click", () => this.complete(""));
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        const value = textarea.value.trim();
        if (value) this.complete(value);
      }
    });
    textarea.focus();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ResultModal = class extends BaseModal {
  constructor(app, title, content, citations = [], code = null, plugin = null) {
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
    contentEl.addClass("vs-result-modal");
    contentEl.createEl("h2", { text: this.title });
    if (this.citations.length > 0) {
      const citeEl = contentEl.createDiv({ cls: "vs-citations" });
      citeEl.createEl("strong", { text: "Citations: " });
      citeEl.createEl("span", { text: this.citations.join(", ") });
    }
    const pre = contentEl.createEl("pre", { cls: "vs-result-content" });
    pre.setText(this.content);
    const btnRow = contentEl.createDiv({ cls: "vs-btn-row" });
    if (this.code) {
      const copyBtn2 = btnRow.createEl("button", { text: "\u{1F4CB} Copy Code" });
      copyBtn2.addEventListener("click", () => {
        navigator.clipboard.writeText(this.code);
        new import_obsidian2.Notice("Code copied to clipboard");
      });
    }
    const copyBtn = btnRow.createEl("button", { text: "\u{1F4CB} Copy Result" });
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this.content);
      new import_obsidian2.Notice("Result copied to clipboard");
    });
    const saveBtn = btnRow.createEl("button", { text: "\u{1F4BE} Save to Note" });
    saveBtn.addEventListener("click", async () => {
      const safeTitle = sanitizeFilename2(this.title);
      const filePath = `Vault Scholar/${safeTitle}.md`;
      await this.plugin.app.vault.createFolder("Vault Scholar").catch(() => {
      });
      await this.plugin.app.vault.create(filePath, this.content);
      new import_obsidian2.Notice(`\u2705 Saved to ${filePath}`);
      this.close();
    });
    const closeBtn = btnRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};
var MainModal = class extends BaseModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("vs-main-modal");
    contentEl.createEl("h2", { text: "\u{1F989} Vault Scholar" });
    const status = contentEl.createDiv({ cls: "vs-status" });
    status.createEl("p", { text: `Active Model: ${this.plugin.modelManager.activeModel}` });
    status.createEl("p", { text: `Sandbox: ${this.plugin.settings.sandboxMode.toUpperCase()}` });
    status.createEl("p", { text: `Internet Research: ${this.plugin.settings.internetResearch ? "ON" : "OFF"}` });
    status.createEl("p", { text: `Vault Write Approval: ${this.plugin.settings.vaultWriteApproval ? "REQUIRED" : "AUTO"}` });
    status.createEl("p", { text: `Script Execution Approval: ${this.plugin.settings.scriptExecutionApproval ? "REQUIRED" : "AUTO"}` });
    status.createEl("p", { text: `Trust Boundary: ${this.plugin.settings.trustEnforcement ? "\u{1F6E1}\uFE0F ACTIVE" : "\u26A0\uFE0F DISABLED"} (${this.plugin.settings.trustThreshold})` });
    const actions = contentEl.createDiv({ cls: "vs-actions" });
    const actionsList = [
      ["\u{1F52C} Research", "research"],
      ["\u2797 Derive Math", "derive-math"],
      ["\u{1F50D} Analyze Patterns", "analyze-patterns"],
      ["\u{1F4BB} Audit Code", "audit-code"],
      ["\u{1F3AF} Sim Spec", "generate-sim-spec"],
      ["\u{1F4DD} Build Sim Script", "build-sim-script"],
      ["\u{1F3C3} Run in Sandbox", "run-script-sandbox"],
      ["\u{1F50E} Semantic Search", "semantic-search"],
      ["\u{1F4F8} Snapshot", "create-snapshot"],
      ["\u267B\uFE0F Restore", "restore-snapshot"],
      ["\u{1F4DC} Provenance", "view-provenance"],
      ["\u{1F6E1}\uFE0F Trust Status", "view-trust"],
      ["\u{1F512} Trust Audit", "trust-audit"],
      ["\u{1F52C} Research Mode", "research-mode"],
      ["\u{1F6E1}\uFE0F Evidence Gate", "gate-content"],
      ["\u{1F9E0} Switch Model", "switch-model"]
    ];
    for (const [label, cmdId] of actionsList) {
      const btn = actions.createEl("button", { text: label, cls: "vs-action-btn" });
      btn.addEventListener("click", () => {
        this.close();
        this.app.commands.executeCommandById(`vault-scholar:${cmdId}`);
      });
    }
    const closeBtn = contentEl.createEl("button", { text: "Close", cls: "vs-close-btn" });
    closeBtn.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};

// vault-scholar/src/ui/components.ts
var import_obsidian3 = require("obsidian");
var SETTING_FIELDS = [
  // ===== Security =====
  { type: "toggle", key: "safeMode", name: "Safe Mode", desc: "Default to safe model (Qwen3 8B) for everyday tasks" },
  { type: "toggle", key: "internetResearch", name: "Internet Research", desc: "Allow external sources in research (OFF by default)" },
  { type: "toggle", key: "vaultWriteApproval", name: "Vault Write Approval", desc: "Require approval before writing to vault" },
  { type: "toggle", key: "scriptExecutionApproval", name: "Script Execution Approval", desc: "Require approval before running scripts in sandbox" },
  { type: "toggle", key: "verifyExternalBeforeWrite", name: "Verify External Before Write", desc: "Verify external sources before writing to vault" },
  // ===== Trust Boundary =====
  { type: "toggle", key: "trustEnforcement", name: "Enable Trust Enforcement", desc: "Enforce trust levels on vault operations. Unverified AI output cannot silently overwrite trusted content." },
  {
    type: "dropdown",
    key: "trustThreshold",
    name: "Trust Threshold",
    desc: "Minimum trust level required for automatic operations",
    options: {
      [TRUST_LEVELS.TRUSTED]: "\u{1F6E1}\uFE0F TRUSTED \u2014 User verified only",
      [TRUST_LEVELS.VERIFIED]: "\u2705 VERIFIED \u2014 Cross-checked with citations",
      [TRUST_LEVELS.INFERRED]: "\u{1F9E0} INFERRED \u2014 Logically derived",
      [TRUST_LEVELS.UNVERIFIED]: "\u26A0\uFE0F UNVERIFIED \u2014 No checks"
    }
  },
  { type: "toggle", key: "trustDisplay", name: "Show Trust Badges", desc: "Display trust level badges in result modals and status bar" },
  // ===== Sandbox =====
  {
    type: "dropdown",
    key: "sandboxMode",
    name: "Sandbox Mode",
    desc: "Code execution isolation level",
    options: {
      "python": "Python (subprocess isolation)",
      "node": "Node (vm sandbox)",
      "docker": "Docker (container isolation)"
    }
  },
  // ===== Models =====
  {
    type: "dropdown",
    key: "activeModel",
    name: "Active Model",
    desc: "Current main task model",
    options: (() => {
      const opts = {};
      for (const [key, m] of Object.entries(MODELS)) {
        if (key !== "embedding") opts[m.id] = `${m.role} \u2014 ${m.id}`;
      }
      return opts;
    })()
  },
  { type: "toggle", key: "keepEmbeddingsLoaded", name: "Keep Embeddings Loaded", desc: "Keep qwen3-embedding loaded in VRAM for instant RAG" },
  // ===== Context =====
  { type: "slider", key: "numCtx", name: "Context Window (tokens)", desc: "Default context size. Increase for long derivations/code.", min: 2048, max: 16384, step: 1024 },
  { type: "slider", key: "numCtxLong", name: "Long Context Window (tokens)", desc: "Used for derivations, research, and large code files", min: 4096, max: 32768, step: 2048 },
  // ===== Provenance =====
  { type: "toggle", key: "provenanceEnabled", name: "Enable Provenance", desc: "Record every claim, equation, and script with source, model, and timestamp" },
  // ===== Snapshots =====
  { type: "toggle", key: "autoSnapshotBeforeRisky", name: "Auto-snapshot before risky ops", desc: "Create a snapshot before vault writes and script runs" },
  { type: "slider", key: "snapshotMaxCount", name: "Max snapshots", desc: "Maximum number of snapshots to keep", min: 5, max: 50, step: 5 },
  // ===== Evidence-Gated Knowledge =====
  { type: "toggle", key: "evidenceGating", name: "Enable Evidence Gating", desc: "Block external factual claims without a source from entering the vault (Section 9)" },
  // ===== Research Mode =====
  { type: "toggle", key: "researchModeEnabled", name: "Enable Research Mode", desc: "Allow the 13-stage research pipeline (Section 10)" },
  {
    type: "dropdown",
    key: "searchProvider",
    name: "Search Provider",
    desc: "DuckDuckGo (zero-config) or SearXNG (user-specified endpoint \u2014 self-hosted OR third-party)",
    options: {
      "duckduckgo": "DuckDuckGo (zero-config, no API key)",
      "searxng": "SearXNG (user-specified endpoint)"
    }
  },
  { type: "text", key: "searxngUrl", name: "SearXNG URL", desc: "Your SearXNG instance endpoint \u2014 self-hosted (e.g. http://localhost:8080) OR third-party (e.g. https://searx.be). Must support /search?format=json. User is responsible for the endpoint.", placeholder: "http://localhost:8080", disabled: (s) => s.searchProvider !== "searxng" },
  { type: "text", key: "searxngCategories", name: "SearXNG Categories", desc: "SearXNG search categories (e.g. general, science)", placeholder: "general" },
  { type: "slider", key: "maxSources", name: "Max Sources", desc: "Maximum number of sources to retrieve and analyze", min: 1, max: 20, step: 1 },
  { type: "slider", key: "maxSearchResults", name: "Max Search Results", desc: "Maximum search results per query", min: 3, max: 30, step: 1 },
  // ===== RAG =====
  { type: "toggle", key: "ragEnabled", name: "Enable RAG", desc: "Semantic search and context retrieval from vault" },
  // ===== Ollama =====
  { type: "text", key: "ollamaHost", name: "Ollama Host", desc: "Ollama API endpoint", placeholder: "http://localhost:11434" }
];
function addSettingField(containerEl, plugin, def) {
  const { settings, saveSettings } = plugin;
  switch (def.type) {
    case "toggle": {
      new import_obsidian3.Setting(containerEl).setName(def.name).setDesc(def.desc).addToggle((t) => t.setValue(settings[def.key]).onChange(async (v) => {
        settings[def.key] = v;
        if (def.onChange) def.onChange(v);
        await saveSettings();
      }));
      break;
    }
    case "dropdown": {
      new import_obsidian3.Setting(containerEl).setName(def.name).setDesc(def.desc).addDropdown((d) => {
        for (const [value, label] of Object.entries(def.options)) {
          d.addOption(value, label);
        }
        d.setValue(settings[def.key]);
        d.onChange(async (v) => {
          settings[def.key] = v;
          if (def.onChange) def.onChange(v);
          await saveSettings();
        });
      });
      break;
    }
    case "text": {
      new import_obsidian3.Setting(containerEl).setName(def.name).setDesc(def.desc).addText((t) => {
        t.setPlaceholder(def.placeholder || "").setValue(settings[def.key] || "").setDisabled(def.disabled ? def.disabled(settings) : false).onChange(async (v) => {
          settings[def.key] = v.trim();
          if (def.onChange) def.onChange(v.trim());
          await saveSettings();
        });
      });
      break;
    }
    case "slider": {
      new import_obsidian3.Setting(containerEl).setName(def.name).setDesc(def.desc).addSlider((s) => {
        var _a;
        s.setLimits(def.min, def.max, def.step).setValue((_a = settings[def.key]) != null ? _a : def.min).setDynamicTooltip().onChange(async (v) => {
          settings[def.key] = v;
          if (def.onChange) def.onChange(v);
          await saveSettings();
        });
      });
      break;
    }
    case "button": {
      new import_obsidian3.Setting(containerEl).setName(def.name).setDesc(def.desc).addButton((b) => b.setButtonText(def.name).onClick(def.onClick));
      break;
    }
  }
}
function addActionButtons(containerEl, plugin) {
  containerEl.createEl("h3", { text: "\u26A1 Actions" });
  new import_obsidian3.Setting(containerEl).setName("Index vault for RAG").setDesc("Embed all notes for semantic search").addButton((b) => b.setButtonText("Index Vault").onClick(() => plugin.rag.indexVault()));
  new import_obsidian3.Setting(containerEl).setName("Check loaded models").setDesc("View current VRAM usage").addButton((b) => b.setButtonText("Check VRAM").onClick(async () => {
    const models = await plugin.ollama.ps();
    if (models.length === 0) {
      new import_obsidian3.Notice("No models currently loaded");
      return;
    }
    new import_obsidian3.Notice(models.map((m) => `${m.name}: ${(m.size_vram / 1e9).toFixed(1)} GB`).join("\n"));
  }));
  new import_obsidian3.Setting(containerEl).setName("Create snapshot").setDesc("Backup vault to snapshot").addButton((b) => b.setButtonText("Snapshot Now").onClick(() => plugin.snapshotManager.createSnapshot("manual")));
}

// vault-scholar/src/main.ts
var OllamaClient = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.host = plugin.settings.ollamaHost;
  }
  async request(endpoint, body) {
    const url = `${this.host}${endpoint}`;
    const res = await (0, import_obsidian4.requestUrl)({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      throw: false
    });
    if (res.status >= 400) {
      throw new Error(`Ollama error ${res.status}: ${res.text}`);
    }
    return res.json;
  }
  async chat(model, messages, opts = {}) {
    var _a;
    const body = {
      model,
      messages,
      stream: false,
      options: {
        num_ctx: opts.numCtx || this.plugin.settings.numCtx,
        temperature: (_a = opts.temperature) != null ? _a : 0.7
      }
    };
    if (opts.keepAlive) body.keep_alive = opts.keepAlive;
    const res = await this.request("/api/chat", body);
    return res.message ? res.message.content : "";
  }
  async generate(model, prompt, opts = {}) {
    var _a;
    const body = {
      model,
      prompt,
      stream: false,
      options: {
        num_ctx: opts.numCtx || this.plugin.settings.numCtx,
        temperature: (_a = opts.temperature) != null ? _a : 0.7
      }
    };
    if (opts.keepAlive) body.keep_alive = opts.keepAlive;
    const res = await this.request("/api/generate", body);
    return res.response || "";
  }
  async embed(texts) {
    const res = await this.request("/api/embed", {
      model: MODELS.embedding.id,
      input: Array.isArray(texts) ? texts : [texts]
    });
    return res.embeddings || [];
  }
  async listModels() {
    const res = await this.request("/api/tags", {});
    return res.models || [];
  }
  async ps() {
    const res = await this.request("/api/ps", {});
    return res.models || [];
  }
  async show(model) {
    const res = await this.request("/api/show", { model });
    return res;
  }
  async pull(model) {
    const res = await this.request("/api/pull", { model, stream: false });
    return res;
  }
  async unload(model) {
    try {
      await this.request("/api/generate", { model, keep_alive: 0, prompt: "" });
    } catch (e) {
    }
  }
};
var ModelManager = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.client = plugin.ollama;
    this.activeModel = plugin.settings.activeModel;
    this.semanticMemory = "";
  }
  async switchTo(modelId, opts = {}) {
    if (modelId === this.activeModel && !opts.force) return;
    this.semanticMemory = this.plugin.workingMemory || "";
    await this.client.unload(this.activeModel);
    await this.client.generate(modelId, "Hello", { keepAlive: "5m" });
    this.activeModel = modelId;
    this.plugin.settings.activeModel = modelId;
    await this.plugin.saveSettings();
    this.plugin.updateStatusBar();
    new import_obsidian4.Notice(`\u{1F9E0} Model switched to: ${modelId}`);
  }
  async ensureEmbeddingsLoaded() {
    if (!this.plugin.settings.keepEmbeddingsLoaded) return;
    try {
      await this.client.embed(["warmup"]);
    } catch (e) {
    }
  }
};
var TaskRouter = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  classify(input) {
    const text = input.toLowerCase();
    const rules = [
      { model: "math", pattern: /(derive|derivation|integral|derivative|equation|solve|proof|theorem|calculus|algebra|physics|symmetry|invariant|lagrangian|hamiltonian|schr|maxwell|newton|fourier|laplace|eigen|tensor|vector field|differential)/ },
      { model: "coder", pattern: /(code|script|debug|vulnerab|security|exploit|function|class|api|syntax|error|bug|simulation script|python|javascript|typescript|sql|regex|audit)/ },
      { model: "deep", pattern: /(research|synthesize|analyze|compare|evaluate|critique|literature|paper|theory|concept|explain in depth|reason)/ }
    ];
    for (const rule of rules) {
      if (rule.pattern.test(text)) return rule.model;
    }
    return "safe";
  }
  async route(input, opts = {}) {
    const target = opts.model || this.classify(input);
    const modelId = MODELS[target] ? MODELS[target].id : target;
    await this.plugin.modelManager.switchTo(modelId);
    return { target, modelId };
  }
};
var ProvenanceEngine = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.dir = import_path2.default.join(plugin.assetsDir, "provenance");
    this.logFile = import_path2.default.join(this.dir, "provenance.jsonl");
  }
  init() {
    if (!import_fs2.default.existsSync(this.dir)) import_fs2.default.mkdirSync(this.dir, { recursive: true });
  }
  async record(entry) {
    var _a;
    if (!this.plugin.settings.provenanceEnabled) return {};
    this.init();
    const trust = TrustClassifier.classify(entry.content || "", {
      source: entry.contentSource || CONTENT_SOURCES.AI_GENERATED,
      trustLevel: entry.trustLevel,
      verifiedBy: entry.verifiedBy,
      confidence: entry.confidence,
      citations: entry.citations || [],
      model: entry.model || this.plugin.modelManager.activeModel,
      metadata: entry.metadata || {}
    });
    const record = {
      id: hashString(nowISO() + Math.random()),
      timestamp: nowISO(),
      type: entry.type || "claim",
      content: entry.content || "",
      sourceNote: entry.sourceNote || null,
      model: entry.model || this.plugin.modelManager.activeModel,
      citations: entry.citations || [],
      verified: (_a = entry.verified) != null ? _a : trust.verified,
      verificationMethod: entry.verificationMethod || null,
      hash: hashString(entry.content || ""),
      metadata: entry.metadata || {},
      // Trust Boundary metadata
      trustLevel: trust.trustLevel,
      contentSource: trust.contentSource,
      confidence: trust.confidence,
      verifiedBy: trust.verifiedBy
    };
    import_fs2.default.appendFileSync(this.logFile, JSON.stringify(record) + "\n");
    return record;
  }
  async getAll() {
    if (!import_fs2.default.existsSync(this.logFile)) return [];
    const lines = import_fs2.default.readFileSync(this.logFile, "utf8").split("\n").filter(Boolean);
    return lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
  }
  async getByType(type) {
    const all = await this.getAll();
    return all.filter((r) => r.type === type);
  }
};
var SnapshotManager = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.dir = import_path2.default.join(plugin.assetsDir, "snapshots");
  }
  init() {
    if (!import_fs2.default.existsSync(this.dir)) import_fs2.default.mkdirSync(this.dir, { recursive: true });
  }
  async createSnapshot(label = "manual") {
    this.init();
    const vaultPath = this.plugin.app.vault.adapter.getBasePath();
    const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const name = `${ts}_${sanitizeFilename2(label)}`;
    const dest = import_path2.default.join(this.dir, name);
    import_fs2.default.mkdirSync(dest, { recursive: true });
    const exclude = /* @__PURE__ */ new Set([".obsidian", ".trash", ".git", ".copilot-index", ".megaignore"]);
    const copyRecursive = (src, dst) => {
      const entries = import_fs2.default.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        if (exclude.has(entry.name)) continue;
        const srcPath = import_path2.default.join(src, entry.name);
        const dstPath = import_path2.default.join(dst, entry.name);
        if (entry.isDirectory()) {
          import_fs2.default.mkdirSync(dstPath, { recursive: true });
          copyRecursive(srcPath, dstPath);
        } else {
          import_fs2.default.copyFileSync(srcPath, dstPath);
        }
      }
    };
    copyRecursive(vaultPath, dest);
    const snapshots = import_fs2.default.readdirSync(this.dir).filter((f) => import_fs2.default.statSync(import_path2.default.join(this.dir, f)).isDirectory());
    const max = this.plugin.settings.snapshotMaxCount;
    if (snapshots.length > max) {
      const toRemove = snapshots.sort().slice(0, snapshots.length - max);
      for (const s of toRemove) {
        import_fs2.default.rmSync(import_path2.default.join(this.dir, s), { recursive: true, force: true });
      }
    }
    new import_obsidian4.Notice(`\u{1F4F8} Snapshot created: ${name}`);
    return name;
  }
  listSnapshots() {
    if (!import_fs2.default.existsSync(this.dir)) return [];
    return import_fs2.default.readdirSync(this.dir).filter((f) => import_fs2.default.statSync(import_path2.default.join(this.dir, f)).isDirectory()).sort().reverse();
  }
  async restoreSnapshot(name) {
    const src = import_path2.default.join(this.dir, name);
    if (!import_fs2.default.existsSync(src)) {
      new import_obsidian4.Notice("\u274C Snapshot not found");
      return false;
    }
    const vaultPath = this.plugin.app.vault.adapter.getBasePath();
    const exclude = /* @__PURE__ */ new Set([".obsidian", ".trash", ".git", ".copilot-index"]);
    const copyRecursive = (srcDir, dstDir) => {
      const entries = import_fs2.default.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        if (exclude.has(entry.name)) continue;
        const srcPath = import_path2.default.join(srcDir, entry.name);
        const dstPath = import_path2.default.join(dstDir, entry.name);
        if (entry.isDirectory()) {
          import_fs2.default.mkdirSync(dstPath, { recursive: true });
          copyRecursive(srcPath, dstPath);
        } else {
          import_fs2.default.copyFileSync(srcPath, dstPath);
        }
      }
    };
    copyRecursive(src, vaultPath);
    new import_obsidian4.Notice(`\u267B\uFE0F Restored snapshot: ${name}`);
    return true;
  }
};
var RAGEngine = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.dir = import_path2.default.join(plugin.assetsDir, "vectorstore");
    this.indexFile = import_path2.default.join(this.dir, "index.json");
    this.index = { chunks: [], embeddings: [] };
  }
  init() {
    if (!import_fs2.default.existsSync(this.dir)) import_fs2.default.mkdirSync(this.dir, { recursive: true });
    if (import_fs2.default.existsSync(this.indexFile)) {
      try {
        this.index = JSON.parse(import_fs2.default.readFileSync(this.indexFile, "utf8"));
      } catch (e) {
        this.index = { chunks: [], embeddings: [] };
      }
    }
  }
  save() {
    import_fs2.default.writeFileSync(this.indexFile, JSON.stringify(this.index));
  }
  async indexNote(note) {
    if (!this.plugin.settings.ragEnabled) return;
    this.init();
    const content = note.content || "";
    if (content.length < 50) return;
    const chunks = [];
    const paragraphs = content.split(/\n\s*\n/);
    let current = "";
    for (const p of paragraphs) {
      if ((current + p).length > 500) {
        if (current) chunks.push(current.trim());
        current = p;
      } else {
        current += "\n\n" + p;
      }
    }
    if (current) chunks.push(current.trim());
    const embeddings = await this.plugin.ollama.embed(chunks);
    for (let i = 0; i < chunks.length; i++) {
      this.index.chunks.push({
        text: chunks[i],
        note: note.path,
        hash: hashString(chunks[i])
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
    new import_obsidian4.Notice(`\u{1F50E} Indexed ${files.length} notes`);
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
      chunk: this.index.chunks[i]
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).filter((r) => r.score > 0.3);
  }
};
var SandboxManager = class {
  constructor(plugin) {
    this.plugin = plugin;
    this.dir = import_path2.default.join(plugin.assetsDir, "sandbox");
    this.tempDir = import_path2.default.join(this.dir, "tmp");
    this._nodeOutput = "";
    this._nodeError = "";
  }
  init() {
    if (!import_fs2.default.existsSync(this.dir)) import_fs2.default.mkdirSync(this.dir, { recursive: true });
    if (!import_fs2.default.existsSync(this.tempDir)) import_fs2.default.mkdirSync(this.tempDir, { recursive: true });
  }
  async runPython(code, opts = {}) {
    this.init();
    const timeout = opts.timeout || 15e3;
    const scriptFile = import_path2.default.join(this.tempDir, `script_${Date.now()}.py`);
    import_fs2.default.writeFileSync(scriptFile, code);
    return new Promise((resolve) => {
      const child = (0, import_child_process.spawn)("python", [scriptFile], {
        cwd: this.tempDir,
        env: { ...process.env, PYTHONNOUSERSITE: "1" },
        windowsHide: true
      });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ ok: false, stdout, stderr: stderr + "\n[Timeout: killed after " + timeout + "ms]", timedOut: true });
      }, timeout);
      child.stdout.on("data", (d) => stdout += d.toString());
      child.stderr.on("data", (d) => stderr += d.toString());
      child.on("close", (code2) => {
        clearTimeout(timer);
        import_fs2.default.unlinkSync(scriptFile);
        resolve({ ok: code2 === 0, stdout, stderr, exitCode: code2 });
      });
    });
  }
  async runNode(code, opts = {}) {
    const timeout = opts.timeout || 5e3;
    const sandbox = {
      console: {
        log: (...args) => {
          this._nodeOutput += args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") + "\n";
        },
        error: (...args) => {
          this._nodeError += args.map((a) => String(a)).join(" ") + "\n";
        }
      },
      Math,
      JSON,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      parseInt,
      parseFloat,
      isNaN,
      isFinite
    };
    this._nodeOutput = "";
    this._nodeError = "";
    try {
      import_vm.default.createContext(sandbox);
      const result = import_vm.default.runInContext(code, sandbox, { timeout });
      return { ok: true, stdout: this._nodeOutput, stderr: this._nodeError, result: result !== void 0 ? String(result) : "" };
    } catch (e) {
      return { ok: false, stdout: this._nodeOutput, stderr: this._nodeError + "\n" + (e instanceof Error ? e.message : String(e)) };
    }
  }
  async runDocker(code, opts = {}) {
    this.init();
    const timeout = opts.timeout || 2e4;
    const scriptFile = import_path2.default.join(this.tempDir, `script_${Date.now()}.py`);
    import_fs2.default.writeFileSync(scriptFile, code);
    return new Promise((resolve) => {
      const cmd = `docker run --rm --network none --memory 512m --cpus 1 -v "${scriptFile}:/app/script.py:ro" python:3-slim python /app/script.py`;
      (0, import_child_process.exec)(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
        import_fs2.default.unlinkSync(scriptFile);
        resolve({ ok: !err, stdout, stderr: stderr || (err ? err.message : ""), exitCode: err ? err.code : 0 });
      });
    });
  }
  async run(code, language = "python", opts = {}) {
    const mode = this.plugin.settings.sandboxMode;
    if (mode === "docker") {
      return this.runDocker(code, opts);
    } else if (language === "javascript" || language === "js") {
      return this.runNode(code, opts);
    }
    return this.runPython(code, opts);
  }
};
var _CodeAuditor = class _CodeAuditor {
  constructor(plugin) {
    this.plugin = plugin;
  }
  staticScan(code) {
    const findings = [];
    for (const p of _CodeAuditor.patterns) {
      const matches = code.match(p.pattern);
      if (matches) {
        findings.push({ name: p.name, severity: p.severity, match: matches[0] });
      }
    }
    return findings;
  }
  async audit(code, language = "python") {
    const staticFindings = this.staticScan(code);
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
};
_CodeAuditor.patterns = [
  { name: "SQL Injection", pattern: /(SELECT|INSERT|UPDATE|DELETE).*(\+|\$\{).*(WHERE|VALUES)/i, severity: "critical" },
  { name: "Command Injection", pattern: /(exec|system|popen|spawn|shell_exec|eval)\s*\(/i, severity: "critical" },
  { name: "Path Traversal", pattern: /(\.\.\/|\.\.\\)/, severity: "high" },
  { name: "Hardcoded Secret", pattern: /(password|secret|api[_-]?key|token)\s*[=:]\s*['"][^'"]{8,}['"]/i, severity: "high" },
  { name: "Insecure Deserialization", pattern: /(pickle\.loads|eval\(|Function\(|new Function)/, severity: "high" },
  { name: "Unsafe Eval", pattern: /\beval\s*\(/, severity: "high" },
  { name: "Weak Crypto", pattern: /(md5|sha1|DES|RC4)\s*\(/i, severity: "medium" },
  { name: "Insecure Random", pattern: /(Math\.random|random\(\))/, severity: "low" },
  { name: "Buffer Overflow Risk", pattern: /(strcpy|strcat|sprintf|gets)\s*\(/, severity: "critical" },
  { name: "Race Condition", pattern: /(thread|fork|spawn).*(shared|global|static)/i, severity: "medium" },
  { name: "Unvalidated Input", pattern: /(input\(|getParameter|request\.get|req\.query|req\.body)/i, severity: "medium" },
  { name: "Insecure File Write", pattern: /(open\(.*['"]w['"]|writeFile|fwrite)/i, severity: "medium" }
];
var CodeAuditor = _CodeAuditor;
var MathPhysicsEngine = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  async derive(problem, opts = {}) {
    const prompt = `You are a rigorous mathematician and physicist. Derive the solution to the following problem step-by-step, showing every step clearly.

PROBLEM:
${problem}

${opts.context ? "CONTEXT:\n" + opts.context + "\n" : ""}

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
      type: "derivation",
      content: result,
      sourceNote: opts.sourceNote || null,
      model: modelId,
      contentSource: CONTENT_SOURCES.MATH_DERIVED,
      trustLevel: TRUST_LEVELS.INFERRED,
      metadata: { problem }
    });
    return result;
  }
  async analyzePatterns(input, opts = {}) {
    const prompt = `You are an expert in mathematical and physical pattern recognition. Analyze the following for logical patterns, symmetries, and invariants.

INPUT:
${input}

${opts.context ? "CONTEXT:\n" + opts.context + "\n" : ""}

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
      type: "pattern_analysis",
      content: result,
      sourceNote: opts.sourceNote || null,
      model: modelId,
      contentSource: CONTENT_SOURCES.AI_GENERATED,
      trustLevel: TRUST_LEVELS.INFERRED,
      metadata: { input }
    });
    return result;
  }
};
var SimulationEngine = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  async generateSpec(description, opts = {}) {
    const prompt = `You are a simulation specification generator. Create a detailed, executable simulation specification from the following description.

DESCRIPTION:
${description}

${opts.context ? "CONTEXT:\n" + opts.context + "\n" : ""}

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
      type: "simulation_spec",
      content: result,
      sourceNote: opts.sourceNote || null,
      model: modelId,
      contentSource: CONTENT_SOURCES.AI_GENERATED,
      trustLevel: TRUST_LEVELS.INFERRED,
      metadata: { description }
    });
    return result;
  }
  async buildScript(spec, language = "python", opts = {}) {
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
    const codeMatch = result.match(/```(?:python|javascript|js)?\s*\n([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1] : result;
    await this.plugin.provenance.record({
      type: "simulation_script",
      content: code,
      sourceNote: opts.sourceNote || null,
      model: modelId,
      contentSource: CONTENT_SOURCES.CODE_GENERATED,
      trustLevel: TRUST_LEVELS.UNVERIFIED,
      metadata: { spec, language }
    });
    return { script: code, full: result };
  }
};
var ResearchEngine = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  async research(topic, opts = {}) {
    var _a;
    let context = "";
    if (this.plugin.settings.ragEnabled) {
      const results = await this.plugin.rag.search(topic, 5);
      if (results.length > 0) {
        context = "RELEVANT VAULT NOTES:\n" + results.map(
          (r) => `[${r.chunk.note}] (relevance ${(r.score * 100).toFixed(1)}%):
${r.chunk.text}`
        ).join("\n\n---\n\n");
      }
    }
    const prompt = `You are a rigorous research assistant. Research the following topic and provide a comprehensive, well-cited synthesis.

TOPIC:
${topic}

${context ? context + "\n" : ""}
${opts.externalSources ? "EXTERNAL SOURCES: You may reference external knowledge, but clearly mark each claim with [VERIFY] if it needs verification.\n" : "EXTERNAL SOURCES: Do NOT use external sources. Base your answer only on the provided vault context and your internal knowledge, clearly marking any uncertain claims with [UNCERTAIN].\n"}

Provide:
1. Executive summary
2. Key findings (each with citation to source note or [VERIFY]/[UNCERTAIN] marker)
3. Evidence assessment
4. Gaps and open questions
5. References

RESEARCH:`;
    const modelId = MODELS.deep.id;
    const result = await this.plugin.ollama.generate(modelId, prompt, { numCtx: this.plugin.settings.numCtxLong });
    const citations = context ? ((_a = context.match(/\[([^\]]+\.md)\]/g)) == null ? void 0 : _a.map((c) => c.slice(1, -1))) || [] : [];
    await this.plugin.provenance.record({
      type: "research",
      content: result,
      sourceNote: opts.sourceNote || null,
      model: modelId,
      citations,
      verified: !opts.externalSources,
      verificationMethod: opts.externalSources ? "needs_verification" : "vault_context_only",
      contentSource: opts.externalSources ? CONTENT_SOURCES.EXTERNAL_SOURCED : CONTENT_SOURCES.AI_GENERATED,
      trustLevel: opts.externalSources ? TRUST_LEVELS.UNVERIFIED : citations.length > 0 ? TRUST_LEVELS.VERIFIED : TRUST_LEVELS.INFERRED,
      metadata: { topic }
    });
    return { result, citations };
  }
};
var VaultScholarPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.workingMemory = "";
  }
  async onload() {
    await this.loadSettings();
    this.assetsDir = import_path2.default.join(this.app.vault.adapter.getBasePath(), ".obsidian", "plugins", PLUGIN_ID, "assets");
    if (!import_fs2.default.existsSync(this.assetsDir)) import_fs2.default.mkdirSync(this.assetsDir, { recursive: true });
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
    this.trustBoundary = new TrustBoundary({
      enabled: this.settings.trustEnforcement,
      onDecision: (decision) => {
        this.provenance.record({
          type: "trust_decision",
          content: `${decision.operation}: ${decision.allowed ? "ALLOWED" : "BLOCKED"} (${decision.level} vs ${decision.required})`,
          contentSource: CONTENT_SOURCES.AI_GENERATED,
          trustLevel: decision.level,
          verifiedBy: "trust_boundary",
          metadata: { decision }
        });
      }
    });
    this.researchMode = new ResearchMode({
      createFetcher: () => async (url) => {
        const res = await (0, import_obsidian4.requestUrl)({ url, throw: false });
        if (res.status >= 400) throw new Error("HTTP " + res.status);
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
        numCtxLong: this.settings.numCtxLong
      },
      trustBoundary: this.trustBoundary
    });
    this.provenance.init();
    this.snapshotManager.init();
    this.rag.init();
    this.sandbox.init();
    this.workingMemory = "";
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();
    this.addRibbonIcon("brain-circuit", "Vault Scholar", () => {
      this.openMainModal();
    });
    this.registerCommands();
    this.addSettingTab(new VaultScholarSettingTab(this.app, this));
    this.modelManager.ensureEmbeddingsLoaded();
    new import_obsidian4.Notice("\u{1F989} Vault Scholar loaded");
  }
  onunload() {
    new import_obsidian4.Notice("\u{1F989} Vault Scholar unloaded");
  }
  updateStatusBar() {
    const model = this.modelManager.activeModel;
    const short = model.split(":")[0].split("/").pop();
    this.statusBarEl.setText(`\u{1F989} ${short}`);
    this.statusBarEl.setAttribute("aria-label", `Vault Scholar \u2014 Active model: ${model}`);
  }
  registerCommands() {
    for (const cmd of COMMANDS) {
      this.addCommand({
        id: cmd.id,
        name: cmd.name,
        callback: () => cmd.callback(this)
      });
    }
  }
  // ============================================================
  //  UI HELPERS
  // ============================================================
  async promptForInput(placeholder, callback) {
    const modal = new InputModal(this.app, placeholder);
    const value = await modal.openAsync();
    if (!value) return;
    try {
      await callback(value);
    } catch (e) {
      new import_obsidian4.Notice(`\u274C Error: ${e instanceof Error ? e.message : String(e)}`);
      console.error(e);
    }
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
    this.settings = parseSettings(await this.loadData());
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
        verifiedBy: "user"
      });
      switch (record.trustLevel) {
        case TRUST_LEVELS.TRUSTED:
          trusted++;
          break;
        case TRUST_LEVELS.VERIFIED:
          verified++;
          break;
        case TRUST_LEVELS.INFERRED:
          inferred++;
          break;
        default:
          unverified++;
          break;
      }
      breakdown[record.trustLevel] = (breakdown[record.trustLevel] || 0) + 1;
    }
    const text = `\u{1F512} TRUST AUDIT
=============

\u{1F4CA} Total notes: ${files.length}

\u{1F6E1}\uFE0F TRUSTED:   ${trusted}
\u2705 VERIFIED:  ${verified}
\u{1F9E0} INFERRED:  ${inferred}
\u26A0\uFE0F UNVERIFIED: ${unverified}

Source breakdown:
` + Object.entries(breakdown).map(([k, v]) => `  ${k}: ${v}`).join("\n") + `

Trust boundary ${this.settings.trustEnforcement ? "ACTIVE" : "DISABLED"}`;
    this.showResultModal("Trust Audit", text);
  }
};
var ConfirmModal = class extends import_obsidian4.Modal {
  constructor(app, title, message, onConfirm) {
    super(app);
    this.title = title;
    this.message = message;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("p", { text: this.message });
    const btnRow = contentEl.createDiv({ cls: "vs-btn-row" });
    const yesBtn = btnRow.createEl("button", { text: "\u2705 Yes", cls: "mod-cta" });
    const noBtn = btnRow.createEl("button", { text: "\u274C No" });
    yesBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm(true);
    });
    noBtn.addEventListener("click", () => {
      this.close();
      this.onConfirm(false);
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var VaultScholarSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "\u{1F989} Vault Scholar Settings" });
    for (const def of SETTING_FIELDS) {
      addSettingField(containerEl, this.plugin, def);
    }
    addActionButtons(containerEl, this.plugin);
  }
};
function hashString(str) {
  return import_crypto2.default.createHash("sha256").update(str).digest("hex");
}
function nowISO() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
