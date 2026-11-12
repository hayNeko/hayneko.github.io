# i486 IDE — UI contract (DOM + module APIs)

This document is binding for the page shell (SH) and the wiring module (WR). It extends
CONTRACT.md section 13. The page is a standalone dark terminal-styled document at
i486/index.html, loaded as a plain file over http; it must not link styles/*.css or
scripts/*.js from the main site.

## 1. Page structure (top to bottom), mirroring views/labs-vm.html

    <header class="page-head">
      <div class="folio"> <span class="folio__no">04.2</span> Labs <span class="folio__rule"></span> ~/labs/i486 </div>
      <h1 class="page-head__title">i486DX personal computer</h1>
      <p class="page-head__sub">short subtitle</p>
    </header>
    <section class="section wb" data-i486="root">
      <div class="wb-bar"> ... </div>            machine bar: power state, disk, project, upload
      <div class="wb-toolbar" role="toolbar"> ... </div>   execution controls
      <div class="wb-grid">
        <div class="wb-col wb-col--main">
          <section class="wb-panel wb-panel--editor">  editor + its toolbar
          <section class="wb-panel wb-panel--dis">     disassembly listing
          <section class="wb-panel wb-panel--console"> assemble output / errors
        </div>
        <div class="wb-col wb-col--side">
          <section class="wb-panel wb-panel--screen">  VGA canvas + meta
          <section class="wb-panel wb-panel--regs">    registers + flags + cpu state
          <section class="wb-panel wb-panel--stack">   stack window
          <section class="wb-panel wb-panel--mem">     memory dump
        </div>
      </div>
      <section class="wb-files">                    disk image contents
    </section>
    <section class="section"> .term terminal (in-page command shell) + command hints </section>
    <section class="section"> cheat sheet grid </section>

Required classes: page-head/folio/folio__no/folio__rule/page-head__title/page-head__sub,
section/section__head/section__title/section__sub, wb, wb-bar, wb-toolbar, wb-grid,
wb-col, wb-col--main, wb-col--side, wb-panel, wb-panel__head, wb-panel__hint,
wb-btn (+ wb-btn--accent/run/ghost), wb-select, wb-input, wb-status, wb-cur, wb-files,
term, term__bar, term__body, term__prompt-line, term__ps1, term__input, term-suggest,
cheat, cheat__item. The layout must collapse to one column under 1100px and stay usable
at 380px width (no horizontal page scroll).

## 2. Required DOM nodes (exact data-i486 values; WR binds only to these)

Toolbar / bar:
  button[data-i486=power]        power on / off (label changes)
  button[data-i486=reset]        hardware reset
  button[data-i486=boot]         boot from disk (BIOS POST)
  button[data-i486=run]          run / continue
  button[data-i486=pause]        pause
  button[data-i486=step]         step into
  button[data-i486=over]         step over
  button[data-i486=out]          step out
  input[data-i486=speed]         instructions per frame (number, 1..2000000)
  button[data-i486=clear-bp]     clear breakpoints
  span[data-i486=status]         machine status text (READY / RUNNING / HALTED / FAULT)
  span[data-i486=eip]            current CS:EIP as text
  select[data-i486=project]      saved projects
  button[data-i486=project-new] / button[data-i486=project-save] / button[data-i486=project-del]
  button[data-i486=download-asm], button[data-i486=download-bin]
  button[data-i486=import]       triggers input[data-i486=import-file]
  input[type=file][data-i486=import-file] hidden, accept .asm,.bin,.img
  select[data-i486=sample], button[data-i486=sample-load]
  button[data-i486=disk-download], button[data-i486=disk-import],
  input[type=file][data-i486=disk-file] hidden accept .img
  button[data-i486=disk-format]

Editor panel:
  textarea[data-i486=source]      the assembly source (editor.js enhances it)
  div[data-i486=editor-host]      container editor.js mounts into
  div[data-i486=gutter], pre[data-i486=highlight]  created by editor.js inside the host
  button[data-i486=assemble]      assemble (Ctrl+Enter)
  button[data-i486=run-guest]     load into guest and run
  button[data-i486=run-com]       run standalone COM-style at 0x100
  button[data-i486=run-flat32]    run standalone 32-bit protected-mode program
  span[data-i486=asm-status]      bytes / errors summary

Disassembly: ol[data-i486=disasm] rows are <li data-addr="0x..." data-bp="0|1">
  with children span.ds-addr, span.ds-bytes, span.ds-text.
Console: pre[data-i486=console]

Screen panel: canvas[data-i486=screen] (backing store 640x400, CSS width 100%),
  span[data-i486=screen-mode], span[data-i486=screen-cursor],
  button[data-i486=screen-clear], label/input[data-i486=kb-capture] checkbox,
  span[data-i486=kb-hint].

Registers: div[data-i486=regs] rows: <div class="reg" data-reg="eax" data-width="32"><span class="reg__name">eax</span><span class="reg__val" data-edit>...</span></div>
Flags: div[data-i486=flags] with <button class="flag" data-flag="cf">CF</button> each
  (click toggles the flag).
CPU state: dl[data-i486=state] key/value rows including cr0, cr2, cr3, mode, cycles, ips,
  gdt, idt, halted.
Stack: ol[data-i486=stack] rows <li data-addr><span class="st__addr">..</span><span class="st__val">..</span></li>
Memory: input[data-i486=mem-base], select[data-i486=mem-follow], ol[data-i486=mem].

Files: ul[data-i486=files] rows <li data-name="HELLO.COM"><span class="file__name">..</span><span class="file__size">..</span><button class="file__run" data-run>run</button>
  plus button[data-i486=file-add] (add current project binary to disk) and
  button[data-i486=file-del].

Terminal: div[data-i486=term] log container, input[data-i486=term-input], and a
  div[data-i486=term-suggest] block of button[data-cmd="..."] shortcuts.

## 3. Theme (i486.css)

CSS custom properties on :root:
  --bg:#070b07; --bg-deep:#040604; --panel:#0b100b; --panel-2:#0e150f; --line:#1b2a1c;
  --fg:#c8f7d0; --fg-dim:#6f9c78; --green:#7dfa9a; --green-deep:#2f7a45;
  --amber:#f2c14e; --red:#ff5f56; --cyan:#62d8ff; --magenta:#d78bff; --blue:#7aa2ff;
  --mono: "JetBrains Mono","Cascadia Mono","SFMono-Regular",Consolas,"DejaVu Sans Mono",monospace;
  --radius:2px; --gap:10px;
Dark only (color-scheme: dark). Background may carry a subtle CRT scanline overlay via
repeating-linear-gradient at very low alpha; no images, no external fonts, no heavy glow.
Focus rings must be visible (amber 1px outline).
Panels use 1px --line borders, square corners, uppercase 11px panel headers with letter-spacing.
Buttons: mono 12px, 1px border, transparent background, hover inverts (green bg, dark text);
run/accent buttons use --green or --amber; disabled state 40% opacity.

## 4. editor.js API (SH)

    I486.Editor.create(host, { textarea, highlight, gutter, onChange, onCursor, onAssemble })
      -> { getValue(), setValue(s), insert(s), focus(), setErrors(list),
           clearErrors(), setActiveLine(n), setBreakpoints(arrayOfLines),
           toggleBreakpoint(line), getBreakpointLines(), getCursor(), setCursor(line,col),
           on(evt, fn) }

Implementation: transparent textarea over a highlighted <pre> (scroll synced), gutter with
line numbers and breakpoint dots, tab inserts two spaces, Enter keeps indentation,
Ctrl+Enter fires onAssemble, error lines get a red gutter marker and title.
Must handle 2000-line files without lag (highlight the viewport only or debounce under 30 ms),
and must not break IME/composition input.

## 5. highlight.js API (SH)

    I486.Highlight.html(source) -> string      // escaped HTML, token spans class t-*
    I486.Highlight.LINE_CLASS = 'code-line'
Token classes: t-com, t-str, t-num, t-reg, t-mnem, t-dir, t-lab, t-pfx, t-punct.
Pure and fast (regex-based, no eval), escapes HTML.

## 6. What the shell must NOT do

* No inline <script> logic beyond a small static boot notice; no network requests.
* No dependency on ui.js at parse time: the page must look complete and readable with
  ui.js missing (placeholders are static text).
* No main-site assets: no styles/tokens.css, no scripts/router.js, no i18n.
* No <link> to external fonts/CDNs.

## 7. Script tags order (SH writes them; WR's file is last)

    lib/bus.js, lib/cpu.js, lib/devices.js, lib/asm.js, lib/disasm.js, lib/disk.js,
    lib/guest.js, lib/bios.js, lib/machine.js, lib/highlight.js, lib/editor.js,
    lib/samples.js, lib/ui.js   (all with defer)

## 8. Acceptance for the shell

* Opens standalone at http://127.0.0.1:8123/i486/index.html with no console errors other
  than expected 404s for lib files not yet written.
* Layout stays aligned at 1440x900, 1100x800 and 390x844; no clipped controls, no
  horizontal scrolling of the document.
* All data-i486 nodes exist exactly once; the editor shows a placeholder program and
  highlights it; breakpoint clicking works on a static sample in demo mode.
* i486.css is self-contained and under ~1200 lines, readable, with a short comment map at the top.
## 9. Automation hook (binding for WR / ui.js)

Headless acceptance is driven by Chrome DevTools Protocol, so the page must expose a small
plain-data hook once initialization finishes. Nothing else may be added to window
(everything else stays inside the modules).

    window.I486App = {
      ready: true,                       // set only after the machine is constructed
      version: '1.0',
      machine: <the I486.Machine instance>,
      assemble: function () { /* -> { ok, bytes: number[], errors: [{line,message}] } */ },
      loadSample: function (name) { /* returns the source string that was loaded */ },
      runGuest: function (steps) { /* assemble + load into guest + run; -> { ok, steps } */ },
      step: function (n) { /* -> { eip, cs, steps } */ },
      screenText: function () { /* -> array of 25 strings from the VGA text buffer */ },
      consoleText: function () { /* -> string of the console panel */ },
      setSource: function (text) { /* -> void, updates the editor */ },
      getSource: function () { return '<current editor text>'; },
      projects: function () { /* -> array of saved project names */ },
      saveProject: function (name) { /* -> true/false */ },
      readProject: function (name) { /* -> source string or null */ },
      deleteProject: function (name) { /* -> true/false */ },
      files: function () { /* -> [{ name, size }] of the attached disk image */ },
      addFile: function (name, bytes) { /* -> true/false, writes into the HYFS image */ },
      state: function () { /* -> { mode, eip, halted, cycles, status } */ }
    };
    document.documentElement.dataset.i486Ready = '1';

