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
| Right mouse | Scope (AWP / SSG 08 / SCAR-20 / G3SG1 / SG 553 / AUG / FAMAS) |
| Left mouse (dead) | Switch to the next living robot (first-person spectate) |
| R | Reload |
| 1 2 3 | Pistol / primary / knife |
| 4 | Cycle grenades (HE / flash / smoke / incendiary / decoy) |
| 5 | Zeus x27 (single-use) |
| G | Quick-throw the selected grenade |
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
- **C4 objective.** When you pick T, the C4 is assigned randomly each round
  to you or one of the four T robots (one carrier per round). Hold **E** on a
  site for 3.2 s to plant; moving or releasing E cancels the attempt and the
  progress drains. A dropped C4 can be recovered by any surviving T. As CT the
  player can hold **E** at a planted C4 for 10 s, or 5 s with a defuse kit.
  Robot terrorists plant when they reach a site with the bomb; CT robots
  rotate, cover the defuser and race the fuse.
- **Economy.** Start with $800. Kill rewards now follow the weapon used
  ($300 for rifles, $600 for SMGs, $900 for shotguns, $100 for the AWP, $1,500
  for the knife), plus $100 for a headshot. A round win pays $3,250, a defuse
  win $3,500, and losses pay the CS loss bonus ($1,400 + $500 per consecutive
  loss, capped at $3,400). Survive and you keep your gun, armour and defuse
  kit; die and the loadout is gone. The armory is side-specific and now covers
  the full CS2 catalogue: ten pistols, seven SMGs, seven rifles, four snipers,
  four shotguns, two machine guns, the Zeus x27, five grenades, armour and the
  CT defuse kit. Dropped weapons can always be picked up, and robots use the
  same swap rules.
- **Buy clock.** Opening the armory no longer freezes the clock. Buy time keeps
  draining while the menu is open and the armory closes itself when the round
  goes live (or when the player closes it).
- **Death and spectating.** Dying does not end the round while a teammate is
  still alive. After the brief death view the camera goes **first-person**
  inside a living teammate's head; the robot model is hidden and the HUD shows
  that robot's live HP and current magazine. **Left mouse** cycles through the
  surviving robots. There is no defeat page and no round-result modal: the next
  round starts automatically after a short banner.
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
  nearest survivors. When the player is on T, the C4 is randomly given to the
  player or one of the four robots each round; everyone else takes an
  entry/support/lurk role.
- **Counter-terrorists** are split between A and B. They walk to real anchor
  spots, hold the entrances, fight with cover, rotate on a plant, and one bot
  takes the defuse while the others cover it. A defuser will stick the defuse
  once the fuse is low even under fire.
- **No friendly fire.** Player bullets stop on a teammate with a blue impact
  spark and never damage them; bot-vs-bot damage is also team-checked. HE
  blasts and fire pools only damage the opposing side.
- **Robot economy.** Every robot owns a wallet and a saved loadout. Round
  wins/losses and kills pay into that wallet; robots buy rifles, SMGs,
  shotguns, armour, grenades and the occasional AWP before walking out of
  spawn. A robot that survives keeps its gun and armour; a robot that dies
  loses the loadout and the wallet survives. Robots consume magazines, reload
  from a real reserve, switch to a loaded secondary or knife when dry, and
  walk to dropped weapons, swap them in and use them.
- **Idle relocation.** A bot holding an angle that has not seen an enemy for
  roughly 8-14 seconds leaves the spot, drifts between nearby holds or random
  nearby positions, then settles again. The cycle repeats until contact.
- **Contact warnings and support.** Any player or robot that spots an enemy
  raises a team alert with a callout (A Site, Mid, Long, B Tunnels...). The
  player's team gets the CONTACT panel and a callout; one or two allies break
  off to support the contact, then return to their anchor. The minimap never
  shows enemy positions, spotted or otherwise.
- All bots use A* navigation, line-of-sight checks, reaction times, strafing,
  range-aware weapon selection and cover during reloads. Bot kill feed and a
  five-vs-five scoreboard are live; bots drop their weapons when killed.
- **Rounded collision and corner sliding.** The player and every robot use a
  circular body against the box colliders, so a body cannot wedge on a right
  angle the way a square AABB does. Route and hold points are snapped to the
  nearest free spot at round start, and a blocked robot tries a short
  tangential slide and skips an unreachable waypoint instead of pushing into
  the wall.
