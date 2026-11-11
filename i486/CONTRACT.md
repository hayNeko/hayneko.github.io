# i486DX emulator — build contract (single source of truth)

Everything in i486/ is a standalone static site: no build step, no npm dependencies,
no network access at runtime, no external ROMs or disk images. Modules are classic
browser scripts **and** Node-loadable for headless tests.

## 1. Product

A browser i486DX PC: self-written BIOS, real memory map, IDE/ATA hard disk with our
own tiny filesystem, a self-written real-mode mini-kernel (HY486) that boots to an
interactive shell, plus a terminal-styled page with a mini IDE (NASM-style assembly,
assemble / run / step, breakpoints, save / download / import). The page layout mirrors
views/labs-vm.html; the palette is a dark Linux terminal and must not depend on the
main site's CSS.

## 2. Files & ownership (never edit a file you do not own)

| owner | files |
|---|---|
| dispatcher | i486/CONTRACT.md, i486/test/harness.cjs, i486/test/run-all.cjs, i486/package.json |
| S1 cpu | i486/lib/cpu.js, i486/test/cpu.test.cjs |
| S2 asm | i486/lib/asm.js, i486/lib/disasm.js, i486/test/asm.test.cjs, i486/test/disasm.test.cjs |
| S3 devices | i486/lib/bus.js, i486/lib/devices.js, i486/test/devices.test.cjs |
| S4 machine/bios | i486/lib/machine.js, i486/lib/bios.js, i486/test/machine.test.cjs |
| S5 guest/disk | i486/lib/guest.js, i486/lib/disk.js, i486/test/guest.test.cjs |
| S6 ui | i486/index.html, i486/i486.css, i486/lib/ui.js, i486/lib/editor.js, i486/lib/highlight.js, i486/lib/samples.js |

Do not touch main-site files (the site entry link is the dispatcher's job). Never
git commit / git checkout / git clean.

## 3. Module format

Classic script + CommonJS in one file, registering into globalThis.I486:

    (function (root, factory) {
      'use strict';
      var api = factory();
      if (typeof module === 'object' && module.exports) module.exports = api;
      root.I486 = root.I486 || {};
      for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
    })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
      'use strict';
      // ...
      return { CPU: CPU };
    });

Rules:
* cpu.js, asm.js, disasm.js, bus.js, devices.js must be self-contained (no require of
  siblings, no DOM, no window use beyond the UMD root).
* Later modules may look up siblings lazily from globalThis.I486 at call time (for
  example machine.js uses I486.Bus), so Node tests must load dependencies first.
* ES2018 syntax is fine (classes, const, arrow, template strings). Strict mode.
* No comments that restate code. Document non-obvious hardware behaviour only.
* Deterministic: never read Date.now() inside cpu/bus/devices except the RTC, never
  use randomness.

## 4. Shared conventions

**Little-endian** everywhere. Addresses are unsigned 32-bit.

**Register names** (strings, case-insensitive): eax ecx edx ebx esp ebp esi edi eip
eflags; ax cx dx bx sp bp si di ip; al ah cl ch dl dh bl bh; cs ds es fs gs ss.

**Flag names**: cf pf af zf sf tf if df of iopl nt rf vm ac vif vip id.

**Segment object**: { sel, base, limit, big, dpl, type, s, p, g, valid } where limit
is the byte limit after applying granularity and big is the D/B bit.

**Port I/O** uses 32-bit port numbers, widths 1/2/4.

## 5. CPU (i486/lib/cpu.js) — I486.CPU

    var cpu = new CPU(bus);          // bus per section 6; no DOM needed
    cpu.reset();                     // 486 RESET state, see below
    cpu.step();                      // execute ONE instruction; returns cycles (>=1)
    cpu.run(n);                      // execute up to n instructions; returns executed count
    cpu.serviceInterrupt(vec);       // deliver a hardware interrupt (INTA result = vec)
    cpu.serviceNMI();
    cpu.canInterrupt();              // IF && !interruptShadow && !halted
    cpu.servicePendingInterrupt();   // used by machine
    cpu.translate(linear, isWrite, isUser); // linear -> physical; raises #PF on fault
    cpu.readMem8/16/32(linear, segReg); cpu.writeMem8/16/32(linear, segReg, v)
    cpu.getReg(name) / cpu.setReg(name, value)
    cpu.getFlag(name) / cpu.setFlag(name, v)
    cpu.getSeg(reg) / cpu.setSeg(reg, sel)
    cpu.getCR(i) / cpu.setCR(i, v)   // 0, 2, 3
    cpu.getDR(i) / cpu.setDR(i, v)
    cpu.cycles                       // approximate retired cycles
    cpu.halted                       // HLT state (cleared on interrupt)
    cpu.tripleFault                  // true after a fault with no handler
    cpu.lastException                // {vector, errorCode, eip} | null