Rules:
* These calls must work synchronously from a CDP Runtime.evaluate and must never throw;
  return plain JSON-serialisable values.
* runGuest/step must run the CPU synchronously for the requested budget (no rAF waiting),
  so a headless check does not depend on animation frames.
* The page must also work when opened from file:// (no fetch/XHR at runtime; every asset is
  a classic script or a same-directory file). Do not use ES modules or import().
* Local storage keys stay under the i486.* namespace; if localStorage is unavailable (file://
  with strict settings), fall back to an in-memory store instead of throwing.
## 10. Shared panel, live disassembly, follow/unpin scrolling (revision 2)

This section supersedes the panel layout in section 1/2 where they conflict. The editor and the
disassembly now share one panel and switch with tabs; disassembly, memory and stack become
windowed, live views over the whole address space.

### 10.1 Tabs
* Markup inside the left column's first panel:
  - tab bar with two buttons: `[data-i486=tab-editor]` and `[data-i486=tab-disasm]`,
    `role="tab"`, `aria-selected`, `aria-controls` pointing at the panes.
  - panes: `[data-i486=pane-editor]` (editor host, assemble/run buttons, asm-status) and
    `[data-i486=pane-disasm]` (disassembly toolbar + list). Exactly one pane is visible;
    the other carries the `hidden` attribute.
