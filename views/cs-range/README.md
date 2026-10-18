# Dust Range

A CS2-flavoured, single-player 5v5 bomb-defusal game that runs entirely in the
browser. It is a self-contained insert for the Hayneko site, mounted at
#/range and linked from the Games page.

## Play

Open **Games / Dust Range** (or go directly to #/range), then press
**DEPLOY** and choose a side:

- **COUNTER-TERRORISTS** — you join four CT robots at CT spawn. Hold A and B,
  rotate on the plant and defuse the C4.
- **TERRORISTS** — you join four T robots at T spawn and carry the C4. Hold
  **E** on a bombsite to plant; your robot squad covers the site.

**PRACTICE RANGE** still opens the free target range directly. Every match is
the full Dust 2 lineup of five against five; the player fills one slot on the
chosen side.

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Aim |
| Left mouse | Fire |
| Right mouse | Scope (AWP / SG 553 / SSG 08) |
| Left mouse (dead) | Switch to the next living robot in third-person |
| R | Reload |
| 1 2 3 | Pistol / primary / knife |
| Shift | Walk (steadier aim, quieter) |
| Ctrl | Crouch |
| Space | Jump |
| B | Buy menu during buy time (free in Practice Range) |
| E | Pick up a dropped weapon; as CT hold to defuse; as T hold on a site to plant |
| Tab (hold) | Scoreboard |
| M | Mute |
| H | Controls / operator manual |
| Esc | Pause and release the mouse |

## Match rules

- **5 v 5, bomb defusal.** The player joins one side with four robot
  teammates; the other side fields five robots. First to **13 rounds** wins
  (MR12-length match).
- **Round win conditions** follow CS2. The CTs win by eliminating every
  terrorist before the bomb is planted, by defusing the C4, or by running the
  clock out without a plant. The Ts win by eliminating every CT, or by letting
  the C4 detonate (40 s fuse).
- **C4 objective.** As T the player carries the C4 from spawn. Hold **E** on a
  site for 3.2 s to plant; moving or releasing E cancels the attempt and the
  progress drains. A dropped C4 can be recovered by any surviving T. As CT the
  player can hold **E** at a planted C4 for 10 s, or 5 s with a defuse kit.
  Robot terrorists plant when they reach a site with the bomb; CT robots
  rotate, cover the defuser and race the fuse.
- **Economy.** Start with $800. Kills pay $300, headshots $400. A round win
  pays $3,250, a defuse win $3,500, and losses pay the CS loss bonus
  ($1,400 + $500 per consecutive loss, capped at $3,400). Survive and you keep
  your gun, armour and defuse kit; die and the loadout is gone. The armory is
  side-specific: CT can buy M4A4/MP9/UMP-45/AWP/SSG 08/Nova plus the defuse
  kit, while T buys AK-47/Galil AR/SG 553/MP9/UMP-45/AWP/SSG 08/Nova and no
  kit. Dropped weapons can always be picked up.
- **Death and spectating.** Dying does not end the round while a teammate is
  still alive. The camera drops to a third-person death view, then follows a
  living robot from a third-person chase camera. **Left mouse** cycles through
  the surviving robots. There is no defeat page and no round-result modal:
  the next round starts automatically after a short banner.
- **Round banner.** A round ends with a wide banner showing the winning side,
  the reason, the updated score and the player's reward. It clears itself and
  the next round begins after roughly three seconds (Space advances early).

## The Dust 2 map

The playable footprint is traced at **1 m resolution from the real de_dust2
radar** and rebuilt as a 75 × 80 m blockout, so the corridors, doorways,
elbows, courtyards and site corners follow the retail map rather than a
hand-waved box. Walls are generated around that footprint and offset
*outward*, which keeps even the narrow Dust 2 elbows walkable.

- **T Spawn** (south) with the outside-long exit and the tunnel route, plus
  awnings, planters, crates and lamp posts. The old sandbag barricades that
  sat across the main lanes, and the two low concrete blocks on the site
  edges, have been removed so every necessary path is open.
- **CT Spawn** (north) with short, A ramp, CT mid and B rotation connections.
- **A site** with default, ninja, short and long plant spots, goose platform,
  A car, stacked crates, barrels and readable A signboards.
- **B site** with default, back plat, B doors and box plant spots, back-plat
  platform, window frame, crates and the B car in the tunnels.
- **Mid**: top mid, mid, xbox, catwalk, short, mid doors with wooden door
  leaves and a wallbang lane.
- **Long A**: outside long, long doors, blue container, long A, pit, long
  corner and the A site entrance.
- **Tunnels**: outside tunnels, upper tunnels, lower tunnels, the tunnel arch
  ribs, B doors, dog/closet cover and the B site.
- Lower mid and the CT-to-B rotation connect the two halves, with the
  north-side CT street making rotations possible.

Perimeter walls carry pilasters, stone trim courses, shuttered wall niches and
concrete caps; the empty blocks are filled with low-rise buildings, rooftop
tanks and AC units so the skyline reads as Dust 2 from every angle. All static
boxes are merged per material at load time, keeping the detailed geometry at a
few hundred draw calls.

## Teams and AI

- **Your side.** The player joins CT or T with four robot teammates. The
  HUD, radar colours, scoreboard, buy menu, contact alerts and round banner
  all follow the chosen side.
- **Terrorists** get a per-round plan: one site and a main/flank route split
  (long + short for A; tunnels + lower mid for B). Each bot has a role —
  carrier, entry, support or lurk — and carries a team-appropriate loadout.
  The carrier advances, plants, and becomes a post-plant guard; the rest cover
  the plant and hold the retake angles. A dropped C4 is recovered by the
  nearest survivor. When the player is on T, the player is the initial C4
  carrier and the four robots take the entry/support/lurk roles.
- **Counter-terrorists** are split between A and B. They walk to real anchor
  spots, hold the entrances, fight with cover, rotate on a plant, and one bot
  takes the defuse while the others cover it. A defuser will stick the defuse
  once the fuse is low even under fire.
- **No friendly fire.** Player bullets stop on a teammate with a blue impact
  spark and never damage them; bot-vs-bot damage is also team-checked.
- **Idle relocation.** A bot holding an angle that has not seen an enemy for
  roughly 8-14 seconds leaves the spot, drifts between nearby holds or random
  nearby positions, then settles again. The cycle repeats until contact.
- **Contact warnings and support.** Any player or robot that spots an enemy
  raises a team alert with a callout (A Site, Mid, Long, B Tunnels...). The
  player's team gets the CONTACT panel and a radar ping; one or two allies
  break off to support the contact, then return to their anchor.
- All bots use A* navigation, line-of-sight checks, reaction times, strafing,
  range-aware weapon selection and cover during reloads. Bot kill feed and a
  five-vs-five scoreboard are live; bots drop their weapons when killed.
- **Rounded collision and corner sliding.** The player and every robot use a
  circular body against the box colliders, so a body cannot wedge on a right
  angle the way a square AABB does. Route and hold points are snapped to the
  nearest free spot at round start, and a blocked robot tries a short
  tangential slide and skips an unreachable waypoint instead of pushing into
  the wall.
- **Overhead health bars** are blue for your side and red for the enemy,
  independent of which side the player chose.
- **C4 recovery.** When a C4 carrier dies, the two or three closest
  terrorists converge on the dropped bomb; one picks it up, the rest regroup
  on the nearest site and cover the plant. The new carrier takes a direct
  route to that site.
- **Advantage hunt.** When the team has a clear numerical advantage (two or more
  extra allies alive, or at most two enemies left), and an enemy has been seen or
  called out, robots push the last known contact until the enemy squad is
  eliminated. They do not abandon an active plant, a defuse, or an in-progress
  C4 recovery.
- **Defuse kit.** A new $400 CT buy item halves the player's defuse time. CT
  bots use the ten-second defuse (no kit) so the player usually wins the race
  to the bomb.

## What else is in the range

- Twelve firearms plus a knife across rifles, snipers, SMGs, shotguns and
  sidearms: USP-S, P250, Desert Eagle, MP9, UMP-45, Galil AR, SG 553, AK-47,
  M4A4, AWP, SSG 08 and Nova. Each has its own first-person model, recoil,
  spread, reload and audio; SG 553/SSG 08/AWP have variable-zoom scopes, and
  the Nova fires eight pellets per trigger.
- Hitscan weapons whose rays leave the exact crosshair centre, not the gun
  muzzle; first-person tracers, muzzle flashes, shell casings, bullet decals and
  sparks are visual only. Shots go where the crosshair points.
- Weapon pickup swaps: if you already have a gun in that slot, the new drop is equipped and the old gun is thrown onto the floor as a real pickup with its current magazine and reserve ammo, not deleted. Picking up the same weapon merges its ammo instead.
- Thin-wall penetration: three plywood partitions are shoot-through. The game
  measures the solid distance along each hit ray from the map colliders; walls
  up to **0.5 m** thick pass, up to **two layers**, with each layer cutting
  damage to **68%**. Thicker walls, crates and containers stop the round. The
  tracer and entry impact continue through the wall, and headshots still work on
  a robot standing behind it.
- Headshot feedback: gold crosshair hitmarker, a skull/HEADSHOT banner with the
  damage multiplier or kill bonus, a gold screen flash and a heavier headshot
  impact tone.
- A third-person death camera followed by third-person teammate spectating
  with **LMB cycling**; the killer's name, weapon and headshot callout are in
  the kill feed. Round results are shown as a banner, not a page.
- A practical round economy, a side-specific buy menu including the CT defuse
  kit (the practice armory unlocks every weapon), a large 252 px radar with
  teammate, hostile and C4 markers, kill feed, scoreboard, freeze time and a
  first-to-thirteen match.
- Wandering chickens with physical footprints and bullet hitboxes that never
  affect the round result.
- Practice Range: no robots, twelve target boards across A site, infinite
  reserve, a free armory and score/hits/accuracy/target readouts.
- Five game locales: English, Simplified Chinese, Traditional Chinese, Japanese
  and Korean. Weapon names, bot names and the DUST RANGE wordmark stay in
  English.
- Procedural textures, models and Web Audio synthesis — no external asset
  requests and no CDN dependency.

## Files

| File | Purpose |
| --- | --- |
| index.html | The route partial (menu, HUD, overlays, touch controls). |
| game.css | All game styling, scoped under .csr; the Games-page card skin also lives here. |
| bootstrap.js | Tiny lazy loader loaded by the root page. Fetches the heavy assets only when #/range opens. |
| content.js | Weapons, bot catalogue, procedural textures, the Dust 2 map, nav grid/A*, robot + viewmodel geometry, the C4 model, the sound synthesiser. |
| i18n.js | Game-specific translation dictionaries and the static/dynamic translation helper for five locales. |
| game.js | Match state machine, player controller, combat, team AI, C4/defuse logic, buy menu, HUD, radar and rendering loop. |
| vendor/three.min.js | Vendored Three.js r158 (MIT, license header preserved). |

The loader order is three.min.js -> content.js -> i18n.js -> game.js; the route is
registered in scripts/router.js and the entry card in views/games.html.

## Notes

- Rendering falls back to a free-look mode if the browser refuses pointer lock
  (headless browsers and some embedded views do); real desktop browsers use
  pointer lock normally.
- Touch devices get an on-screen stick, look-drag, fire, reload, jump, crouch,
  scope, use/defuse and armory controls.
- Browser shortcuts are intercepted while #/range is mounted: Ctrl/Cmd+S,
  Ctrl/Cmd+F/P/D/A/R and the common F-key/Alt-Arrow combos no longer open
  save/find/print/bookmark/reload dialogs. Gameplay keys still pass through, so
  holding Ctrl to crouch and pressing S still crouch-walks backward. Ctrl+W and
  other window-level browser shortcuts cannot be reliably blocked by a page.
- The in-game language selector writes through window.i18n, so it also updates
  the rest of the site and persists the choice via the site's localStorage key.
  Missing game keys fall back to English rather than showing a blank label.
- The default quality is Balanced; Low disables shadows, High raises the shadow
  map and device pixel ratio. The menu still exposes difficulty, sensitivity
  and volume.
- Bot difficulty changes both accuracy and deliberate miss chance: Recruit
  misses most often, Elite is the most precise.
- Everything is generated in the browser. Three.js is the only third-party
  dependency; its MIT license is retained in the vendored file.