- **Overhead health bars** exist only for the player's own side, in blue.
  Enemy HP and names are never drawn, independent of which side the player
  chose.
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
  robots mostly take the ten-second defuse; if a robot bought a kit it gets the
  five-second defuse, so the player still usually wins the race to the bomb.
- **Early-death revenge.** A robot cut down in the opening seconds of a round
  records the killer's last position and site. In the next round it may take
  that run back, but only once its own side has a real numerical advantage
  (two extra allies alive, or at most two enemies left). Revenge never
  abandons a plant, a defuse or C4 recovery, and it is suppressed when team
  fear is very high.

## Robot skill and memory

- **Independent skill for each side.** The setup panel has separate
  **ALLY ROBOT SKILL** and **ENEMY ROBOT SKILL** selectors (Recruit, Regular,
  Veteran, Elite, Ace). Changing the ally skill never moves the enemy skill, and
  vice versa. Both are stored in localStorage.
- Skill controls reaction time, first-shot delay, sight range, perception
  tick rate, accuracy, deliberate miss chance, damage, fire cadence, movement
  speed, footstep hearing and planning:
  - higher skill sees farther and processes targets more often;
  - on acquiring a target, a high-skill robot snaps onto it and fires much
    sooner (Ace is around a tenth of a second, Elite slightly slower, versus
    about half a second for Recruit);
  - higher skill is more accurate, fires faster and takes fewer deliberate
    misses.
- **Top end is much harder.** The new **Ace** tier uses 1.85× sight, a 0.25×
  perception interval, a 0.1 reaction multiplier, 2.6× damage, 0.3× fire
  interval, 1.8× accuracy, a 0.1% deliberate-miss chance and 34 m hearing.
  Elite was raised to 1.6× sight, 0.34× perception, 0.18 reaction, 2.05×
  damage, 0.4× fire, 1.5× accuracy and 27 m hearing. Regular and Veteran were
  raised as well.
- **Footsteps.** Robots with hearing range on their skill tier can hear an
  enemy's running footsteps through geometry. Walking (Shift) and crouching
  make the player quieter. Hearing records a sound contact in the robot's
  memory; Veteran, Elite and Ace also raise a team callout, and the robot will walk
  toward the sound and scan it. Recruit hears only very close steps.
- **Self-learning route memory.** Deaths are written to a local
  `hayneko.range.ai.v1` record containing the route, site, position, number
  of nearby allies/enemies, round and bomb state. At the start of each round
  T robots weigh the death/use ratio of the main and flank routes and pick the
  safer lane (high-skill robots exploit the memory more; low-skill robots
  explore more). CT deaths by site are recorded too; if one site is clearly deadlier, the
  next round sends more CT anchors there and leaves the other site lighter.
- **When to group.** Isolated or outnumbered deaths raise that team's group
  bias. When the bias is high enough (sooner for high-skill robots), a robot
  that has drifted more than ~7 m from its nearest teammate paths back to the
  squad instead of continuing alone. A kept-together squad is therefore a
  learned response to previous lonely deaths, not a fixed formation.
- The memory is per browser, capped to the last 40 deaths, and survives page
  reloads.
- **Twitch penalty / stall watchdog.** A robot that keeps trying to move but
  gains less than a few centimetres, or oscillates around the same spot, is
  treated as stalled after about a second. Its path is cancelled and it is
  forced into a short wander for up to 2.6 s. If at least three living robots
  are stalled at once, every non-critical robot has its path cleared and is
  forced to wander, breaking a squad-wide freeze even when all four teammates
  are wedged on the same corner.
- **First-person spectating.** After death the camera goes inside the selected
  teammate's head (the robot model is hidden), not behind it. The HUD and the
  spectate card show that robot's live HP and current magazine ammo; LMB cycles
  teammates.
- **Chickens.** Robots collide with chickens. If a chicken sits in their path
  they steer around it; at close range there is a chance they simply kill it,
  so a chicken can no longer pin a robot against a doorway.
- **No backpedal fire.** A robot holding a firing solution never moves away
  from its target while shooting; it strafes or advances instead. Retreating
  while shooting forward is no longer possible.