* Switching: click / Enter / Space on a tab, `Ctrl+1` = editor, `Ctrl+2` = disassembly.
  The choice persists in `localStorage['i486.tab']`. An assembly error or a breakpoint hit may
  add a dot badge on the other tab, but must not steal focus or switch tabs by itself.

### 10.2 Live disassembly of the whole address space
* The list is virtualised: at most ~150 rows in the DOM at any time. It decodes on demand from
  the bus (`machine.bus.getBytes(linear, 16)` + `I486.Disassembler.disassemble(..., {bits, origin})`)
  for ANY linear address in 0x00000000-0xFFFFFFFF; `bits` follows the current CS.D
  (16-bit real mode / 32-bit protected mode), refreshed when the machine state changes.
* Default state is FOLLOW: the row containing CS:EIP is highlighted and kept in view while the
  CPU runs, steps or pauses. Following must not re-render the whole list on every frame; only
  update the highlight and scroll into view when EIP leaves the visible window.
* Scrolling (wheel, drag, scrollbar, PageUp/Down) immediately unpins: follow turns off, the
  current anchor stays put, and the list keeps growing in BOTH directions without limit.
  Backwards decoding is implemented by trying start offsets -1..-15 bytes before the first visible
  instruction and choosing the longest chain that decodes exactly into the known anchor.
