// ============================================================
//  Settings Schema (Zod)
//
//  Replaces the 400+ line settings tab with a data-driven
//  schema. Zod `.default()` values ensure old data.json files
//  with missing keys are auto-filled — zero data loss.
// ============================================================

import { z } from 'zod';
import { TRUST_LEVELS } from '../lib/trust';

export const OLLAMA_HOST = 'http://localhost:11434';
export const PLUGIN_ID = 'vault-scholar';

export const MODELS = {
    safe:       { id: 'qwen3:8b',                                role: '🟢 Safe / Everyday',        default: true  },
    deep:       { id: 'gemma4:12b',                              role: '🧠 Deep Reasoning',         default: false },
    math:       { id: 'mathstral:latest',                        role: '➗ Math / Science',         default: false },
    coder:      { id: 'huihui_ai/qwen2.5-coder-abliterate:7b',   role: '💻 Coding / Security',      default: false },
    embedding:  { id: 'qwen3-embedding:0.6b',                    role: '🔎 Embeddings',             default: true  },
} as const;

export type ModelKey = keyof typeof MODELS;

export const SettingsSchema = z.object({
    // Security
    safeMode: z.boolean().default(true),
    internetResearch: z.boolean().default(false),
    vaultWriteApproval: z.boolean().default(true),
    scriptExecutionApproval: z.boolean().default(true),
    verifyExternalBeforeWrite: z.boolean().default(true),
    sandboxMode: z.enum(['python', 'node', 'docker']).default('python'),
    // Trust Boundary
    trustEnforcement: z.boolean().default(true),
    trustThreshold: z.enum([TRUST_LEVELS.TRUSTED, TRUST_LEVELS.VERIFIED, TRUST_LEVELS.INFERRED, TRUST_LEVELS.UNVERIFIED]).default(TRUST_LEVELS.VERIFIED),
    trustDisplay: z.boolean().default(true),
    // Models
    activeModel: z.string().default(MODELS.safe.id),
    // Context
    numCtx: z.number().default(4096),
    numCtxLong: z.number().default(8192),
    // VRAM
    keepEmbeddingsLoaded: z.boolean().default(true),
    // Provenance
    provenanceEnabled: z.boolean().default(true),
    // Snapshots
    autoSnapshotBeforeRisky: z.boolean().default(true),
    snapshotMaxCount: z.number().default(20),
    // RAG
    ragEnabled: z.boolean().default(true),
    // Evidence-Gated Knowledge
    evidenceGating: z.boolean().default(true),
    // Research Mode
    researchModeEnabled: z.boolean().default(true),
    searchProvider: z.enum(['duckduckgo', 'searxng']).default('duckduckgo'),
    searxngUrl: z.string().default(''),
    searxngCategories: z.string().default('general'),
    searxngMaxResults: z.number().default(10),
    maxSources: z.number().default(5),
    maxSearchResults: z.number().default(10),
    // Ollama
    ollamaHost: z.string().default(OLLAMA_HOST),
});

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Parse raw settings (from loadData) into a validated Settings object.
 * Missing keys are auto-filled with defaults — zero data loss.
 */
export function parseSettings(raw: unknown): Settings {
    return SettingsSchema.parse(raw || {});
}