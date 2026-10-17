# Movement and stamina verification

Date: 2026-10-17. Scope: the real browser `client/js/physics.js` module, executed directly in Node with no replacement movement or raycasting implementation.

## Reproduced defects

- Holding Shift at stamina=1 produced sprint flags `true,true,false,true,false,true...` at 60 FPS. Stamina alternated between 0 and 0.25: the character automatically restarted for one frame whenever walking recovered any amount.
- At x=100 with a wall starting at x=108 and a size=20 character, one 1/60-second sprint frame left x unchanged while reducing stamina from 100 to 99.4166667 and reporting `isSprinting=true`.
- Destination-only collision let a fast operator pass through a two-pixel wall when the destination lay beyond it. The reproduction at speed=1200, dt=0.25 ended at x=700 instead of stopping before the x=150 wall.
- A vertical ray at x=1 falsely intersected a distant box at x=2 because the implementation replaced a zero direction component with 0.00001.
- A valid hit at t=0 was discarded by a truthiness check. Starting inside a wall also returned the exit distance, allowing a nearer enemy inside the wall to be selected first.

Stationary Shift without directional input already recovered stamina; it remains an explicit regression contract. Some new checks encode deliberately added MVP rules and state fields rather than previously specified requirements.

## MVP rules

These are tuning decisions for this 2D MVP, not claims about exact official Delta Force values:

| Rule | Value / behavior |
| --- | --- |
| Sprint consumption | 35 stamina/second of actual sprint travel |
| Walking recovery | 15 stamina/second |
| Stationary recovery | 35 stamina/second |
| Recovery delay | 0.8 seconds after actual sprint travel |
| Exhaustion restart | Release Shift while stamina is at least 20% of the operator maximum, then press again |
| Holding Shift after exhaustion | Walk and recover; never automatically alternate running/walking |
| Blocked by walls or map boundary | No sprint consumption; recover after the delay |
| Diagonal movement | Normalize direction; same speed and cost as straight travel |
| Sliding along a wall | Consume in proportion to the distance actually traveled |

An exhausted operator's latch remains set if Shift is released briefly below 20% and pressed again. Release Shift again after reaching the threshold. A nonexhausted operator can start a short sprint below 20%; the restart threshold applies after exhaustion.

`movePlayer(player, dt, keys, walls, width, height)` keeps its existing API. It lazily initializes these additional player fields, keeping existing constructors and imported test fixtures compatible:

- `sprintExhausted`: exhaustion latch for HUD messaging.
- `staminaRecoveryDelay`: seconds until recovery can begin.
- `isMoving`: whether the character actually changed position during the call.

`isSprinting` is false at walls, boundaries and exhaustion. `STAMINA_RULES` exports the same numeric policy for the HUD and tests. Zero/negative/nonfinite dt does not simulate movement or consume stamina; stamina itself is clamped to a finite 0..maxStamina range.

Swept per-axis collision stops at the first crossed wall and allows sliding. The whole sprite remains within the current map dimensions. Raycasting now uses exact parallel slab handling, includes zero-distance and exact-maximum-range hits, and prioritizes walls over enemies at an equal distance. Trees retain the existing penetrable-bullet behavior.

## Integration requirement

Call `movePlayer` every simulated frame, including during container/backpack searches. Pass neutral movement keys while a search keeps the character stationary. Skipping the function freezes recovery and leaves stale movement state; the caller integration belongs to the gameplay stage.

## Checks

```powershell
node --test tests/motion.test.cjs
node --experimental-vm-modules docs/fixes-2026-10-02/client-regression.cjs
node --check client/js/physics.js
git -c core.safecrlf=false diff --check -- client/js/physics.js
```

- Dedicated real-module checks: **19/19 passed** after repair; initial baseline **2 passed / 17 failed** (including newly specified rules and fields).
- Existing whole-client controlled regression: **17/17 passed** after the physics changes.
- Syntax and diff whitespace checks passed.
- Explicit rate consistency: running until exhaustion and walking for the remainder at 30, 60 and 144 FPS all finish a 3-second simulation at x=500 and stamina=18 for the same test operator.
- Coverage includes all operator maxima (70/100/120), recovery timing, held/released Shift, empty inputs, contradictory directions, wall/boundary/corner blocking, sliding, diagonal speed, thin walls, imported dimensions, invalid time, parallel rays, starting on/inside a wall, exact range, wall/enemy ties, and line-of-sight.

This record proves module behavior and the controlled existing client regression. Browser play and the searching/HUD integration require separate end-to-end verification after the remaining gameplay/UI changes.