* Restore follow with the toolbar toggle, a double click on the EIP chip, or `Ctrl+Home`.
* Toolbar: `[data-i486=dis-follow]` (toggle, shows FOLLOW / UNPINNED), `[data-i486=dis-goto]`
  (hex address + Enter or `Ctrl+G`), `[data-i486=dis-eip]` (jump to CS:EIP). Rows keep
  `data-addr` and clicking one still toggles a breakpoint. The current instruction row also
  shows the bytes and the effective address.
* A `db 0xNN` run may be collapsed into one row (`db 0x00 x12`) as long as expanding on click
  is possible and reassembly stability is not lost.

### 10.3 Memory panel
* Default FOLLOW = `esp`; the select `[data-i486=mem-follow]` gains `esp` as its first option and
  that is what a fresh page uses (persisted in `localStorage['i486.mem.follow']`).
* While following, the base is the followed register rounded down to 16 and the dump refreshes
  when it changes. Scrolling the list unpins (select flips to `none`), the base freezes at its
  current value, and further scrolling loads rows above/below on demand, without limit.
* `[data-i486=mem-base]` still accepts a hex address; `Ctrl+Home` returns to the followed base.

### 10.4 Stack panel
* Default follows ESP. Scrolling unpins and lets the user walk the stack in both directions
  (virtual rows, addresses shown), double-click a row to send the memory panel there, and
  `Ctrl+Home` to follow ESP again. Show a small pin/unpin indicator.

### 10.5 Performance and accessibility
* Decode at most ~2k instructions per animation frame; throttle scroll handlers with
  requestAnimationFrame; never allocate per row beyond the visible window.
* Panes are focusable (`tabindex=0`) and support PageUp/PageDown/Home/End/Ctrl+Home.
* Keep all existing `data-i486` nodes working; this revision only adds `tab-editor`,
  `tab-disasm`, `pane-editor`, `pane-disasm`, `dis-follow`, `dis-goto`, `dis-eip`, and the
  `esp` option in `mem-follow`.

