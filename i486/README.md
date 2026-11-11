# i486DX personal computer

A complete 80486DX PC that runs in a browser tab: hardware model, a self-written 64 KB BIOS,
an IDE hard disk with its own filesystem, a bootable mini-kernel, and a Nasm-style assembly IDE
with a source-level debugger. Everything in `i486/` is standalone — no build step, no npm
dependencies, no external ROM or disk images, no network at runtime.

Open `i486/index.html` from any static server (see *Running* below). The page is a dark
Linux-terminal style workstation: one panel on the left switches between the editor and a live
disassembler, the VGA screen, registers, stack and memory sit on the right, disk contents and a
command terminal run underneath.

## What is inside

| part | what it does |
|---|---|
| `lib/cpu.js` | i486DX core: real mode, 16/32-bit protected mode, V86 basics, 4 KB paging, IDT/gates/privilege checks, the full integer instruction set with 486 encodings (ModR/M, SIB, 66/67 and segment prefixes, 0F map), exceptions with error codes, 387 FPU subset |
| `lib/bus.js` | physical memory and port I/O: 32 MB RAM, the 0xA0000-0xFFFFF hole, ROM with the 0xFFFFFFF0 reset alias, A20 gate, MMIO range registration, open-bus semantics, per-port handlers |
| `lib/devices.js` | 8259A PIC pair, 8254 PIT, 8042 keyboard, CMOS/RTC, VGA (text mode 3 and 13h), ATA PIO disk, 16550A serial, 8237 DMA registers, 8272A stub, port 0x92 |
| `lib/bios.js` | the BIOS as real assembly source (assembled at boot into exactly 64 KB at 0xF0000): POST, INT 10h/13h/16h/1Ah/15h/08h/09h/1Ch/18h/19h/21h, ATA PIO helpers, E820 map, ROM monitor |
| `lib/disk.js` | HYFS: the on-disk format (superblock, 128-entry directory, 4-sector clusters) plus a live mount view for the page |
| `lib/guest.js` | boot loader + HY486 kernel, written in the same assembly dialect and assembled in the page at load time |
| `lib/asm.js` | NASM-style assembler: two passes, local labels, `equ`/`%define`, `bits`/`org`, `db`-`dq`, `times`, `resb`, expressions, shortest-encoding rules, precise per-line errors |
| `lib/disasm.js` | disassembler that re-assembles byte-exactly, so the listing and the editor agree |
| `lib/machine.js` | wires CPU, bus, devices and BIOS; services interrupts and the PIT, loads programs, boots disks, single-steps and runs to breakpoints |
| `lib/editor.js`, `lib/highlight.js` | line-numbered editor with breakpoints and error markers, 486 assembly syntax highlighting |
| `lib/samples.js` | nine demo programs (INT 10h/21h output, Fibonacci, string ops, mode 13h, FPU, protected mode 32-bit, timer, boot sector) |
| `lib/ui.js` | the whole page: run loop, panels, keyboard capture, projects in localStorage, import/export, terminal, `window.I486App` automation hook |

## Running

```sh
python -m http.server 8124 --bind 127.0.0.1 --directory .
# then open http://127.0.0.1:8124/i486/index.html
```

Any static server works. Note for this machine only: ports 8024-8123 are inside a Windows
TCP exclusion range, so `8123` (what `serve.cmd` uses for the main site) cannot be bound here —
use 8124 or 8137. The page also works from `file://` because every asset is a classic script
and nothing is fetched at runtime.

## Using the machine

* **POWER / RESET / BOOT** — power on, hardware reset, boot from the attached disk. POST prints the
  banner, memory size, device table, E820 entry count and the disk geometry, then boots the HY486
  kernel, which prints its own banner and a `hy486>` prompt.
* **RUN / PAUSE / STEP / OVER / OUT / RESTART** — execution controls; the speed box is instructions
  per animation frame. Breakpoints: click the gutter, `Ctrl+B`, or click a disassembly row.
* **Keyboard** — tick *capture keyboard* on the screen panel, then type; the page feeds set-1
  scancodes to the 8042, so the guest shell receives real keystrokes (including `Enter`, arrows and
  function keys). `Esc` releases capture.