Also expose convenience accessors cpu.eax, cpu.eip, cpu.eflags, cpu.cr0, cpu.cs
(segment object) via Object.defineProperty on the prototype.

### Reset state (real i486DX)
CR0 = 0x60000010; CS = {sel:0xF000, base:0xFFFF0000, limit:0xFFFF, big:false};
EIP = 0x0000FFF0; EAX = 0; EDX = 0x00000404 (family 4, model 0); other general
registers 0; EFLAGS = 0x00000002; CR3 = 0; DR7 = 0x400; IDT base 0, limit 0x3FF; all
data segments share the CS base/limit; FPU reset; halted=false; paging off.

### Instruction coverage (must decode/execute)
* Full 8086/186/286/386/486 integer set, 16- and 32-bit operand/address size,
  prefixes 66 67 F0 F2 F3 2E 36 3E 26 64 65 (multiple/redundant prefixes allowed).
* One-byte map and 0F two-byte map (386/486 entries): 0F 00 (sldt/str/lldt/ltr/verr/verw),
  0F 01 (sgdt/sidt/lgdt/lidt/smsw/lmsw/invlpg), 0F 02 lar, 0F 03 lsl, 0F 20/22 mov cr,
  0F 21/23 mov dr, 0F 30 wrmsr must #UD, 0F 31 rdtsc must #UD (not 486),
  0F A2 cpuid (implement: family 4, model 3, stepping 3, features FPU/VME/DE set, PSE/TSC clear),
  0F B6/B7 movzx, 0F BE/BF movsx, 0F A3/AB/B3/BB bt/bts/btr/btc, 0F A4/AC shld,
  0F A5/AD shrd, 0F A8/A9/AA push/pop gs, 0F A0/A1 fs, 0F AF imul, 0F B0/B1 cmpxchg,
  0F C0/C1 xadd, 0F BC bsf, 0F BD bsr, 0F 90-9F setcc, 0F 40-4F cmovcc must #UD,
  0F 0B ud2 must #UD, 0F C8-CF bswap.