### 10.6 Automation additions (I486App)
    I486App.setTab('editor' | 'disasm')        // -> the active tab name
    I486App.tab()                              // -> 'editor' | 'disasm'
    I486App.disasmAt(addr, rows)               // -> [{ addr, text }] live decode, rows <= 200
    I486App.follow()                           // -> { disasm, memory, stack } booleans
    I486App.setFollow(panel, on)               // panel = 'disasm' | 'memory' | 'stack'

### 10.7 Acceptance for revision 2
* `I486App.setTab('disasm')` shows only the disassembly pane; the editor is hidden and typing
  does not reach it; switching back restores the same source and caret.
* `I486App.disasmAt(0xF0000, 5)` returns the ROM monitor's real instructions; `disasmAt(0, 5)`
  returns `db` rows for the IVT; both must succeed for any address in 0..0xFFFFFFFF.
* While following, stepping the CPU moves the highlight; a wheel event unpins, and scrolling
  up 200 rows and back down returns to the same addresses (round trip, no duplicates or gaps
  beyond variable-length instruction boundaries).
* Memory follows ESP by default (select value `esp`), and one wheel event flips it to `none`
  with the base frozen; the stack panel behaves the same way.
* No console errors at any point; the page stays responsive while the disassembly list grows
  to thousands of rows.
## 11. Revision 4: true halt, editable system registers, follow any register

### 11.1 HALT must stop execution completely
* PAUSE (button) and the terminal `halt` command must both bring the machine to a full stop:
  no animation frames, no HALT_TICK, no instruction retired, `cycles` and `EIP` frozen.
* While the CPU is stopped by the user the status is `PAUSED` (reason logged); the guest HLT
  tick (512 instructions/frame) is only legitimate while the user asked to RUN and the CPU
  is waiting inside HLT with interrupts enabled.
* RUN after a halt resumes execution: the UI must clear the machine's stopped state through a
  public API (`machine.resume()`), never by poking `_stopped`.
* `Machine.step()` must respect the stopped state (return 0, retire nothing) so an IDE that
  single-steps while stopped cannot advance the CPU.

### 11.2 Editable segment and control registers
* The state panel rows for `CS DS ES FS GS SS` are click-to-edit like the general registers:
  inline input accepting `0x1234`, `1234h` or decimal, Enter commits through
  `cpu.setSeg(name, selector)`, Esc/blur cancels. Invalid selectors (descriptor missing,
  privilege violation, bad limit) must be reported in the console and leave the CPU unchanged.
* `CR0`, `CR2`, `CR3` are click-to-edit through `cpu.setCR(index, value)` (same input rules,
  full 32-bit hex display). A rejected write is logged, never thrown.
* Editing must refresh the whole panel immediately (base/limit/mode/PE fields included).

### 11.3 Memory follow may name any register
* `[data-i486=mem-follow]` offers: `none`, `eip` (means CS:EIP), `eax ecx edx ebx esp ebp esi
  edi`, and the six segment registers `cs ds es fs gs ss` (following a segment means its base).
  The chosen register is read on every refresh; the base is `value & ~15`.
* The choice is persisted (`localStorage['i486.mem.follow']`) and the `esp` default is kept.
* The console/terminal summary should name what is being followed (e.g. `follow: eax`).

### 11.4 Acceptance
* Boot to `hy486>`, press PAUSE, wait 1.5 s: `state().cycles` and `state().eip` unchanged;
  press RUN: cycles increase again. Repeat with the terminal `halt` command.
* Set `ds` selector to `0x0000` and `0x0100` via the UI: `cpu.getSeg('ds').sel` and `.base`
  follow; set `cr3` to `0x00002000`: `state().cr0/cr3` reflect it; an invalid `cs` write logs an
  error and leaves `cs.sel` unchanged.
* Select `eax` in the memory follow list: the base equals `(eax & ~15)` and tracks a change of
  EAX; select `ds`: the base equals the DS base; all 16 options exist.
