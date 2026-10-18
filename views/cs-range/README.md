# Dust Range

A CS:GO-flavoured, first-person robot-elimination range that runs entirely in the
browser. It is a self-contained insert for the Hayneko site, mounted at
#/range and linked from the Games page.

## Play

Open **Games / Dust Range** (or go directly to #/range), then press **DEPLOY** for the elimination match or **PRACTICE RANGE** for the free target range.

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Aim |
| Left mouse | Fire |
| Right mouse | Scope (AWP / SG 553 / SSG 08) |
| R | Reload |
| 1 2 3 | Pistol / primary / knife |
| Shift | Walk (steadier aim, quieter) |
| Ctrl | Crouch |
| Space | Jump |
| B | Buy menu during buy time (free in Practice Range) |
| E | Pick up a dropped weapon |
| Tab (hold) | Scoreboard (elimination only) |
| M | Mute |
| H | Controls / operator manual |
| Esc | Pause and release the mouse |

First side to eight rounds wins. Killing a robot pays $300 ($400 for a headshot);
a round win pays $3,250 and a loss pays $1,900. Dying loses the purchased loadout
and armour for the next round.

## What is in the range

- A hand-built de_dust-inspired map with sandstone walls, an archway, crates,
  containers, barrels, sandbag cover, two bomb sites and a distant skyline.
- Extra high cover: stacked shipping containers, tall concrete walls and brick
  sight-breakers around mid, the CT approach and the site flanks. They block
  shots and robot navigation while leaving flanking routes open.
- Two raised overlooks with walkable staircases (west/south approach and
  east-side approach), plus low jumpable crates/pallets. The player
  can auto-step up the 0.4 m stair treads or jump onto the 0.55 m blocks and
  fight from high ground.
- Chickens have a physical footprint as well as a bullet hitbox: the player and
  robots cannot walk through a bird, and the birds flee from nearby humans.
- Wandering chickens. The birds peck around the range, scurry away from the
  player, cluck and squawk, and can be shot for feathers. They never affect the
  round result.
- Randomised robot squads: scouts, troopers, heavies and snipers with random
  paint, names and per-bot stats. Each robot carries a primary, a secondary and
  a knife, with per-weapon magazines, reload times, sounds and damage scaling.
  Bots switch weapons in real time: rifle+SMG loadouts burst-fire and swap to
  the SMG up close, snipers retreat behind cover and may headshot the player,
  and an empty robot that is close enough may pull a knife. They still use A*
  navigation, line-of-sight checks, cover reloads and wall peeks, stop moving
  while firing, and deliberately miss more often on lower difficulties.
- Enemy weapon drops: every defeated robot drops its weapon with a glowing
  pickup marker, floating name/ammo label and a ground ring. Stand within range
  and press E (or tap the prompt) to take it; the weapon replaces the matching
  slot and keeps the dropped magazine/reserve ammo.
- Twelve firearms plus a knife across rifles, snipers, SMGs, shotguns and
  sidearms: USP-S, P250, Desert Eagle, MP9, UMP-45, Galil AR, SG 553, AK-47,
  M4A4, AWP, SSG 08 and Nova. Each has its own first-person model, recoil,
  spread, reload and audio; SG 553/SSG 08/AWP have variable-zoom scopes, and the
  Nova fires eight pellets per trigger.
- Hitscan weapons whose rays leave the exact crosshair centre, not the gun
  muzzle; first-person tracers, muzzle flashes, shell casings, bullet decals and
  sparks are visual only. Shots go where the crosshair points.
- Thin-wall penetration: three plywood partitions are shoot-through. The game
  measures the solid distance along each hit ray from the map colliders; walls
  up to **0.5 m** thick pass, up to **two layers**, with each layer cutting
  damage to **68%**. Thicker walls, crates and containers stop the round. The
  tracer and entry impact continue through the wall, and headshots still work on
  a robot standing behind it.
- Headshot feedback: gold crosshair hitmarker, a skull/HEADSHOT banner with the
  damage multiplier or kill bonus, a gold screen flash and a heavier headshot
  impact tone.
- Third-person death camera: when the player dies, the view pulls back to the
  fallen operator while the killer's name, weapon and result countdown are shown;
  sniper headshots are called out on the death panel and in the round result.
- A practical round economy, 12-item buy menu (1-9 hotkeys for primaries),
  radar with weapon-drop markers, kill feed, scoreboard, freeze time, round
  results and a first-to-eight match.
- Practice Range: no robots, twelve respawning paper/steel targets, two moving
  targets, infinite reserve, a free 12-item armory and score/hits/accuracy/target
  readouts. Great for testing every weapon and scope without spending cash.
- Five game locales: English, Simplified Chinese, Traditional Chinese, Japanese
  and Korean. The menu language selector changes the site locale through the
  existing i18n engine; static menu/HUD/buy/overlay text and JS-driven labels
  (phase, results, toasts, kill feed, pickup prompts, scoreboard) all follow it.
  Weapon names, bot names and the DUST RANGE wordmark stay in English.
- Procedural textures, models and Web Audio synthesis - no external asset
  requests and no CDN dependency.

## Files

| File | Purpose |
| --- | --- |
| index.html | The route partial (menu, HUD, overlays, touch controls). |
| game.css | All game styling, scoped under .csr; the Games-page card skin also lives here. |
| bootstrap.js | Tiny lazy loader loaded by the root page. Fetches the heavy assets only when #/range opens. |
| content.js | Weapons, bot catalogue, procedural textures, map, nav grid/A*, robot + viewmodel geometry, the sound synthesiser. |
| i18n.js | Game-specific translation dictionaries and the static/dynamic translation helper for five locales. |
| game.js | Match state machine, player controller, combat, robot AI, buy menu, HUD and rendering loop. |
| vendor/three.min.js | Vendored Three.js r158 (MIT, license header preserved). |

The loader order is three.min.js -> content.js -> i18n.js -> game.js; the route is
registered in scripts/router.js and the entry card in views/games.html.

## Notes

- Rendering falls back to a free-look mode if the browser refuses pointer lock
  (headless browsers and some embedded views do); real desktop browsers use
  pointer lock normally.
- Touch devices get an on-screen stick, look-drag, fire, reload, jump, crouch,
  scope and armory controls.
- Browser shortcuts are intercepted while #/range is mounted: Ctrl/Cmd+S,
  Ctrl/Cmd+F/P/D/A/R and the common F-key/Alt+Arrow combos no longer open
  save/find/print/bookmark/reload dialogs. Gameplay keys still pass through, so
  holding Ctrl to crouch and pressing S still crouch-walks backward. Ctrl+W and
  other window-level browser shortcuts cannot be reliably blocked by a page.
- The in-game language selector writes through window.i18n, so it also updates
  the rest of the site and persists the choice via the site's localStorage key.
  Missing game keys fall back to English rather than showing a blank label.
- The default quality is Balanced; Low disables shadows, High raises the shadow
  map and device pixel ratio. The menu also has mouse sensitivity, volume and bot
  difficulty/squad size.
- Bot difficulty changes both accuracy and deliberate miss chance: Recruit
  misses most often, Elite is the most precise.
- Everything is generated in the browser. Three.js is the only third-party
  dependency; its MIT license is retained in the vendored file.
