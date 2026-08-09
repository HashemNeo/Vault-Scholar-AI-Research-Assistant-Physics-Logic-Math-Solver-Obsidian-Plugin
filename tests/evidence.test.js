// ============================================================
//  Evidence-Gated Knowledge (Phase 9) — Tests
// ============================================================
'use strict';
const assert = require('assert');
const {
    EvidenceGate, CLAIM_ORIGIN, EVIDENCE_MARKERS,
    normalizeUrl, isUrlLike, stripHtml, decodeEntities, normalizeSources,
} = require('../lib/evidence');
const { TRUST_LEVELS, CONTENT_SOURCES } = require('../lib/trust');

async function runTests() {
    console.log('[evidence] Testing Evidence-Gated Knowledge...\n');

    // ---- Rule 1: external claim without source is BLOCKED ----
    let g = EvidenceGate.gate('The planet is flat', {
        contentSource: CONTENT_SOURCES.EXTERNAL_SOURCED,
    });
    assert.strictEqual(g.allowed, false, 'external unsourced claim must be blocked');
    assert.strictEqual(g.trustLevel, TRUST_LEVELS.UNVERIFIED);

    // external claim with userOverride -> allowed, demoted
    g = EvidenceGate.gate('The planet is flat', {
        contentSource: CONTENT_SOURCES.EXTERNAL_SOURCED,
        userOverride: true,
    });
    assert.strictEqual(g.allowed, true);

    // ---- Rule 2: user-created -> trusted ----
    g = EvidenceGate.gate('My own hypothesis about X', {
        contentSource: CONTENT_SOURCES.USER_CREATED,
    });
    assert.strictEqual(g.allowed, true);
    assert.strictEqual(g.trustLevel, TRUST_LEVELS.TRUSTED);
    assert.strictEqual(g.origin, CLAIM_ORIGIN.USER_CLAIM);
    assert.strictEqual(g.markers[0], EVIDENCE_MARKERS.USER_CLAIM);

    // ---- Rule 3: AI-generated, no sources -> INFERENCE ----
    g = EvidenceGate.gate('Based on the data the value is 42', {
        contentSource: CONTENT_SOURCES.AI_GENERATED,
    });
    assert.strictEqual(g.allowed, true);
    assert.strictEqual(g.trustLevel, TRUST_LEVELS.INFERRED);
    assert.strictEqual(g.origin, CLAIM_ORIGIN.INFERENCE);

    // ---- Rule 5: math derivation requires assumptions + domain ----
    g = EvidenceGate.gate('F = ma', {
        contentSource: CONTENT_SOURCES.MATH_DERIVED,
    });
    assert.strictEqual(g.allowed, false, 'math derivation missing assumptions must be blocked');

    g = EvidenceGate.gate('F = ma', {
        contentSource: CONTENT_SOURCES.MATH_DERIVED,
        assumptions: ['ideal conditions'],
        domainOfValidity: 'classical mechanics',
    });
    assert.strictEqual(g.allowed, true);
    assert.strictEqual(g.trustLevel, TRUST_LEVELS.VERIFIED);
    assert.ok(Array.isArray(g.extra.assumptions) && g.extra.assumptions.length === 1);
    assert.strictEqual(g.extra.domainOfValidity, 'classical mechanics');

    // ---- Rule 6: simulation output -> SIMULATION RESULT marker ----
    g = EvidenceGate.gate('Velocity = 42 m/s', {
        contentSource: CONTENT_SOURCES.SIMULATION_OUTPUT,
        model: 'Harmonic oscillator',
        equations: 'x(t) = A cos(w t)',
        numericalMethod: 'RK4',
        assumptions: ['small amplitude'],
    });
    assert.strictEqual(g.allowed, true);
    assert.strictEqual(g.origin, CLAIM_ORIGIN.SIMULATION_RESULT);
    assert.ok(g.extra.simulationHeader);
    assert.ok(g.extra.simulationHeader.includes('[SIMULATION RESULT]'));

    // ---- simulationHeader formatting ----
    const header = EvidenceGate.simulationHeader('Pendulum', ['small angle'], 'd2x/dt2 = -g/L sin(x)', 'Euler');
    assert.ok(typeof header === 'string');
    assert.ok(header.includes('[SIMULATION RESULT]'));
    assert.ok(header.includes('Model:'));
    assert.ok(header.includes('Assumptions'));
    assert.ok(header.includes('Equations'));
    assert.ok(header.includes('Numerical Method'));

    // ---- validateNote: plain user text -> valid ----
    let report = EvidenceGate.validateNote('This is my personal note. It contains several sentences that are long enough to be considered claims. The weather today is sunny and warm.');
    assert.strictEqual(report.valid, true);
    assert.strictEqual(report.blocked, 0);
    assert.strictEqual(report.totalClaims, report.allowed);

    // ---- validateNote: unsourced external claim (SOURCE marker, no sources) -> blocked ----
    report = EvidenceGate.validateNote('The experiment confirms the theory [SOURCE: https://example.com/paper]. Additional context here to make a long sentence.');
    assert.strictEqual(report.valid, false);
    assert.ok(report.blocked > 0);
    assert.ok(report.issues.length > 0);
    assert.ok(report.issues[0].text);
    assert.ok(report.issues[0].reason);

    // ---- validateNote: summary shape + empty note ----
    report = EvidenceGate.validateNote('Short note.');
    assert.strictEqual(typeof report.totalClaims, 'number');
    assert.ok(report.summary);
    assert.ok(report.summary.origins !== undefined);
    assert.ok(report.summary.trust !== undefined);
    assert.strictEqual(report.totalClaims, 0);
    assert.strictEqual(report.valid, true);

    // ---- parseEvidence ----
    const parsed = EvidenceGate.parseEvidence('See [SOURCE: https://a.com] and [INFERENCE] here.');
    assert.ok(Array.isArray(parsed.markers));
    assert.ok(Array.isArray(parsed.claims));
    assert.ok(parsed.markers.length >= 2);

    // ---- formatClaim ----
    const fc = EvidenceGate.formatClaim('A claim', {
        allowed: true, markers: ['[INFERENCE]'], sources: ['https://a.com'],
    });
    assert.ok(fc.includes('A claim'));
    assert.ok(fc.includes('[SOURCE:'));

    // ---- extractClaims ----
    const claims = EvidenceGate.extractClaims('This is a long enough sentence one. This is a long enough sentence two.');
    assert.ok(claims.length > 0);

    // ---- helpers ----
    assert.ok(normalizeUrl('example.com').indexOf('https://') === 0);
    assert.strictEqual(isUrlLike('https://a.com'), true);
    assert.strictEqual(isUrlLike('not a url'), false);
    assert.strictEqual(stripHtml('<b>hi</b>'), 'hi');
    assert.strictEqual(decodeEntities('&<>'), '&<>');
    assert.ok(normalizeSources(['https://a.com', 'b', 'https://a.com']).includes('https://a.com'));

    // ---- constants ----
    assert.strictEqual(CLAIM_ORIGIN.USER_CLAIM, 'USER-CLAIM');
    assert.strictEqual(EVIDENCE_MARKERS.SOURCE, '[SOURCE:');

    console.log('\n[evidence] All Evidence-Gated Knowledge tests passed!');
}

runTests().catch(err => {
    console.error('[evidence] Test failed:', err.message);
    console.error(err);
    process.exit(1);
});
