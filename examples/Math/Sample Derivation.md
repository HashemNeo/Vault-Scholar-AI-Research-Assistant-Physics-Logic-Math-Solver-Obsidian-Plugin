---
title: Sample Derivation
type: derivation
created: 2026-08-08
model: mathstral:latest
verified: true
tags:
  - math
  - sample
---

# Sample Derivation: Projectile Motion

> This is a sample derivation demonstrating how Vault Scholar derives physics step-by-step.

## Problem

Derive the trajectory of a projectile launched with initial velocity $v_0$ at angle $\theta$ above the horizontal, neglecting air resistance.

## Step-by-Step Derivation

### Step 1: Problem Restatement

A projectile is launched from the origin with initial velocity $v_0$ at angle $\theta$ above horizontal. We seek the trajectory $y(x)$.

### Step 2: Decompose Initial Velocity

The initial velocity components are:

$$v_{0x} = v_0 \cos\theta$$
$$v_{0y} = v_0 \sin\theta$$

### Step 3: Apply Newton's Second Law

With no air resistance, the only force is gravity:

$$F_x = 0 \implies a_x = 0$$
$$F_y = -mg \implies a_y = -g$$

### Step 4: Integrate for Velocity

$$v_x(t) = v_{0x} = v_0 \cos\theta$$
$$v_y(t) = v_{0y} - gt = v_0 \sin\theta - gt$$

### Step 5: Integrate for Position

$$x(t) = v_0 \cos\theta \cdot t$$
$$y(t) = v_0 \sin\theta \cdot t - \frac{1}{2}gt^2$$

### Step 6: Eliminate Time

From $x(t)$: $t = \frac{x}{v_0 \cos\theta}$

Substitute into $y(t)$:

$$y(x) = v_0 \sin\theta \cdot \frac{x}{v_0 \cos\theta} - \frac{1}{2}g\left(\frac{x}{v_0 \cos\theta}\right)^2$$

### Step 7: Simplify

$$y(x) = x\tan\theta - \frac{gx^2}{2v_0^2\cos^2\theta}$$

## Final Result

$$\boxed{y(x) = x\tan\theta - \frac{gx^2}{2v_0^2\cos^2\theta}}$$

This is a parabola — the trajectory of a projectile under uniform gravity.

## Verification

- **Sanity check 1:** At $x = 0$, $y = 0$ ✓ (launch point)
- **Sanity check 2:** The trajectory is symmetric about its peak ✓
- **Sanity check 3:** Range $R = \frac{v_0^2 \sin 2\theta}{g}$ (setting $y = 0$) ✓

## Assumptions

1. No air resistance
2. Uniform gravitational field
3. Flat Earth (constant $g$)
4. No rotation of the Earth

---

## Provenance

- **Model:** mathstral:latest
- **Verified:** true
- **Verification Method:** analytic_check
- **Type:** derivation