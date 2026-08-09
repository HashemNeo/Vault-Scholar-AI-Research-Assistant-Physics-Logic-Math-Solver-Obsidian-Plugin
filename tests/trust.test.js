// ============================================================
//  Trust Boundary Tests
// ============================================================

'use strict';

const assert = require('assert');
const { TrustClassifier, TrustBoundary, TRUST_LEVELS, CONTENT_SOURCES, DEFAULT_POLICIES } = require('../lib/trust');

async function runTests() {
    console.log('🧪 Running Trust Boundary tests...\n');

    // ===== TrustClassifier.classify =====
    console.log('✓ Testing TrustClassifier.classify');

    // AI-generated default
    let record = TrustClassifier.classify('Some AI output');
    assert.strictEqual(record.trustLevel, TRUST_LEVELS.UNVERIFIED);
    assert.strictEqual(record.contentSource, CONTENT_SOURCES.AI_GENERATED);
    assert.strictEqual(record.verified, false);

    // User-created content
    record = TrustClassifier.classify('My research notes', {
        source: CONTENT_SOURCES.USER_CREATED,
        trustLevel: TRUST_LEVELS.TRUSTED,
        verifiedBy: 'user',
    });
    assert.strictEqual(record.trustLevel, TRUST_LEVELS.TRUSTED);
    assert.strictEqual(record.contentSource, CONTENT_SOURCES.USER_CREATED);
    assert.strictEqual(record.verified, true);
    assert.strictEqual(record.verifiedBy, 'user');

    // Math-derived
    record = TrustClassifier.classify('F = ma derivation steps', {
        source: CONTENT_SOURCES.MATH_DERIVED,
        trustLevel: TRUST_LEVELS.INFERRED,
    });
    assert.strictEqual(record.trustLevel, TRUST_LEVELS.INFERRED);
    assert.strictEqual(record.contentSource, CONTENT_SOURCES.MATH_DERIVED);

    // External-sourced with citations
    record = TrustClassifier.classify('Research with citation [Source: paper.md]', {
        source: CONTENT_SOURCES.EXTERNAL_SOURCED,
        citations: ['paper.md'],
    });
    assert.strictEqual(record.trustLevel, TRUST_LEVELS.VERIFIED);
    assert.deepStrictEqual(record.citations, ['paper.md']);

    // Simulation output
    record = TrustClassifier.classify('Simulation result: 42', {
        source: CONTENT_SOURCES.SIMULATION_OUTPUT,
    });
    assert.strictEqual(record.trustLevel, TRUST_LEVELS.INFERRED);
    assert.strictEqual(record.contentSource, CONTENT_SOURCES.SIMULATION_OUTPUT);

    // Confidence clamping
    record = TrustClassifier.classify('Content with 150% confidence', { confidence: 150 });
    assert.strictEqual(record.confidence, 100);
    record = TrustClassifier.classify('Content with negative confidence', { confidence: -10 });
    assert.strictEqual(record.confidence, 0);

    console.log('  ✅ TrustClassifier.classify passed');

    // ===== TrustClassifier.merge =====
    console.log('✓ Testing TrustClassifier.merge');

    const merged = TrustClassifier.merge([
        TrustClassifier.classify('First AI guess', { source: CONTENT_SOURCES.AI_GENERATED }),
        TrustClassifier.classify('User correction', { source: CONTENT_SOURCES.USER_CREATED, trustLevel: TRUST_LEVELS.TRUSTED }),
    ]);
    assert.strictEqual(merged.trustLevel, TRUST_LEVELS.TRUSTED);

    const mergedConservative = TrustClassifier.merge([
        TrustClassifier.classify('AI claim A', { source: CONTENT_SOURCES.AI_GENERATED }),
        TrustClassifier.classify('AI claim B', { source: CONTENT_SOURCES.AI_GENERATED }),
    ]);
    assert.strictEqual(mergedConservative.trustLevel, TRUST_LEVELS.UNVERIFIED);

    const emptyMerge = TrustClassifier.merge([]);
    assert.strictEqual(emptyMerge, null);

    console.log('  ✅ TrustClassifier.merge passed');

    // ===== TrustClassifier.meetsThreshold =====
    console.log('✓ Testing TrustClassifier.meetsThreshold');

    assert.strictEqual(
        TrustClassifier.meetsThreshold(
            TrustClassifier.classify('Verified content', { source: CONTENT_SOURCES.USER_CREATED, trustLevel: TRUST_LEVELS.TRUSTED }),
            TRUST_LEVELS.VERIFIED
        ),
        true
    );
    assert.strictEqual(
        TrustClassifier.meetsThreshold(
            TrustClassifier.classify('Unverified AI', { source: CONTENT_SOURCES.AI_GENERATED }),
            TRUST_LEVELS.VERIFIED
        ),
        false
    );

    console.log('  ✅ TrustClassifier.meetsThreshold passed');

    // ===== TrustBoundary.enforce =====
    console.log('✓ Testing TrustBoundary.enforce');

    const boundary = new TrustBoundary();

    // Verified content passes vault.write
    const verified = TrustClassifier.classify('Verified research', {
        source: CONTENT_SOURCES.USER_CREATED,
        trustLevel: TRUST_LEVELS.VERIFIED,
    });
    let decision = boundary.enforce('vault.write', verified);
    assert.strictEqual(decision.allowed, true);

    // Unverified AI blocked from vault.write
    const unverified = TrustClassifier.classify('AI generated junk', {
        source: CONTENT_SOURCES.AI_GENERATED,
    });
    decision = boundary.enforce('vault.write', unverified);
    assert.strictEqual(decision.allowed, false);
    assert.strictEqual(decision.canOverride, false);

    // User-created content can override
    const trusted = TrustClassifier.classify('My own notes', {
        source: CONTENT_SOURCES.USER_CREATED,
        trustLevel: TRUST_LEVELS.TRUSTED,
    });
    decision = boundary.enforce('vault.write', trusted);
    assert.strictEqual(decision.allowed, true);

    // Unknown operation fails closed
    decision = boundary.enforce('unknown.op', verified);
    assert.strictEqual(decision.allowed, false);

    // Disabled boundary allows everything
    const disabledBoundary = new TrustBoundary({ enabled: false });
    decision = disabledBoundary.enforce('vault.write', unverified);
    assert.strictEqual(decision.allowed, true);

    // User override for authoritative sources
    const userOverrideDecision = boundary.enforce('vault.write', unverified, { userOverride: false });
    assert.strictEqual(userOverrideDecision.allowed, false);

    console.log('  ✅ TrustBoundary.enforce passed');

    // ===== Default policies =====
    console.log('✓ Testing DEFAULT_POLICIES');

    assert.strictEqual(DEFAULT_POLICIES['vault.write'], TRUST_LEVELS.VERIFIED);
    assert.strictEqual(DEFAULT_POLICIES['script.execute'], TRUST_LEVELS.VERIFIED);
    assert.strictEqual(DEFAULT_POLICIES['vault.restore'], TRUST_LEVELS.TRUSTED);
    assert.strictEqual(DEFAULT_POLICIES['simulation.run'], TRUST_LEVELS.INFERRED);
    assert.strictEqual(DEFAULT_POLICIES['code.deploy'], TRUST_LEVELS.VERIFIED);

    console.log('  ✅ DEFAULT_POLICIES passed');

    console.log('\n🎉 All Trust Boundary tests passed!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err.message);
    process.exit(1);
});
