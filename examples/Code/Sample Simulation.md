---
title: Sample Simulation — Projectile Motion
type: simulation_spec
created: 2026-08-08
model: mathstral:latest
verified: true
tags:
  - simulation
  - sample
  - code
---

# Sample Simulation: Projectile Motion

> This is a sample simulation specification and generated script demonstrating how Vault Scholar generates simulation specs and instructs the Coder Agent to build scripts.

## Simulation Specification

### 1. Name and Purpose
**Projectile Motion Simulator** — Simulate the trajectory of a projectile under uniform gravity, with configurable initial velocity and launch angle.

### 2. Physical/Mathematical Model
- Equations of motion (no air resistance):
  - $x(t) = v_0 \cos\theta \cdot t$
  - $y(t) = v_0 \sin\theta \cdot t - \frac{1}{2}gt^2$
- $g = 9.81 \, \text{m/s}^2$

### 3. Initial Conditions
- Initial position: $(x_0, y_0) = (0, 0)$
- Initial velocity: $v_0$ (configurable, default 50 m/s)
- Launch angle: $\theta$ (configurable, default 45°)

### 4. Parameters and Constants
- $v_0$: initial speed (m/s)
- $\theta$: launch angle (degrees)
- $g$: gravitational acceleration (9.81 m/s²)

### 5. Numerical Method
- **Analytic solution** (exact) — no numerical integration needed for this simple case
- Time stepping: $\Delta t = 0.01$ s

### 6. Time Stepping
- Total time: until projectile returns to ground ($y = 0$)
- Time step: 0.01 s

### 7. Outputs and Visualizations
- Print trajectory points (x, y) at each time step
- Print maximum height, range, and time of flight
- ASCII plot of trajectory

### 8. Validation Criteria
- Maximum height: $H = \frac{v_0^2 \sin^2\theta}{2g}$
- Range: $R = \frac{v_0^2 \sin 2\theta}{g}$
- Time of flight: $T = \frac{2v_0 \sin\theta}{g}$

---

## Generated Script (Python)

```python
import math

def simulate_projectile(v0, theta_deg, g=9.81, dt=0.01):
    """Simulate projectile motion and return trajectory points."""
    theta = math.radians(theta_deg)
    v0x = v0 * math.cos(theta)
    v0y = v0 * math.sin(theta)

    # Time of flight
    T = 2 * v0y / g

    points = []
    t = 0.0
    while t <= T + dt:
        x = v0x * t
        y = v0y * t - 0.5 * g * t * t
        if y < 0:
            y = 0
        points.append((x, y))
        t += dt

    return points, T

def validate(v0, theta_deg, g=9.81):
    """Validate against analytic results."""
    theta = math.radians(theta_deg)
    H = (v0 * math.sin(theta))**2 / (2 * g)
    R = v0**2 * math.sin(2 * theta) / g
    T = 2 * v0 * math.sin(theta) / g
    return H, R, T

def ascii_plot(points, width=60, height=20):
    """Render a simple ASCII plot of the trajectory."""
    if not points:
        return "(no points)"
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    max_x = max(xs)
    max_y = max(ys)
    if max_x == 0 or max_y == 0:
        return "(degenerate trajectory)"

    grid = [[' ' for _ in range(width)] for _ in range(height)]
    for x, y in points:
        col = int(x / max_x * (width - 1))
        row = int((1 - y / max_y) * (height - 1))
        grid[row][col] = '*'
    return '\n'.join(''.join(row) for row in grid)

def main():
    v0 = 50.0
    theta = 45.0
    g = 9.81

    print(f"Projectile Motion Simulation")
    print(f"v0 = {v0} m/s, theta = {theta} deg, g = {g} m/s^2")
    print("=" * 50)

    points, T = simulate_projectile(v0, theta, g)
    H, R, T_analytic = validate(v0, theta, g)

    print(f"\nTime of flight: {T:.2f} s (analytic: {T_analytic:.2f} s)")
    print(f"Max height: {max(p[1] for p in points):.2f} m (analytic: {H:.2f} m)")
    print(f"Range: {points[-1][0]:.2f} m (analytic: {R:.2f} m)")

    print("\nTrajectory (ASCII):")
    print(ascii_plot(points))

    # Validation check
    tol = 0.1
    checks = [
        (abs(max(p[1] for p in points) - H) < tol, "Max height"),
        (abs(points[-1][0] - R) < tol, "Range"),
        (abs(T - T_analytic) < tol, "Time of flight"),
    ]
    print("\nValidation:")
    for passed, name in checks:
        print(f"  {'[PASS]' if passed else '[FAIL]'} {name}")

if __name__ == "__main__":
    main()
```

---

## Provenance

- **Model:** mathstral:latest (spec), huihui_ai/qwen2.5-coder-abliterate:7b (script)
- **Verified:** true
- **Verification Method:** analytic_check
- **Type:** simulation_spec + simulation_script