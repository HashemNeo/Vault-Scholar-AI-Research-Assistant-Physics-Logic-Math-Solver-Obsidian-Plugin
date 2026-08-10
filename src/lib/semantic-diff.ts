// ============================================================
//  Semantic Diff Engine (LLM-powered)
//
//  Compares two versions of a note conceptually using an LLM.
//  Parses a structured result: Meaning, Magnitude, Confidence.
//  Falls back to structural-only if the model fails.
// ============================================================

export interface SemanticDiffResult {
    meaning: string;
    magnitude: string;
    confidence: number;
    description: string;
}

export interface SemanticDiffResponse {
    ok: boolean;
    result: SemanticDiffResult | null;
    error?: string;
}

/**
 * Parse the LLM's semantic diff output into a structured result.
 * Expected format (loosely parsed):
 *   Meaning: REDEFINED
 *   Magnitude: MAJOR
 *   Confidence: 94%
 *   Description: ...
 */
export function parseSemanticResult(raw: string): SemanticDiffResult {
    const text = String(raw || '');
    const result: SemanticDiffResult = {
        meaning: 'UNKNOWN',
        magnitude: 'UNKNOWN',
        confidence: 0,
        description: '',
    };

    const meaningMatch = text.match(/meaning\s*[:=]\s*([A-Z_]+)/i);
    if (meaningMatch) result.meaning = meaningMatch[1].toUpperCase();

    const magMatch = text.match(/magnitude\s*[:=]\s*([A-Z_]+)/i);
    if (magMatch) result.magnitude = magMatch[1].toUpperCase();

    const confMatch = text.match(/confidence\s*[:=]\s*(\d+(?:\.\d+)?)\s*%/i);
    if (confMatch) result.confidence = parseFloat(confMatch[1]);

    const descMatch = text.match(/description\s*[:=]\s*(.+)/i);
    if (descMatch) result.description = descMatch[1].trim();

    return result;
}

/**
 * Build the semantic diff prompt.
 */
export function buildPrompt(previous: string, current: string): string {
    return `Compare the following two versions of a note and determine the conceptual change between them.

PREVIOUS VERSION:
${previous}

CURRENT VERSION:
${current}

Respond in exactly this format:
Meaning: (REDEFINED | ELABORATED | CLARIFIED | UNCHANGED | REWRITTEN)
Magnitude: (MINOR | MAJOR)
Confidence: (0-100%)
Description: (1-2 sentences summarizing the conceptual change)`;
}

/**
 * Run a semantic diff using an LLM.
 */
export async function semanticDiff(previous: string, current: string, generateFn: (prompt: string) => Promise<string>): Promise<SemanticDiffResponse> {
    try {
        const prompt = buildPrompt(previous, current);
        const raw = await generateFn(prompt);
        const result = parseSemanticResult(raw);
        return { ok: true, result };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), result: null };
    }
}