* **Editor** — write assembly, `Ctrl+Enter` (or ASSEMBLE) assembles, errors land in the console and
  on the gutter, the disassembly panel follows the program. RUN .COM loads the bytes at 0x0100 in
  real mode, RUN IN GUEST writes them onto the disk and boots the kernel, RUN FLAT32 enters protected
  mode with flat 32-bit segments.
* **Projects** — the project selector stores sources in `localStorage` (`i486.projects.v1`); download
  `.asm` or the assembled `.bin`, import `.asm`/`.bin`/`.img`.
* **Disk** — the disk panel lists HYFS files with RUN buttons, can add the current binary, delete
  files, download or import the raw image, and reformat it.
* **Terminal** — the in-page shell drives the machine: `boot`, `reset`, `run`, `step`, `regs`,
  `mem <addr>`, `dis <addr>`, `asm`, `disk`, `ls`, `cat <file>`, `save`/`load`, `speed`, `clear`.
* **Two tabs, one panel** — `EDITOR` and `DISASSEMBLY` share the left column (`Ctrl+1` / `Ctrl+2`,
  the choice is remembered). Assembly errors and breakpoint hits mark the other tab with a dot.
* **Live disassembly of the whole address space** — the listing follows `CS:EIP` by default and
  highlights the current instruction. Scroll, and it unpins: the anchor stays where it was and the
  list keeps decoding in both directions, backwards included (candidate start offsets are tried so
  x86's variable-length instructions still line up). `Ctrl+G` or the goto box jumps to any linear
  address you can name, the `CS:EIP` chip returns to the program counter, and clicking a row arms a
  breakpoint there. Nothing is pre-decoded: every row is decoded from the bus on demand, so even
  `0xFFFFFFFF` shows real bytes (or `db 0xFF` where the bus is open).
* **Stack and memory follow the CPU** — the stack follows `ESP` and the memory dump follows `ESP`
  too by default. Scroll either one and it unpins (the pin chip turns amber, the memory selector
  switches to `none`) so you can walk the whole 4 GiB in both directions; `Ctrl+Home` or the pin
  chip snaps back to the register, and double-clicking a stack row sends the memory dump there.

## The guest

`hy486>` commands: `help`, `dir`, `type FILE`, `run FILE`, `del FILE`, `mem`, `ver`, `time`, `date`,
`cls`, `reboot`, `halt`, `boot FILE`, `break`. `run FILE` loads a flat `.COM` image at 0x0100 with
CS=DS=ES=SS=0, a 0xFFFE stack and a DOS-style `INT 20h` exit stub, so programs written for the IDE
behave like small DOS programs; the kernel also installs `INT 21h` for 00h/02h/09h/30h/4Ch and
chains everything else to the BIOS.

## Hardware map

| range | use |
|---|---|
| 0x00000-0x9FFFF | 640 KB conventional RAM |
| 0x9FC00-0x9FFFF | EBDA (0x9F00) |
| 0xA0000-0xBFFFF | VGA memory (text 0xB8000, mode 13h 0xA0000) |
| 0xF0000-0xFFFFF | 64 KB BIOS ROM, reset vector at 0xFFFF0 |
| 0x100000-0x1FFFFFF | extended RAM (reported through E820 and INT 15h AH=88h) |

Ports: 0x20/0x21, 0xA0/0xA1 (PIC), 0x40-0x43 (PIT), 0x60/0x64 (keyboard), 0x70/0x71 (CMOS),
0x3C0-0x3DA (VGA), 0x1F0-0x1F7 + 0x3F6 (ATA), 0x3F8-0x3FF (serial), 0x00-0x0F and 0x80-0x8F (DMA),
0x3F0-0x3F7 (FDC stub), 0x92 (A20 / fast reset). IRQs: 0 timer, 1 keyboard, 2 cascade, 4 serial,
8 RTC, 14 ATA. Interrupt vectors 08h-0Fh, 10h-1Ch, 18h, 19h and 21h are installed by the BIOS.

## HYFS disk format

Sector 0 is the boot sector (either the HY486 loader or any user image). Sector 1 is the superblock
(`HYFS`, version, cluster size, file count, total sectors, boot flags). Sectors 2-9 are a fixed
128-entry directory (12-byte name, 4-byte first cluster, 4-byte size, 1-byte attributes). Data
starts at sector 12 and grows in contiguous 4-sector clusters. `I486.Disk.format/list/readFile/
writeFile/deleteFile/mount/check` are the JS side of the same format.

To run an external disk image, IMPORT .IMG attaches it as the ATA master and BOOT goes through
INT 19h: sector 0 is read to 0x0000:0x7C00 with INT 13h, checked for 0xAA55 and jumped to. The BIOS
implements CHS and LBA INT 13h transfers (AH=02h/03h/08h/41h/42h/43h). Real 386-era boot sectors
that use the standard DS:DX disk-address packet work; anything needing unimplemented hardware
(protected-mode-only loaders, 32-bit operating systems with DMA floppy drivers, etc.) will not boot.

## Instruction fidelity

The decoder covers the 8086-486 one-byte and 0F maps with the 486's encodings, the accumulator
shorthand forms, sign-extended imm8 forms, the 0x90-0x97 xchg aliases, MOV moffs addressing with the
correct address-size rules, and rejects instructions the 486 did not have (CMOVcc, RDTSC, WRMSR,
SYSENTER, FXSAVE, CMPXCHG8B, ...) with #UD. The suite sweeps all 256 one-byte opcodes and asserts
that nothing valid raises #UD and nothing throws.

Documented gaps: hardware task switching raises #GP (TSS is still used for ring-0 stacks), the FPU
uses IEEE doubles instead of 80-bit extended registers, debug registers do not trap, LOCK is
accepted without a bus lock, INVD/WBINVD are no-ops, and V86 support is basic (no VIF/VIP
virtualisation). `lib/cpu.js` has a GAPS header with the same list.

## Tests

```sh
node i486/test/run-all.cjs      # every suite: cpu, asm, disasm, devices, machine, guest, crosscheck
node i486/test/ui.smoke.cjs     # samples assemble without a browser
```

Current state (Node 24, whole run under a second):

| suite | tests | suites |
|---|---|---|
| cpu | 114 | 18 |
| asm | 373 | 7 |
| disasm | 345 | 6 |
| devices | 62 | 10 |
| machine | 52 | 12 |
| guest | 47 | 6 |
| crosscheck | 128 | 3 |
| **total** | **1121** | **62** |

`crosscheck.test.cjs` is the integration suite: it checks hand-derived Intel encodings, the
assembler -> disassembler -> assembler round trip, and actually executes assembled programs on the
CPU (Fibonacci in memory, string ops with DF, INT/IRET through the IVT, a protected-mode far jump
into a flat 32-bit segment). The CPU core runs real 16-bit code at roughly 30M instructions/s and
the halted monitor at about 100M steps/s in Node; the page slices execution into ~10-20k
instruction frames so the UI stays responsive.

## Automation

The page exposes `window.I486App` once it is ready:

```js
I486App.assemble()          // { ok, bytes, errors }
I486App.runGuest()          // assemble, put the program on the disk, boot and run it
I486App.step(1)             // synchronous CPU step(s)
I486App.screenText()        // the 25 VGA text lines
I486App.projects() / saveProject(name) / readProject(name) / deleteProject(name)
I486App.files() / addFile(name, bytes)
I486App.state()             // mode, eip, halted, cycles, status
```

`document.documentElement.dataset.i486Ready` is `1` when the machine is live, which makes the page
headless-testable: a small Chrome DevTools Protocol script can drive boot, assemble, run and step
without touching the DOM by hand.

## Credits

Instruction semantics were cross-checked against the *Intel 80386 Programmer's Reference Manual*
(1986), which is also linked from the site's Labs page. The 486-only additions come from the i486
programmer's reference and Intel's opcode tables. Everything in `i486/` — BIOS, boot loader, kernel,
assembler, disassembler, devices and UI — was written for this project.