* 486-specific: bswap, xadd, cmpxchg, invd, wbinvd, invlpg, clts, mov cr0/cr2/cr3,
  mov tr (#UD), alignment check.
* FPU: 387 subset behind the D8-DF escapes — data transfer, arithmetic, compare,
  fldcw/fstcw/fnstsw/fninit/fclex, fld1/fldz/fldpi, fabs/fchs/fsqrt, fxch/fincstp/
  fdecstp/ffree, fstsw ax, fwait. Tag/status words plausible. Unimplemented FPU
  opcodes raise #UD(6) because a 486DX has the FPU built in.
* Exceptions: #DE(0) #DB(1) NMI(2) #BP(3) #OF(4) #BR(5) #UD(6) #NM(7) #DF(8) #TS(10)
  #NP(11) #SS(12) #GP(13) #PF(14) #AC(17); error codes where the CPU pushes them;
  #PF pushes CR2.
* Modes: real mode; protected mode (16/32, GDT/IDT/LDT, privilege checks, gates,
  int/iret with privilege transitions and stack switches); paging (4KB pages, CR0.PG,
  A/D bits, U/S, R/W, invlpg); V86 (basic: segment bases/limits from TSS, IF/IOPL
  emulation, iret/task return). Task switching: implement if feasible, otherwise
  raise #GP and document it — never hang.
* hlt, wait, nop, lock (accepted), string ops with DF/REP for movs/stos/lods/cmps/scas
  in byte/word/dword, rep/repne, loop, loope, loopne, jcxz/jecxz.
* Shift/rotate count masking per 486 (count & 0x1F, zero count leaves flags), imul
  two-/three-operand forms, div/idiv with #DE, mul CF/OF semantics, daa/das/aaa/aas/
  aam/aad, cbw/cwde, cwd/cdq, xlat, sahf/lahf, pusha/popa/pushad/popad, enter/leave,
  bound, arpl.
* Instruction-boundary interrupts, sti shadow (one instruction), mov ss shadow, popf
  IF-change shadow.

### Performance & robustness
* No allocation in the hot path (no object literals per instruction).
* Unimplemented opcode becomes #UD, never a JS throw.
* step() always makes forward progress or raises.
* Target at least 3M instructions/s in Node; cpu.run(n) must not allocate.

## 6. Bus & memory (i486/lib/bus.js) — I486.Bus

    var bus = new Bus({ ramMB: 32 });
    bus.read8/read16/read32(pa); bus.write8/write16/write32(pa, v);
    bus.mapRead(pa, len, fn); bus.mapWrite(pa, len, fn);
    bus.setROM(pa, Uint8Array|number[]);
    bus.getBytes(pa, len) -> Uint8Array; bus.setBytes(pa, bytes);
    bus.setA20(on); bus.a20;
    bus.io.in8(port) / in16 / in32 ; bus.io.out8(port, v) / out16 / out32
    bus.io.addPort(port, { read: function(port, width){...}, write: function(port, width, v){} });
    bus.io.ports          // Map of registered ports (for the UI)
    bus.unhandledPorts    // Map<port, count> diagnostics
    bus.errorLog          // array of short strings, newest last, cap 200

* RAM: 0x00000000-0x0009FFFF plus 0x00100000 for ramMB-1 MB; 0x000A0000-0x000FFFFF
  is device/ROM space. 32 MB default.
* Unmapped reads return 0xFF, writes are ignored (logged).
* MMIO handlers win over RAM; unaligned access splits into byte accesses.
* ROM writes are ignored. bus.a20=false masks bit 20 for addresses >= 0x100000.
* bus.ram exposes the Uint8Array so tests can inspect memory directly.
* Port registration is first-wins; handlers may be re-registered on reset. Missing
  port handlers return 0xFF and log once per port.

## 7. Devices (i486/lib/devices.js) — I486.Devices

    var dev = I486.Devices.install(bus, host);
    // returns { pic, pit, keyboard, cmos, vga, ata, serial, dma, floppy, reset }

* **8259A pair** at 0x20/0x21, 0xA0/0xA1: ICW1-4, OCW1-3, IRR/ISR/IMR, EOI, cascade
  on IRQ2, read request register (OCW3). pic.ack() -> number|null returns the vector
  of the highest pending unmasked IRQ and marks ISR; pic.request(line)/pic.release(line);
  IRQ priorities 0..7 then 8..15 via the slave.
* **8254 PIT** at 0x40-0x43: counters 0-2, modes 0-5 (2 and 3 correct, others
  plausible), pit.advance(cycles) converts CPU cycles at 1.193182 MHz, IRQ0 on
  terminal count, latch-read command, pit.frequency configurable.
* **8042 keyboard** at 0x60/0x64: status (OBF 0x01, IBF 0x02, SYS 0x04, CMD 0x08,
  INH 0x10, AUX 0x20, T/O 0x40, PERR 0x80), controller commands 0x20/0x60/0xA7/0xA8/
  0xAA/0xAB/0xAD/0xAE/0xC0/0xD0/0xD1/0xD2/0xD3/0xD4/0xFE/0xFF, set-1 scancodes,
  kb.press(code)/kb.release(code) queue make/break bytes, IRQ1 when a byte is ready.
* **CMOS/RTC** at 0x70/0x71: 0x00-0x0D time/date (BCD), 0x0A status A (UIP),
  0x0B status B (24h, DSE), 0x0D status D, 0x0F shutdown, 0x10 floppy type,
  0x12 hard disk type, 0x14 equipment, 0x17/0x18 memory above 1 MB in KB,
  0x30/0x31 extended memory, 0x32 century 0x20, 0x34/0x35. NMI mask bit 0x80 on 0x70.
* **VGA**: mode 3 text 80x25 16-color at 0xB8000; mode 13h 320x200 256-color at
  0xA0000; mode 12h optional. Text: 4KB text buffer (word per cell), CRTC cursor
  (0x3D4/0x3D5 0x0A-0x0F), start address 0x0C/0x0D, sequencer, GDC, attribute
  controller, status 0x3DA. API: vga.text (Uint16Array(2000)), vga.mode (3 or 0x13),
  vga.cursor ({x,y}), vga.dirty, vga.getLine(y) -> string, vga.getScreenText() ->
  array of 25 strings, vga.render(canvas) draws the current mode scaled to the
  canvas, vga.setCursor(x,y), vga.writeChar(ch, attr, x, y), vga.clear(attr),
  vga.setPalette(i, r, g, b). Default palette: standard CGA 16 colors.
* **ATA PIO primary** at 0x1F0-0x1F7 (+0x3F6 alt status): master device 0 only;
  commands 0xEC IDENTIFY (256 words, model HYN486 HDD, 255 sectors/track, 16 heads,
  sectors = image/512, LBA capable), 0x20/0x21 READ SECTORS, 0x30/0x31 WRITE SECTORS,
  0x91 INITIALIZE DEVICE PARAMETERS, 0xE7 FLUSH CACHE, 0x08 DEVICE RESET, 0xC6/0xEF
  SET FEATURES (accept); status bits 0x80 BSY, 0x40 DRDY, 0x08 DRQ, 0x20 DF, 0x01 ERR;
  error codes (0x04 ABRT), IRQ14 on completion, 512-byte PIO through 0x1F0,
  ata.setImage(Uint8Array), ata.image, ata.sectors, ata.dirty, ata.geometry {cyl,heads,spt}.
* **Serial 16550A** at 0x3F8-0x3FF, IRQ4: RBR/THR/DLL/DLM/IER/IIR/FCR/LCR/MCR/LSR/MSR/
  SCR, serial.output string buffer, serial.writeText(s), serial.clear(),
  serial.feed(s), serial.onByte optional callback.
* **DMA 8237** basic register model at 0x00-0x0F and 0x80-0x8F (channel 2 for floppy);
  no transfer engine required, must not crash.
* **Floppy 8272A** at 0x3F0-0x3F7: register-compatible stub (status ready, no drive) so
  probes do not hang; document as unsupported.
* **Port 0x92** A20 gate plus fast reset bit (bit 0) -> bus.setA20 / dev.reset.
* **0xCF8/0xCFC PCI config** is not a 486 feature: must read 0xFF.
* dev.reset() restores power-on state for every device.

## 8. Assembler (i486/lib/asm.js) — I486.Assembler

    var r = I486.Assembler.assemble(source, { bits: 32, origin: 0x100, defines: { FOO: 1 } });
    // r = { ok, bytes: Uint8Array, origin, symbols: Map<string, number>,
    //       errors: [{ line, col, message }], listing: [{ line, addr, bytes, text }] }

NASM-style Intel syntax:
* bits 16|32, org <expr>, NAME equ <expr>, %define NAME value
* labels name:, local labels .loop (scoped to the previous global label), $ = current
  address, $$ = origin
* data: db dw dd dq with numbers, strings, char literals; times n db v; dd label;
  resb/resw/resd (advance, emit zeros)
* comments start with ';'; blank lines allowed; mnemonics/registers case-insensitive
* operands: register, immediate, memory [base + index*scale + disp], segment override
  [es:di] and es:[di], size byte|word|dword, also byte ptr / word ptr / dword ptr
* encoding rules: shortest NASM-compatible encoding (accumulator special forms
  04/05/0C/0D/14/15/1C/1D/24/25/2C/2D/34/35/3C/3D; group 1 with imm8 80/82/83 when
  the value fits signed 8-bit; mov r32, imm32 = B8+r; xchg eax, r32 = 0x90+r except
  eax/eax; push imm = 6A when it fits; imul r, r/m, imm8 = 6B; inc/dec r32 = 40+/48+;
  test accumulator forms A8/A9)
* short/near jump-size hints must be honoured (needed by the disassembler round trip);
  unresolved labels in jmp/call/jcc become rel16/rel32
* far immediate transfers: jmp 0xF000:0xFFF0, call 0x0000:0x7C00
* rep, repne, lock prefixes; string ops with explicit size (movsb/movsw/movsd, stosb,
  lodsd, cmpsw, scasb, ...)
* full 486 instruction set listed in section 5, including enter/leave, bound,
  pushad/popad, pushfd/popfd, iretd, setcc, shld/shrd, bt*, bswap, xadd, cmpxchg,
  invd/wbinvd/invlpg, mov cr/dr, cpuid, lgdt/lidt/lldt/ltr/lmsw/smsw/sldt/str,
  lar/lsl/verr/verw, clts; rdtsc must be rejected (not 486) with a clear error
* errors carry line numbers and never throw
* pure JS, no eval, linear-time; must handle 2000-line inputs

## 9. Disassembler (i486/lib/disasm.js) — I486.Disassembler

    I486.Disassembler.disassemble(bytes, { bits: 16, origin: 0, count: 1 })
    // -> { instrs: [{ addr, bytes: Uint8Array, length, text, mnemonic, operands }], length }
    I486.Disassembler.range(bytes, { bits, origin, maxInstrs })

* text must be re-assemblable by section 8 and must reproduce identical bytes for all
  instructions the assembler supports (explicit short/near hints for relative jumps,
  explicit byte/word/dword for ambiguous memory operands)
* unknown opcodes become 'db 0xNN' with length 1
* operand formatting matches what the assembler accepts: mov eax, dword [ebx+ecx*4+0x10];
  add byte [bx+si+0x4], 0x1; jmp short 0x7C10; mov cr0, eax; rep stosd

## 10. Machine (i486/lib/machine.js) — I486.Machine

    var m = new I486.Machine({ ramMB: 32, bios: I486.BIOS.source });
    m.powerOn();              // reset CPU, assemble+load BIOS ROM
    m.run(n);                 // n instructions with IRQ0/keyboard/ATA servicing
    m.step();
    m.reboot();
    m.loadDiskImage(Uint8Array);
    m.screen                  // the VGA adapter
    m.serialOutput()
    m.setKey(scancode, down)
    m.loadProgram(bytes, { mode: 'com16' | 'boot16' | 'flat32', org })
    m.runUntil(addr, maxSteps) // 'hit' | 'limit' | 'halt' (step-over/breakpoints)
    m.state()                 // { eip, halted, tripleFault, mode, cycles, ... }
    m.onFault = fn; m.onScreen = fn; m.onSerial = fn;

* BIOS ROM is assembled from I486.BIOS.source at construction (cache the result).
* Memory map: RAM per section 6; ROM 0xF0000-0xFFFFF; VGA 0xA0000-0xBFFFF; the reset
  vector 0xFFFFFFF0 aliases the ROM.
* run drives pit.advance(cpu.cycles), keyboard, ATA IRQ, PIC, and delivers interrupts
  with cpu.serviceInterrupt(pic.ack()).
* loadProgram('com16'): bytes at 0x0100, CS=DS=ES=SS=0, SP=0xFFFE, EIP=0x100, 16-bit,
  clear direction flag; 'boot16': bytes at 0x7C00, CS=0, EIP=0x7C00; 'flat32': install
  a flat GDT (code 0x08 base 0 limit 4GB D=1, data 0x10), set CR0.PE, load segments,
  place bytes at 0x100000, EIP=0x100000, 32-bit.
* Must construct in Node with no DOM. Only vga.render(canvas) touches the DOM and
  ui.js calls it.

## 11. BIOS (i486/lib/bios.js) — I486.BIOS

I486.BIOS = { source: <ASM string>, entry: 'post', build(assembler) -> { bytes, symbols } }
Self-written 16-bit real-mode BIOS, assembled at boot, 64KB ROM image (org 0xF0000,
reset vector at 0xFFFF0). Requirements:
* POST: clear the 0x400 BDA area, build the IVT at 0x0000, print the banner + memory
  test + device table on VGA text, program 8259/8254/CMOS/keyboard, set A20 via 0x92,
  build the E820 map at 0x9000, set EBDA, install all interrupts, then INT 19h.
* INT 10h: 00 set video mode (03h, 13h), 01 cursor shape, 02 set cursor, 03 get cursor,
  05 page, 06/07 scroll window, 08 read char/attr, 09/0A write char(+attr) N times,
  0B set palette, 0C write pixel, 0D read pixel, 0E teletype (CR/LF/BS/BEL),
  0F get mode, 10 palette, 11 font (no-op), 12 alt select (0x10), 13 write string.
* INT 13h: 00 reset, 01 status, 02 read CHS, 03 write CHS, 04 verify, 05 format
  (unsupported), 08 drive params, 15 disk type, 41 extensions present, 42 extended
  read LBA, 43 extended write LBA. Drive 0x80 = ATA master (geometry from IDENTIFY),
  drive 0x00 = no floppy, error 0x01.
* INT 16h: 00 blocking read (BIOS ring buffer), 01 check, 02 shift state, 10/11/12
  extended (zero).
* INT 1Ah: 00 ticks since midnight + rollover, 01 set ticks, 02/04 RTC time/date.
* INT 15h: 24 A20, 86 wait, 88 mem KB above 1 MB, E8 01 E820 map, E8 20 memory map.
* INT 08h/1Ch timer chain, INT 09h keyboard (read scancode, translate, buffer, EOI),
  INT 19h boot, INT 18h ROM monitor, INT 21h minimal DOS services (01, 02, 09, 0A, 30,
  4C, 40).
* Boot: INT 19h reads sector 0 from 0x80 into 0x0000:0x7C00 via INT 13h AH=02, checks
  0xAA55 at 0x7DFE, jumps jmp 0x0000:0x7C00; on failure prints a message and drops
  into the ROM monitor.
* ROM monitor: prompt, commands help, mem, dump, boot, reboot, ticks; line editing via
  INT 16h.
* Must fit in 64KB with its own stack (SS=0, SP=0x7C00 early). Readable, sectioned asm.

## 12. Guest, disk (i486/lib/guest.js, i486/lib/disk.js)

    I486.Disk.format({ sectors: 65536, files: [{ name:'HELLO.COM', data: Uint8Array, attr:0 }] })
    I486.Disk.list(image) -> [{ name, size, attr }]
    I486.Disk.readFile(image, name) -> Uint8Array | null
    I486.Disk.writeFile(image, name, data) -> boolean
    I486.Disk.mount(image) -> { files, readFile, writeFile, list }

Custom filesystem HYFS (document the layout in the module header):
* sector 0: boot sector (written by guest.js bootloader)
* sector 1: superblock: magic HYFS, version, sector size, cluster size, file count,
  total sectors, boot flags plus boot kernel name
* sectors 2..: directory entries (32 bytes: 12-byte name, 4-byte first cluster, 4-byte
  size, 1-byte attr, reserved), data clusters of 4 sectors, contiguous allocation

    I486.Guest.build({ assembler, files }) -> { image, bootSector, kernel }

* Bootloader (real asm, org 0x7C00, 512 bytes): load superblock + kernel through
  INT 13h extended read (LBA) into 0x0000:0x8000, jump to it; set DS/ES/SS/SP, enable
  A20, keep DL boot drive.
* Kernel HY486 (real mode, <= 48KB): banner, prompt hy486>, line editor via INT 16h,
  commands help, dir, type FILE, run FILE, del FILE, mem, ver, time, date, cls,
  reboot, halt, boot FILE (chain-load), break; executes flat .COM binaries loaded at
  0x100 with CS=DS=SS=0, provides INT 21h pass-through to BIOS; exit returns.
* Source is our own dialect (section 8) and must assemble with our assembler.

## 13. IDE / page (i486/index.html, i486/i486.css, i486/lib/ui.js, editor.js, highlight.js, samples.js)

Layout mirrors views/labs-vm.html: page-head (folio 04.2, title, subtitle), workbench
bar, debug toolbar, grid (left: mini IDE editor + disassembly + console; right: VGA
screen, registers/flags, CPU state, stack, memory dump), files panel, terminal, cheat
sheet. Dark Linux-terminal palette: --bg #070b07, panel #0c110c, phosphor #7dfa9a,
amber #f2c14e, red #ff5f56, monospace stack. No dependency on styles/*.css.

IDE features: multi-file projects in localStorage (i486.projects.v1), new/rename/
delete, import .asm/.bin/.img, download .asm and .bin, assemble (Ctrl+Enter), run in
guest, run standalone COM, step into/over/out, breakpoints on editor lines and
disassembly rows, editable registers, memory dump with base/follow, live VGA screen,
console with assembler output/errors, status bar with byte/cycle counts, keyboard
capture toggle for the guest, F1 help.

## 14. Tests & acceptance

* node i486/test/run-all.cjs must print a summary and exit 0 with every suite green.
  Node 24, require-based, no test framework.
* Every module ships a suite. CPU >= 150 assertions covering encoding lengths, flags,
  addressing, prefixes, stack/interrupt behaviour, protected mode, paging, FPU.
  Assembler >= 150 assertions including a golden byte table from the Intel i486
  manual encodings. Disassembler round-trip for every operand form.
* No network, no sleeps over 50ms, whole suite under 30s.
* Report to the dispatcher: files written, test output (pass/fail counts), deviations
  from this contract, known gaps.

## 15. Style rules

* English identifiers and comments; page copy may be Chinese + English.
* 'use strict'; semicolons; no global leakage beyond I486.
* No minification, bundlers, polyfills, or externally fetched fonts.
* Public APIs exactly as in this document; extra private helpers are fine.
* If a requirement is impossible, state it explicitly in the report; never silently
  drop it.