- **Late-round gamble.** With 30 seconds or less on the clock, at least three
  teammates alive and the C4 still carried, one robot per team (a lurk/support
  when possible) starts a deliberate full-map gamble: it patrols callout to
  callout until it finds an enemy, then rejoins normal combat. The C4 carrier,
  defuser and planting robots are excluded.
- **Route fear.** Repeated deaths on a lane raise that lane's fear value. The
  fear cools down with time (roughly half every two minutes) and is reduced
  when a robot — or the player — kills an enemy on that same lane. A wipe adds
  fear to every lane the losing team used, while a feared lane is strongly
  avoided when the next round picks a route.
- **Team morale and panic.** Team fear is separate from lane fear and is stored
  with the local AI memory. Two teammates dying within five seconds raises it
  sharply and shakes the survivors for eight seconds; a third or fourth rapid
  death escalates it further. While shaken, non-carrier survivors pull toward
  the nearest teammate, stop pushing alone, suppress aggressive hunts and
  gambles, and hold instead. Fear decays over time.
- **No panic stare loop.** Panic is a short, intermittent rally (roughly 1.2–2.2 s
  every 6–9 s), not a permanent override. The rally point is offset to the side
  of the teammate instead of on top of them, and the robot faces the threat or
  the map rather than locking eyes with its ally. This fixes the old failure
  where, at very high team fear (>0.8) with the player dead, two robots drifted
  into each other and then stood motionless or stared face-to-face until the
  round ended. Idle relocation also waits until the round has been live for
  five seconds, so robots take their real posts before starting a patrol.
- **Round-start grace.** The stall watchdog ignores the first 1.6 s of a live
  round. This stops the whole squad from being flagged as stuck on the first
  frame after freeze time and forced into a pointless opening wander.
- **4K / 5K confidence.** A round kill counter is kept for the player and every
  robot. The fourth kill by an ally cuts team fear by 0.18 and the fifth by
  0.35, clears the shaken timer and shows a confidence toast. Kills of the
  player by an enemy robot count toward that robot's 4K/5K too.
- **Re-plan after a death.** Every teammate or robot death (rate-limited to
  about 1.2 s so a burst of deaths is one revision) triggers a short 0.9 s
  tactical regroup. T survivors re-pick their main/flank lane from the nearest
  waypoint using the current fear memory; CT survivors redistribute an anchor
  to the under-defended site. This is a real re-plan, not just a visual pause.

## Weapon feel and feedback

- **Human-like shooting.** Robot aim is no longer a perfect turret. Every new
  target starts a skill-scaled reaction delay (roughly 80–800 ms, longer for
  distant, moving or partially hidden targets), followed by a flick that can
  overshoot by 1.8–7° and settle back. Aim then carries a low-frequency sway
  (about 0.35–1.4°, growing while aiming and under pressure) so the reticle
  drifts instead of locking. The first rounds of a burst are the most honest;
  sustained spray drifts unless spray control is high.
- **Fire modes with inertia.** Robots choose between single taps, short bursts
  and sprays by range, weapon, target speed and panic, and keep that mode for
  roughly a second instead of changing every frame. A long spray is forcibly
  reset after 6–16 rounds; each burst ends with an observation pause, and a
  kill is followed by a 180–380 ms confirmation beat before snapping to the
  next target. Low health or high team fear shortens reaction, widens aim and
  pushes robots toward sprays.
- **Reload discipline.** Each robot has a genome reload threshold and a real
  reserve. When the magazine falls below the threshold and no target is
  visible, it moves toward cover and reloads before the dry click. In a fight
  it can also take a probabilistic tactical reload at range, and when both
  magazine and reserve are empty it switches to a loaded secondary or the
  knife — and goes looking for a dropped gun — instead of standing still.
- **Behavior genome.** Each robot receives a genome (burst length, burst pause,
  aggression, spray control, reload threshold, cover weight, peek rhythm,
  reaction delay). The team genome is kept in local AI memory and lightly tuned
  after each round based on the result, so firing rhythm and aggression adapt
  over a match without a neural network.
- **Sniper scope cycle.** Firing a scoped sniper immediately drops the scope for
  the bolt/rechamber interval, then automatically scopes back in. If the shot
  empties the magazine, the scope stays down through the reload and reopens as
  soon as the new magazine is seated. Manually spamming the scope during the
  bolt cycle is blocked.
- **Reload animation.** The view-model dips and rolls further during a reload,
  the magazine visibly drops out, and a physical magazine prop is thrown
  forward from the camera. It falls to the ground, bounces, and disappears
  after a few seconds.
