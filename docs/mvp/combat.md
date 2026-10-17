# Local combat rules and throw-path checks

Date: 2026-10-17. This stage adds the real shared `client/js/combat.js` module. Weapon hits, Bot attacks and grenade flight/fuse now use these rules in the main gameplay stage; see verification.md for integrated evidence.

## Damage policy

These formulas are deliberately simple rules for the 2D MVP. They are **not the exact official Delta Force damage, ammunition or armor formulas**.

`applyDamage(target, damage, penetration = 0)` updates only `target.hp` and `target.armor` and returns `{ hpDamage, armorDamage, penetrated, killed }`.

- Effective penetration threshold is `armorClass * 10`.
- With no remaining armor, the full incoming damage reaches HP.
- Penetration at or above the threshold deals full incoming damage to HP and removes armor durability equal to 35% of incoming damage, capped by the actual remaining durability.
- A nonpenetrating hit can absorb 90% of incoming damage, capped by remaining armor durability. HP takes all unabsorbed damage. One durability point therefore absorbs at most one damage point rather than protecting against the full shot.
- HP and durability cannot go below zero or exceed finite supplied maxima. Returned losses are actual losses after these limits; an overkill shot against 5 HP reports 5 HP damage.
- `killed` is true only for this call's living-to-dead transition. Repeated damage to a dead target does not damage armor again or emit another death event.
- Invalid, negative or zero incoming damage is ignored. Invalid/negative penetration is treated as zero. Nonfinite/negative HP is normalized to zero, and invalid armor becomes zero, preventing NaN propagation or revival.
- Target objects should supply `armorClass`; the default missing/invalid class acts as class zero, so armor with no valid class provides no penetration protection. No armor fields are required for unarmored entities.

Example: a class-4 vest with one durability receives a 40-damage hit with penetration 20. It loses that last durability point and HP loses 39. The same hit against a full vest loses 36 durability and deals 4 HP damage. Penetration 40 or above instead deals 40 HP damage and wears 14 durability.

## Throw paths

`resolveThrow(origin, target, walls, maxDistance = 500, radius = 6)` returns `{ x, y, distance, blocked, wall }` without mutating the map or applying damage.

The function aims toward the target, limits travel distance, expands each physical wall AABB by the grenade radius, and sweeps the center using the real `rayBoxIntersect` export. It stops 0.01 pixels before the closest expanded wall face. Trees block these low throws even though the existing bullet model lets bullets pass through trees. Wall `isBlockingLoS` flags do not allow a grenade to pass through physical obstacles.

Expansion is a conservative rectangular approximation around wall corners. This MVP does not simulate a high arc over obstacles, bounces, vertical height or official grenade physics. The caller controls the travel animation, fuse time, explosion, damage falloff, map-bound clamping and inventory consumption. The returned `wall` is the original wall reference.

Throws starting inside a physical obstacle stop immediately. A grenade exactly touching a wall may travel away from it, while a throw entering the wall stops. Zero-length or invalid throws return a finite stationary point; invalid wall boxes are ignored.

## Verification

```powershell
node --test tests/combat.test.cjs
node --test tests/combat.test.cjs tests/motion.test.cjs
node --check client/js/combat.js
```

Dedicated real-module regression: **25/25 passed**. No replacement damage or path algorithm is used in the test suite.

Coverage includes equality at the armor threshold, light/heavy class differences, one-point armor, broken armor on following shots, penetrating wear, lethal overkill and duplicate death, invalid damage/penetration/target fields, fractional damage over 2,000 hits, free/range-limited throws, nearest-wall order, walls beyond aim/range, trees, vertical/reverse/diagonal rays, radius effects, off-axis walls, starts inside/on walls, invalid throws, and two subpixel wall-boundary cases.

These checks prove shared module behavior. Integrated weapon/Bot/grenade behavior, fuse timing, HUD feedback and browser flows have since passed tests/game.test.cjs and tests/browser-mvp.cjs; see verification.md.
