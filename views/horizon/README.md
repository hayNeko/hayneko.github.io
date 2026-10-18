# HAYNEKO HORIZON — NAGISA COAST

An open-world golden-hour arcade racer built for the Hayneko site. It is a
self-contained insert for \`#/horizon\` and linked from the second card on the
Games page: a fictional Japanese coastal region with a harbour town, a coastal
loop, a mountain touge and a festival by the sea. Everything is generated in
the browser — no external models, textures, fonts or HTTP requests.

## Drive

Open **Games / Hayneko Horizon** (or go straight to \`#/horizon\`), then press
**DRIVE** for free roam, or start any of the three routes from the event board.

| Input | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake, then reverse |
| A D / ← → | Steer |
| Space | Handbrake — hold to break traction and drift |
| C | Chase / hood / bumper camera |
| R | Reset to the nearest road (or last checkpoint during a race) |
| E | Start the event gate you are standing in |
| H | Driver's handbook |
| M | Mute audio |
| T | Toggle HAYNEKO FM |
| Esc | Pause |

Gamepad: left stick steers, RT throttles, LT brakes, A handbrake, Y cycles the
camera. On touch devices an on-screen steering pad and brake/handbrake/throttle
buttons appear automatically.

## The coast

- A 3.0 km square of seeded terrain: cliffs and a bright sea to the east, green
  foothills, a forested western ridge and a high touge above the coast, plus a
  southern field district and a northern ridge road.
- 11 km of asphalt: a 3.4 km coastal loop, a 2.0 km mountain pass, a 2.3 km
  southern loop, a 2.6 km northern ridge road and 0.7 km of harbour streets —
  all hand-shaped splines welded into one drivable network, plus a short festival
  drive.
- Three stunt ramps (festival, Minami loop, Kita ridge) with real vertical
  launch, flight time, landing dust and a soft contact shadow.
- A harbour town of instanced apartment blocks, a festival ground with stage,
  crowd, tents, floodlights and an entry arch, a mountain shrine and torii, and
  boats in the bay.
- Guardrails, reflective posts, street lamps, billboards, speed-trap gantries
  and glowing event/checkpoint gates.
- A lit, normal-mapped sea, volumetric festival beams, distant mist, procedural
  clouds and a gradient golden-hour sky.

## Driving model

The car is a lightweight arcade model tuned for a pad or keyboard rather than
a simulator: a six-speed gearbox, speed-dependent steering, tyre grip that
bleeds lateral velocity, handbrake-influenced yaw, grade resistance, an
off-road grip penalty and a soft barrier/collision response. The body follows
the terrain normal, rolls and pitches under load, and the wheels steer and
spin. There is a procedural sport coupe with paint, glass, arches, splitter,
wing, lights, plate and exhausts; traffic uses a simpler body.

Rendering is one renderer, instanced scenery and roughly 200-225 draw calls in the heaviest festival view. Quality
low/balanced/high changes pixel ratio and shadows, and a coarse pointer gets
low quality by default on a fresh save.

## Events, skills and records

| Event | Type | Length | Rivals |
| --- | --- | --- | --- |
| NAGISA COAST SPRINT | Point to point | 1.5 km | 2 |
| KIRI TOUGE CLIMB | Hill climb | 1.9 km | 2 |
| FESTIVAL CIRCUIT | Loop | 3.4 km | 2 |

Each route has checkpoints, a 3-2-1 countdown, two AI rivals, gold/silver/bronze
targets, a personal best and a results panel (race again / free roam / event
board). Rivals follow the road with curvature-based pace and can be drafted or
bumped into.

In free roam and races, drifting, speed traps and near misses feed a skill
chain. A chain multiplier builds with each banked action (up to ×5) and a crash
breaks it. Best trap speeds and drift-zone scores are saved per browser; event
bests are saved in \`localStorage\` under \`hayneko.horizon.save.v1\`.

## Files

| File | Purpose |
| --- | --- |
| index.html | Route partial: loading screen, menu, event/garage/settings panels, HUD and overlays. |
| horizon.css | The full game UI, HUD and Games-page card skin, scoped under \`.hz\`. |
| bootstrap.js | Tiny lazy loader; pulls Three.js and the game only when \`#/horizon\` opens. |
| core.js | Math, seeded noise, canvas textures (asphalt, water normals, windows, banners, smoke), save helpers. |
| world.js | Shoreline/terrain height field, road network, town, festival, shrine, sea, sky, lights, props, minimap, event gates and traps. |
| car.js | Procedural coupe and the simple traffic car. |
| audio.js | Web Audio engine, tyre/wind noise, UI tones and the HAYNEKO FM sequencer. |
| i18n.js | Five game locales (en / zh-CN / zh-TW / ja / ko); English fallback. |
| game.js | Vehicle physics, camera, HUD, skills, races, rivals, traffic, particles, settings, input and mount lifecycle. |
| vendor/three.min.js | Vendored Three.js r158 (MIT — licence header retained). |

Load order is \`three.min.js → core.js → i18n.js → world.js → car.js → audio.js →
game.js\`, and the route is registered in \`scripts/router.js\`. CSS and the
bootstrap script are included from the site root; the Games card lives in
\`views/games.html\`.

## Notes

- The game locks page scrolling and hides the site dock while mounted; leaving
  the route destroys the renderer, scene and audio context.
- The site's i18n engine and the game language selector stay in sync through
  \`window.i18n\`; static game text uses \`data-hz-i18n\`, dynamic text uses
  \`HZI18n.t()\`.
- The world, car, textures, sound and music are procedural. Three.js is the
  only third-party dependency and is vendored locally.
- The save/records are local-only; clearing site storage resets them.
- Vehicle physics uses a capped fixed-ish delta; at very low frame rates the
  simulation slows down rather than teleporting through the world.