- **Thrown utility.** Five CS2 grenades can be bought, carried (four slots,
  flashbang capped at two) and thrown with **4** to cycle and LMB / **G** to
  throw. HE deals distance-falloff blast damage; flashbangs create a real
  screen-white blind scaled by distance and view angle; smoke lasts 18 s and
  blocks robot line of sight (not just the player's view); incendiary/molotov
  leaves a seven-second fire pool that ticks damage and is extinguished by
  smoke; decoys rattle off fake shots before a small pop. Projectiles bounce
  off walls, fuse on a timer, and molotovs break on impact. Robots also buy
  and throw HE/flashbangs when they lose sight of an enemy behind cover.
- **Minimap.** Only teammates and the C4 objective are drawn on the radar.
  Enemies are never shown, even if a teammate has spotted them.

## What else is in the range

- The full 34-firearm CS2 catalogue plus the Zeus x27 and a knife: ten
  pistols, seven SMGs, seven rifles, four sniper rifles, four shotguns and two
  machine guns, each with its own recoil, spread, magazine, reserve, reload,
  armour penetration, kill reward and audio. Scoped weapons cover AWP, SSG 08,
  SCAR-20, G3SG1, SG 553, AUG and FAMAS; each shotgun fires eight pellets.
- **Rebuilt weapon models.** The first-person armoury was replaced with a
  procedural gun foundry: layered receivers, rails with teeth, iron sights,
  trigger guards, charging handles, ejection ports, curved magazines, scope
  rings/turrets/lenses, heat shields, bipods, stock combs, shell carriers and
  gloved support hands. Robot-held guns now follow the weapon category the
  robot actually bought (pistol, SMG, rifle, sniper, shotgun or MG), and the
  buy menu is grouped into RIFLES / SNIPERS / SMGS / SHOTGUNS / MACHINE GUNS /
  PISTOLS / UTILITY / EQUIPMENT sections.
- Hitscan weapons whose rays leave the exact crosshair centre, not the gun
  muzzle; first-person tracers, muzzle flashes, shell casings, bullet decals and
  sparks are visual only. Shots go where the crosshair points.
- Weapon pickup swaps: if you already have a gun in that slot, the new drop is equipped and the old gun is thrown onto the floor as a real pickup with its current magazine and reserve ammo, not deleted. Picking up the same weapon merges its ammo instead.
- **One-wall penetration.** The game measures the solid distance along each
  hit ray from the map colliders; walls up to **0.5 m** thick pass, but only
  **one layer**. The first wall cuts damage to **68%** and the tracer continues;
  a second wall, crate or container always stops the round. This removes the
  old spawn-to-spawn wallbang lane through stacked thin geometry.
- Headshot feedback: gold crosshair hitmarker, a skull/HEADSHOT banner with the
  damage multiplier or kill bonus, a gold screen flash and a heavier headshot
  impact tone.
- A third-person death camera followed by first-person teammate spectating
  with **LMB cycling**; the killer's name, weapon and headshot callout are in
  the kill feed. Round results are shown as a banner, not a page.
- A practical round economy, a grouped side-specific buy menu with the full
  arsenal, five grenades, the CT defuse kit and the Zeus x27 (the practice
  armory unlocks everything), a large 252 px radar with teammate and C4
  markers (never enemy positions), kill feed, scoreboard, freeze time and a
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
| content.js | Full weapon + utility catalogue, bot catalogue, procedural textures, the Dust 2 map, nav grid/A*, the procedural gun foundry, robot models with category-specific guns, grenade models, the C4 model and the sound synthesiser. |
| i18n.js | Game-specific translation dictionaries and the static/dynamic translation helper for five locales. |
| game.js | Match state machine, player controller, combat, robot economy/loadouts, team AI and revenge, thrown-utility simulation, C4/defuse logic, grouped buy menu, HUD, radar and rendering loop. |
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
  map and device pixel ratio. The menu still exposes both robot-skill
  selectors, sensitivity and volume.
- The two robot-skill selectors change reaction, accuracy, sight, hearing,
  speed and planning independently for your side and the enemy side. Ace is
  the hardest of the five tiers; Recruit is the most forgiving.
- Everything is generated in the browser. Three.js is the only third-party
  dependency; its MIT license is retained in the vendored file.
