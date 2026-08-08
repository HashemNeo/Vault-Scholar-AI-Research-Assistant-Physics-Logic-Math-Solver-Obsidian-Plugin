---
title: Sample Physics — Symmetry & Invariants
type: pattern_analysis
created: 2026-08-08
model: mathstral:latest
verified: true
tags:
  - physics
  - sample
  - symmetry
---

# Sample Physics: Symmetry & Invariants

> This is a sample physics note demonstrating how Vault Scholar analyzes patterns, symmetries, and invariants.

## System: Simple Harmonic Oscillator

Consider a mass $m$ attached to a spring with spring constant $k$, oscillating about equilibrium.

### Equation of Motion

$$m\frac{d^2x}{dt^2} = -kx$$

### Detected Patterns

1. **Linear second-order ODE** — The equation is linear and second-order in time.
2. **Oscillatory behavior** — Solutions are sinusoidal: $x(t) = A\cos(\omega t + \phi)$
3. **Time-translation invariance** — The equation is unchanged under $t \to t + t_0$

### Symmetries

1. **Time translation symmetry** — $t \to t + t_0$ leaves the equation invariant
2. **Spatial reflection symmetry** — $x \to -x$ leaves the equation invariant (for $x=0$ equilibrium)

### Invariants

1. **Total Energy** — $E = \frac{1}{2}mv^2 + \frac{1}{2}kx^2 = \text{constant}$
2. **Amplitude** — $A$ is constant (in the absence of damping)

### Conservation Laws

- **Energy conservation** follows from time-translation symmetry (Noether's theorem)
- The angular frequency $\omega = \sqrt{k/m}$ is a system property, independent of amplitude

### Implications

1. The oscillator's energy is conserved, so it oscillates forever (idealized).
2. The frequency is independent of amplitude — this is the hallmark of a **linear** oscillator.
3. Adding damping breaks time-translation symmetry and energy conservation.

---

## Provenance

- **Model:** mathstral:latest
- **Verified:** true
- **Verification Method:** analytic_check
- **Type:** pattern_analysis