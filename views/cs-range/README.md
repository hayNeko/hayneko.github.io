# Dust Range

A CS:GO-flavoured, first-person robot-elimination range that runs entirely in the
browser. It is a self-contained insert for the Hayneko site, mounted at
#/range and linked from the Games page.

## Play

Open **Games / Dust Range** (or go directly to #/range) and press **DEPLOY**.

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Aim |
| Left mouse | Fire |
| Right mouse | AWP scope |
| R | Reload |
| 1 2 3 | Pistol / primary / knife |
| Shift | Walk (steadier aim, quieter) |
| Ctrl | Crouch |
| Space | Jump |
| B | Buy menu during buy time |
| E | Pick up a dropped weapon |
| Tab (hold) | Scoreboard |
| M | Mute |
| H | Controls / operator manual |
| Esc | Pause and release the mouse |

First side to eight rounds wins. Killing a robot pays $300 ($400 for a headshot);
a round win pays $3,250 and a loss pays $1,900. Dying loses the purchased loadout
and armour for the next round.

## What is in the range

- A hand-built de_dust-inspired map with sandstone walls, an archway, crates,
  containers, barrels, sandbag cover, two bomb sites and a distant skyline.
- Randomised robot squads: scouts, troopers, heavies and snipers with random
  paint, names, weapons and per-bot stats. Bots use A* navigation, line-of-sight
  checks, reaction time and difficulty-scaled accuracy. They stop moving while
  firing, fall back to cover to reload empty magazines, peek from wall edges,
  and deliberately miss more often on lower difficulties.
- Enemy weapon drops: every defeated robot drops its weapon with a glowing
  pickup marker, floating name/ammo label and a ground ring. Stand within range
  and press E (or tap the prompt) to take it; the weapon replaces the matching
  slot and keeps the dropped magazine/reserve ammo.
- Twelve firearms plus a knife across rifles, snipers, SMGs, shotguns and
  sidearms: USP-S, P250, Desert Eagle, MP9, UMP-45, Galil AR, SG 553, AK-47,
  M4A4, AWP, SSG 08 and Nova. Each has its own first-person model, recoil,
  spread, reload and audio; SG 553/SSG 08/AWP have variable-zoom scopes, and the
  Nova fires eight pellets per trigger.
- Hitscan weapons with headshot multipliers, spread, recoil, reloads, weapon
  switching, tracers, muzzle flashes, shell casings, bullet decals and sparks.
- A practical round economy, 12-item buy menu (1-9 hotkeys for primaries),
  radar with weapon-drop markers, kill feed, scoreboard, freeze time, round
  results and a first-to-eight match.
- Procedural textures, models and Web Audio synthesis - no external asset
  requests and no CDN dependency.

## Files

| File | Purpose |
| --- | --- |
| index.html | The route partial (menu, HUD, overlays, touch controls). |
| game.css | All game styling, scoped under .csr; the Games-page card skin also lives here. |
| bootstrap.js | Tiny lazy loader loaded by the root page. Fetches the heavy assets only when #/range opens. |
| content.js | Weapons, bot catalogue, procedural textures, map, nav grid/A*, robot + viewmodel geometry, the sound synthesiser. |
| game.js | Match state machine, player controller, combat, robot AI, buy menu, HUD and rendering loop. |
| vendor/three.min.js | Vendored Three.js r158 (MIT, license header preserved). |

The loader order is three.min.js -> content.js -> game.js; the route is registered
in scripts/router.js and the entry card in views/games.html.

## Notes

- Rendering falls back to a free-look mode if the browser refuses pointer lock
  (headless browsers and some embedded views do); real desktop browsers use
  pointer lock normally.
- Touch devices get an on-screen stick, look-drag, fire, reload, jump, crouch and
  scope controls.
- The default quality is Balanced; Low disables shadows, High raises the shadow
  map and device pixel ratio. The menu also has mouse sensitivity, volume and bot
  difficulty/squad size.
- Bot difficulty changes both accuracy and deliberate miss chance: Recruit
  misses most often, Elite is the most precise.
- Everything is generated in the browser. Three.js is the only third-party
  dependency; its MIT license is retained in the vendored file.
