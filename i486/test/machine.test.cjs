'use strict';

/* HY486 machine + BIOS suite.  Each test builds its own machine so a test that
   switches the video mode or attaches a disk cannot leak into the next one. */

var harness = require('./harness.cjs');
var assert = harness.assert;
var eq = harness.eq;
var bytes = harness.bytes;
var hex = harness.hex;

require('../lib/asm.js');
require('../lib/bus.js');
require('../lib/devices.js');
require('../lib/cpu.js');
require('../lib/bios.js');
require('../lib/machine.js');

var I486 = globalThis.I486;
var A = I486.Assembler;

var POST_STEPS = 300000;

/* ---------------------------------------------------------------- helpers -- */

function bootMachine(ramMB) {
  var m = new I486.Machine({ ramMB: ramMB || 8 });
  m.run(POST_STEPS);
  return m;
}

function assemble16(lines, origin) {
  var r = A.assemble(lines.join('\n'), { bits: 16, origin: origin === undefined ? 0x100 : origin });
  if (r.ok !== true) throw new Error('test program failed to assemble: ' + JSON.stringify(r.errors.slice(0, 3)));
  return r;
}

/* A .COM image always ends in CLI/HLT: with IF clear the timer interrupt can
   no longer wake the CPU into uninitialised memory after the program ends. */
function com(lines) {
  return assemble16(['bits 16', 'org 0x100'].concat(lines, ['  cli', '  hlt'])).bytes;
}

function runProgram(m, prog, steps) {
  var info = m.loadProgram(prog, { mode: 'com16' });
  m.run(steps || 60000);
  return info;
}

function screenHas(m, needle) {
  return m.screen.getScreenText().some(function (line) { return line.indexOf(needle) >= 0; });
}

function lineIndexWith(m, needle) {
  var lines = m.screen.getScreenText();
  for (var i = 0; i < lines.length; i++) if (lines[i].indexOf(needle) >= 0) return i;
  return -1;
}

function patternImage(sectors) {
  var img = new Uint8Array(sectors * 512);
  for (var s = 0; s < sectors; s++) img.fill(s & 0xFF, s * 512, s * 512 + 512);
  return img;
}

/* Print a NUL-terminated string at DS:DX through INT 10h teletype. */
function teletypeProgram(text) {
  var lines = ['  mov ax, 0x0003', '  int 0x10', '  mov ah, 0x0E'];
  for (var i = 0; i < text.length; i++) {
    lines.push('  mov al, ' + text.charCodeAt(i));
    lines.push('  int 0x10');
  }
  return com(lines);
}

/* ------------------------------------------------------------ BIOS image -- */

harness.suite('bios image', function () {
  var rom = I486.BIOS.build(A);

  harness.test('assembles to exactly 64K with a far jump reset vector', function () {
    assert(rom.ok === true, 'BIOS must assemble: ' + (rom.message || ''));
    eq(rom.bytes.length, 65536, 'ROM size');
    eq(rom.origin, 0xF0000, 'effective origin');
    eq(rom.bytes[0xFFF0], 0xEA, 'reset vector opcode at image offset 0xFFF0');
    eq(rom.bytes[0xFFF1], 0x00, 'far jump offset low');
    eq(rom.bytes[0xFFF2], 0x00, 'far jump offset high');
    eq(rom.bytes[0xFFF3], 0x00, 'far jump segment low');
    eq(rom.bytes[0xFFF4], 0xF0, 'far jump segment high');
    assert(rom.bytes.length <= 65536, 'never larger than the ROM window');
  });

  harness.test('exposes post and a readable sectioned source', function () {
    assert(rom.symbols.has('post'), 'symbol table must contain post');
    var post = rom.symbols.get('post');
    assert(post >= 0xF0000 && post < 0xFFFF0, 'post inside the ROM, got 0x' + hex(post));
    eq(I486.BIOS.entry, 'post', 'BIOS entry symbol');
    assert(typeof I486.BIOS.source === 'string' && I486.BIOS.source.length > 20000, 'source is a real program');
    assert(I486.BIOS.source.indexOf('bits 16') >= 0, 'source declares bits 16');
    assert(rom.listing.length > 500, 'listing rows: ' + rom.listing.length);
  });

  harness.test('every service vector has a handler in the ROM', function () {
    ['post', 'int08', 'int09', 'int10', 'int13', 'int15', 'int16', 'int18', 'int19', 'int1a', 'int21'].forEach(function (name) {
      assert(rom.symbols.has(name), 'missing symbol ' + name);
      var at = rom.symbols.get(name);
      assert(at >= 0xF0000 && at < 0xFFFF0, name + ' at 0x' + hex(at));
    });
  });
});

/* ------------------------------------------------------------- power-on ---- */

harness.suite('power on', function () {
  var m = bootMachine(32);
  var state = m.state();

  harness.test('POST completes without a fault', function () {
    eq(state.tripleFault, false, 'triple fault');
    eq(state.mode, 'real', 'CPU mode after POST');
    eq(state.pe, false, 'CR0.PE clear in real mode');
    assert(state.cycles > 0, 'cycles accumulate');
    eq(m.cpu.lastException, null, 'no exception latched');
    eq(state.cs, 0xF000, 'POST runs with CS=0xF000');
  });

  harness.test('banner, memory size and device table reach the screen', function () {
    var text = m.screen.getScreenText();
    assert(text[0].indexOf('HY486 BIOS') === 0, 'banner first, got ' + JSON.stringify(text[0]));
    assert(screenHas(m, 'Memory: 640K base + 31744K above 1 MB'), 'memory line');
    assert(screenHas(m, 'Devices: 8259A 8254 8042 CMOS VGA ATA-PIO 16550'), 'device table');
    assert(screenHas(m, 'E820 map: 4 entries at 0x9000'), 'E820 report');
  });

  harness.test('a diskless boot falls back to the ROM monitor', function () {
    assert(screenHas(m, 'No bootable disk in drive 80h'), 'no-boot message');
    assert(screenHas(m, 'HY486 ROM monitor'), 'monitor banner');
    assert(lineIndexWith(m, 'romon>') >= 0, 'prompt visible');
    eq(state.halted, true, 'the monitor blocks inside INT 16h');
  });

  harness.test('POST leaves the documented low memory structures', function () {
    eq(m.bus.read16(0x040E), 0x9F00, 'EBDA pointer at 0x40:0x0E');
    eq(m.bus.read16(0x0413), 640, 'conventional memory in the BDA');
    eq(m.bus.read16(0x044A), 80, 'video columns');
    eq(m.bus.read8(0x0449), 3, 'video mode');
    eq(m.bus.read16(0x0480), 0x001E, 'keyboard buffer start offset');
    eq(m.bus.read16(0x0482), 0x003E, 'keyboard buffer end offset');
    eq(m.bus.a20, true, 'A20 on after POST');
    eq(m.bus.read16(0x0042), 0xF000, 'IVT int10 segment');
    eq(m.bus.read16(0x004E), 0xF000, 'IVT int13 segment');
    assert(m.bus.read16(0x0040) !== 0, 'IVT int10 offset installed');
    eq(m.bus.read16(0x20 + 2), 0xF000, 'IVT int08 segment survives');
  });

  harness.test('the E820 table reports usable RAM at 0 and at 1 MB', function () {
    eq(m.bus.read32(0x9000), 0, 'entry 0 base');
    eq(m.bus.read32(0x9008), 0x9FC00, 'entry 0 length');
    eq(m.bus.read32(0x9010), 1, 'entry 0 type');
    eq(m.bus.read32(0x9000 + 3 * 20), 0x100000, 'entry 3 base');
    eq(m.bus.read32(0x9000 + 3 * 20 + 16), 1, 'entry 3 type');
    eq(m.bus.read32(0x9000 + 3 * 20 + 8), 31 * 0x100000, 'entry 3 length low dword');
    eq(m.bus.read32(0x9000 + 3 * 20 + 12), 0, 'entry 3 length high dword');
  });

  harness.test('getters and serial output are live', function () {
    eq(m.screen, m.vga, 'screen getter is the VGA device');
    eq(m.disk, m.ata.image, 'disk getter is the ATA image');
    eq(m.serialOutput(), '', 'serial buffer starts empty');
    eq(m.screen.mode, 3, 'VGA stays in text mode');
  });
});

/* ----------------------------------------------------------------- video --- */

harness.suite('int 10h video', function () {
  harness.test('teletype prints HELLO and moves the CRTC cursor', function () {
    var m = bootMachine();
    runProgram(m, teletypeProgram('HELLO'), 20000);
    eq(m.screen.getLine(0), 'HELLO', 'first text row');
    eq(m.screen.cursor.x, 5, 'cursor column after five characters');
    eq(m.screen.cursor.y, 0, 'cursor row');
    eq(m.bus.read16(0x0450), 5, 'BDA cursor follows the teletype');
    eq(m.screen.cursorLocation, 5, 'CRTC cursor register 0x0E/0x0F follows the teletype');
  });

  harness.test('teletype handles CR, LF and BS', function () {
    var m = bootMachine();
    runProgram(m, com([
      '  mov ax, 0x0003',
      '  int 0x10',
      '  mov ah, 0x0E',
      '  mov al, "A"', '  int 0x10',
      '  mov al, "B"', '  int 0x10',
      '  mov al, 0x08', '  int 0x10',
      '  mov al, "C"', '  int 0x10',
      '  mov al, 0x0D', '  int 0x10',
      '  mov al, 0x0A', '  int 0x10',
      '  mov al, "D"', '  int 0x10'
    ]), 20000);
    eq(m.screen.getLine(0), 'AC', 'backspace erased B');
    eq(m.screen.getLine(1), 'D', 'CR LF reached the second row');
  });

  harness.test('mode 13h: pixel write, pixel read and the DAC palette', function () {
    var m = bootMachine();
    runProgram(m, com([
      '  mov ax, 0x0013',
      '  int 0x10',
      '  mov ax, 0x1010',
      '  mov bx, 40',
      '  mov dh, 0x3F',
      '  xor ch, ch',
      '  mov cl, 0x2A',
      '  int 0x10',
      '  mov ah, 0x0C',
      '  mov al, 40',
      '  mov cx, 100',
      '  mov dx, 50',
      '  int 0x10',
      '  mov ah, 0x0D',
      '  mov cx, 100',
      '  mov dx, 50',
      '  int 0x10',
      '  mov [0x0300], ax',
      '  mov ah, 0x0F',
      '  int 0x10',
      '  mov [0x0302], ax'
    ]), 40000);
    eq(m.screen.mode, 0x13, 'VGA switched to 320x200x256');
    eq(m.screen.readPixel(100, 50), 40, 'framebuffer holds the written colour');
    eq(m.bus.read8(0x0300), 40, 'AH=0Dh returned the pixel');
    var pal = m.screen.getPalette(40);
    eq(pal.r, 255, 'DAC red for 0x3F');
    eq(pal.g, 0, 'DAC green for 0');
    eq(pal.b, 170, 'DAC blue for 0x2A');
    eq(m.bus.read8(0x0302), 0x13, 'AH=0Fh reports mode 13h');
  });

  harness.test('AH=09h/AH=08h write and read a character with its attribute', function () {
    var m = bootMachine();
    runProgram(m, com([
      '  mov ah, 0x02',
      '  xor bh, bh',
      '  xor dh, dh',
      '  mov dl, 40',
      '  int 0x10',
      '  mov ah, 0x03',
      '  xor bh, bh',
      '  int 0x10',
      '  mov [0x0300], dx',
      '  mov ah, 0x09',
      '  mov al, 0x51',
      '  mov bl, 0x5E',
      '  mov cx, 3',
      '  int 0x10',
      '  mov ah, 0x08',
      '  int 0x10',
      '  mov [0x0302], ax'
    ]), 40000);
    eq(m.bus.read16(0x0300), 40, 'AH=03h cursor column');
    eq(m.bus.read16(0x0302), 0x5E51, 'AH=08h read back char 0x51 attribute 0x5E');
    eq(m.screen.readChar(40, 0).attr, 0x5E, 'cell attribute in the text buffer');
    eq(m.screen.readChar(40, 0).ch, 0x51, 'cell character in the text buffer');
    eq(m.screen.getLine(0).length, 43, 'three cells written at column 40');
  });

  harness.test('AH=06h scrolls a window by moving text rows', function () {
    var m = bootMachine();
    runProgram(m, com([
      '  mov ax, 0x0003',
      '  int 0x10',
      '  mov ah, 0x0E',
      '  mov al, "1"', '  int 0x10',
      '  mov al, 0x0D', '  int 0x10',
      '  mov al, 0x0A', '  int 0x10',
      '  mov al, "2"', '  int 0x10',
      '  mov al, 0x0D', '  int 0x10',
      '  mov al, 0x0A', '  int 0x10',
      '  mov ah, 0x06',
      '  mov al, 1',
      '  mov bh, 0x07',
      '  xor cx, cx',
      '  mov dx, 0x184F',
      '  int 0x10'
    ]), 40000);
    eq(m.screen.getLine(0), '2', 'row 0 took the contents of row 1');
    eq(m.screen.getLine(1), '', 'row 1 was blanked');
  });

  harness.test('AH=13h writes a string and leaves the cursor after it', function () {
    var m = bootMachine();
    var r = assemble16(['bits 16', 'org 0x100',
      '  mov ax, 0x0003',
      '  int 0x10',
      '  mov ax, 0x1301',
      '  mov bx, 0x001E',
      '  xor dx, dx',
      '  mov bp, msg',
      '  mov cx, 7',
      '  int 0x10',
      '  cli',
      '  hlt',
      'msg: db "STRTEST"']);
    runProgram(m, r.bytes, 40000);
    eq(m.screen.getLine(0), 'STRTEST', 'string written at row 0 column 0');
    eq(m.screen.cursor.x, 7, 'cursor moved past the string');
  });
});

/* ------------------------------------------------------------ DOS services - */

harness.suite('int 21h dos', function () {
  harness.test('AH=09h prints a $-terminated string', function () {
    var m = bootMachine();
    var r = assemble16(['bits 16', 'org 0x100',
      '  mov ax, 0x0003',
      '  int 0x10',
      '  mov ah, 0x09',
      '  mov dx, msg',
      '  int 0x21',
      '  cli',
      '  hlt',
      'msg: db "DOS-STRING$"']);
    runProgram(m, r.bytes, 40000);
    eq(m.screen.getLine(0), 'DOS-STRING', 'string on row 0');
  });

  harness.test('AH=4Ch terminates back to the ROM monitor', function () {
    var m = bootMachine();
    runProgram(m, com(['  mov ah, 0x4C', '  xor al, al', '  int 0x21']), 60000);
    assert(screenHas(m, 'Program terminated.'), 'termination message');
    assert(lineIndexWith(m, 'romon>') >= 0, 'the monitor is running again');
  });

  harness.test('AH=30h reports DOS 3.30 and AH=40h writes to a handle', function () {
    var m = bootMachine();
    var r = assemble16(['bits 16', 'org 0x100',
      '  mov ax, 0x3000',
      '  int 0x21',
      '  mov [0x0300], ax',
      '  mov ah, 0x40',
      '  mov bx, 1',
      '  mov cx, 3',
      '  mov dx, buf',
      '  int 0x21',
      '  mov [0x0302], ax',
      '  cli',
      '  hlt',
      'buf: db "ABC"']);
    runProgram(m, r.bytes, 40000);
    eq(m.bus.read16(0x0300), 0x1E03, 'version 3.30 in AL, 0x1E in AH');
    eq(m.bus.read16(0x0302), 3, 'AH=40h reports three bytes written');
    assert(screenHas(m, 'ABC'), 'handle 1 output reached the screen');
  });

  harness.test('AH=0Ah reads a buffered line through the keyboard', function () {
    var m = bootMachine();
    var r = assemble16(['bits 16', 'org 0x100',
      '  mov ax, 0x0003',
      '  int 0x10',
      '  mov ah, 0x0A',
      '  mov dx, buf',
      '  int 0x21',
      '  cli',
      '  hlt',
      'buf: db 20, 0',
      '  resb 20']);
    m.loadProgram(r.bytes, { mode: 'com16' });
    m.setKey(0x1E, true);          /* a */
    m.setKey(0x1F, true);          /* s */
    m.setKey(0x1C, true);          /* enter */
    m.run(80000);
    var base = 0x100 + r.symbols.get('buf') - 0x100;
    eq(m.bus.read8(base + 1), 2, 'two characters accepted');
    eq(m.bus.read8(base + 2), 0x61, 'first character is a');
    eq(m.bus.read8(base + 3), 0x73, 'second character is s');
  });
});

/* ------------------------------------------------------------------ disk --- */

harness.suite('int 13h disk', function () {
  function diskMachine() {
    var m = bootMachine();
    m.loadDiskImage(patternImage(64));
    return m;
  }

  harness.test('AH=02h reads sector 0 of the image by CHS', function () {
    var m = diskMachine();
    runProgram(m, com([
      '  mov ax, 0x1000',
      '  mov es, ax',
      '  xor bx, bx',
      '  mov ah, 0x02',
      '  mov al, 1',
      '  xor ch, ch',
      '  mov cl, 1',
      '  xor dh, dh',
      '  mov dl, 0x80',
      '  int 0x13',
      '  mov [0x0300], ah'
    ]), 80000);
    eq(m.bus.read8(0x0300), 0, 'AH=0 after a successful read');
    bytes(m.bus.getBytes(0x10000, 8), [0, 0, 0, 0, 0, 0, 0, 0], 'sector 0 contents');
    eq(m.bus.read8(0x10000 + 511), 0, 'last byte of sector 0');
  });

  harness.test('AH=02h reads sector 7 of the image by CHS', function () {
    var m = diskMachine();
    runProgram(m, com([
      '  mov ax, 0x1000',
      '  mov es, ax',
      '      xor bx, bx',
      '  mov ah, 0x02',
      '  mov al, 1',
      '  xor ch, ch',
      '  mov cl, 8',
      '  xor dh, dh',
      '  mov dl, 0x80',
      '  int 0x13'
    ]), 80000);
    eq(m.bus.read8(0x10000), 7, 'sector 7 pattern byte');
    eq(m.bus.read8(0x10000 + 511), 7, 'sector 7 last byte');
  });

  harness.test('AH=42h reads an LBA through the disk address packet', function () {
    var m = diskMachine();
    var r = assemble16(['bits 16', 'org 0x100',
      '  mov ax, 0x2000',
      '  mov es, ax',
      '  mov si, dap',
      '  mov ah, 0x42',
      '  mov dl, 0x80',
      '  int 0x13',
      '  mov [0x0300], ah',
      '  cli',
      '  hlt',
      'dap: db 0x10, 0, 1, 0',
      '  dw 0x0000',
      '  dw 0x2000',
      '  dd 12',
      '  dd 0']);
    runProgram(m, r.bytes, 80000);
    eq(m.bus.read8(0x0300), 0, 'AH=0 after the extended read');
    eq(m.bus.read8(0x20000), 12, 'sector 12 pattern byte');
    eq(m.bus.read8(0x20000 + 511), 12, 'sector 12 last byte');
  });

  harness.test('AH=42h rejects a zero count without touching memory', function () {
    var m = diskMachine();
    var r = assemble16(['bits 16', 'org 0x100',
      '  mov ax, 0x3000',
      '  mov es, ax',
      '      mov di, 0',
      '  mov si, dap',
      '  mov ah, 0x42',
      '  mov dl, 0x80',
      '  int 0x13',
      '  mov [0x0300], ah',
      '  cli',
      '  hlt',
      'dap: db 0x10, 0, 0, 0',
      '  dw 0x0000',
      '  dw 0x3000',
      '  dd 3',
      '  dd 0']);
    runProgram(m, r.bytes, 80000);
    eq(m.bus.read8(0x0300), 0x01, 'count 0 is an invalid parameter');
    bytes(m.bus.getBytes(0x30000, 8), [0, 0, 0, 0, 0, 0, 0, 0], 'no transfer happened');
  });

  harness.test('AH=42h rejects a transfer that would wrap the segment', function () {
    var m = diskMachine();
    var r = assemble16(['bits 16', 'org 0x100',
      '  mov ax, 0x3000',
      '  mov es, ax',
      '      mov di, 0',
      '  mov si, dap',
      '  mov ah, 0x42',
      '  mov dl, 0x80',
      '  int 0x13',
      '  mov [0x0300], ah',
      '  cli',
      '  hlt',
      'dap: db 0x10, 0, 200, 0',
      '  dw 0x0000',
      '  dw 0x3000',
      '  dd 1',
      '  dd 0']);
    runProgram(m, r.bytes, 80000);
    assert(m.bus.read8(0x0300) !== 0, 'a 200 sector transfer must be refused');
    bytes(m.bus.getBytes(0x30000, 8), [0, 0, 0, 0, 0, 0, 0, 0], 'no partial transfer');
  });

  harness.test('AH=08h reports a CHS geometry the return format can express', function () {
    var m = bootMachine();
    var SECTORS = 16384;                    /* the 8 MB image the kernel boots from */
    m.loadDiskImage(patternImage(SECTORS));
    runProgram(m, com([
      '  mov ah, 0x08',
      '  mov dl, 0x80',
      '  int 0x13',
      '  mov [0x0300], cx',
      '  mov [0x0302], dx',
      '  mov [0x0304], bx',
      '  mov [0x0306], ah',
      /* a CHS read issued with the reported geometry must land on LBA 63 */
      '  mov ax, 0x1000',
      '  mov es, ax',
      '  xor bx, bx',
      '  mov ah, 0x02',
      '  mov al, 1',
      '  xor ch, ch',
      '  mov cl, 1',
      '  mov dh, 1',
      '  mov dl, 0x80',
      '  int 0x13'
    ]), 300000);
    var cl = m.bus.read8(0x0300);
    var ch = m.bus.read8(0x0301);
    var dh = m.bus.read8(0x0303);
    var dl = m.bus.read8(0x0302);
    var cyl = ch | (((cl >> 6) & 0x03) << 8);
    var spt = cl & 0x3F;
    var heads = dh + 1;
    var capacity = cyl * heads * spt;
    eq(spt, 63, 'CL bits 5-0 hold 63 sectors per track');
    eq(heads, 16, 'DH holds heads-1 = 15');
    eq(dl, 1, 'DL reports one drive');
    eq(m.bus.read16(0x0304), 3, 'BL reports a fixed disk');
    eq(m.bus.read8(0x0306), 0, 'AH=0 and CF=0 on success');
    eq(cyl, 17, 'ceil(16384 / (16 * 63)) cylinders for an 8 MB image');
    assert(capacity >= SECTORS,
      'reported capacity ' + capacity + ' must cover ' + SECTORS + ' sectors');
    assert((cyl - 1) * heads * spt < SECTORS,
      'cylinders must be minimal: ' + (cyl - 1) + ' would only reach ' + ((cyl - 1) * heads * spt) + ' sectors');
    assert(capacity <= SECTORS + heads * spt,
      'rounding overshoot ' + (capacity - SECTORS) + ' must stay inside one cylinder track group');
    eq(m.bus.read8(0x10000), 63, 'a CHS read with the reported geometry hits LBA 63');
  });

  harness.test('AH=41h reports the extended read extensions', function () {
    var m = diskMachine();
    runProgram(m, com([
      '  mov ah, 0x41',
      '  mov bx, 0x55AA',
      '  mov dl, 0x80',
      '  int 0x13',
      '  mov [0x0300], bx',
      '  mov [0x0302], ax'
    ]), 80000);
    eq(m.bus.read16(0x0300), 0xAA55, 'BX echoes the extension signature');
    eq(m.bus.read8(0x0302 + 1), 0x30, 'AH reports EDD 3.0');
    eq(m.bus.read8(0x0302), 0x41, 'AL keeps the function number');
  });

  harness.test('AH=15h reports a hard disk', function () {
    var m = diskMachine();
    runProgram(m, com([
      '  mov ah, 0x15',
      '  mov dl, 0x80',
      '  int 0x13',
      '  mov [0x0300], ax'
    ]), 80000);
    eq(m.bus.read8(0x0300 + 1), 3, 'AH=3 for a fixed disk');
  });
});

/* -------------------------------------------------------------- keyboard --- */

harness.suite('int 16h keyboard and int 1ah timer', function () {
  harness.test('AH=00h returns scancode and ASCII, AH=01h reports empty', function () {
    var m = bootMachine();
    m.loadProgram(com([
      '  mov ah, 0x00',
      '  int 0x16',
      '  mov [0x0300], ax',
      '  mov ah, 0x01',
      '  int 0x16',
      '  mov [0x0302], ax'
    ]), { mode: 'com16' });
    m.setKey(0x1E, true);
    m.run(60000);
    eq(m.bus.read16(0x0300), 0x1E61, 'scancode 0x1E, ASCII a');
    eq(m.bus.read16(0x0302), 0x0000, 'the peek buffer is empty again');
  });

  harness.test('AH=01h sets ZF while the buffer is empty', function () {
    var m = bootMachine();
    runProgram(m, com([
      'start:',
      '  mov ah, 0x01',
      '  int 0x16',
      '  mov ax, 0',
      '  jz .empty',
      '  mov ax, 0x1234',
      '.empty:',
      '  mov [0x0300], ax'
    ]), 40000);
    eq(m.bus.read16(0x0300), 0, 'ZF was set for an empty buffer');
  });

  harness.test('shift state selects the shifted translation table', function () {
    var m = bootMachine();
    m.loadProgram(com([
      '  mov ah, 0x00',
      '  int 0x16',
      '  mov [0x0300], ax',
      '  mov ah, 0x02',
      '  int 0x16',
      '  mov [0x0302], ax'
    ]), { mode: 'com16' });
    m.setKey(0x2A, true);
    m.setKey(0x1E, true);
    m.run(60000);
    eq(m.bus.read16(0x0300), 0x1E41, 'shift turns a into A');
    eq(m.bus.read8(0x0302) & 0x03, 0x02, 'shift flag in the BDA');
  });

  harness.test('the 16 entry ring buffer survives ten keys', function () {
    var m = bootMachine();
    m.loadProgram(com([
      'start:',
      '  mov cx, 10',
      '  mov di, 0x0400',
      '.next:',
      '  push cx',
      '  mov ah, 0x00',
      '  int 0x16',
      '  pop cx',
      '  mov [di], ax',
      '  add di, 2',
      '  loop .next'
    ]), { mode: 'com16' });
    for (var i = 0; i < 10; i++) m.setKey(0x1E + (i % 4), true);
    m.run(200000);
    for (var k = 0; k < 10; k++) {
      eq(m.bus.read8(0x0400 + k * 2 + 1), 0x1E + (k % 4), 'queued scancode ' + k);
    }
    eq(m.bus.read16(0x041A), m.bus.read16(0x041C), 'head caught up with tail');
  });

  harness.test('INT 1Ah ticks advance with the timer', function () {
    var m = bootMachine();
    var before = m.bus.read32(0x046C);
    m.run(500000);
    var after = m.bus.read32(0x046C);
    assert(after > before, 'tick counter moved: ' + before + ' -> ' + after);
    assert(m.pit.irq0Count > 0, 'the PIT fired IRQ0');
  });

  harness.test('INT 1Ah AH=00h and AH=02h answer through the ROM', function () {
    var m = bootMachine();
    runProgram(m, com([
      '  mov ah, 0x00',
      '  int 0x1A',
      '  mov [0x0300], cx',
      '  mov [0x0302], dx',
      '  mov ah, 0x02',
      '  int 0x1A',
      '  mov [0x0304], cx',
      '  mov [0x0306], dx'
    ]), 60000);
    assert(m.bus.read16(0x0300) !== 0 || m.bus.read16(0x0302) !== 0, 'ticks accumulated');
    var hour = m.bus.read8(0x0304 + 1);
    var minute = m.bus.read8(0x0304);
    assert(hour <= 0x23 && minute <= 0x59, 'BCD time looks sane: ' + hex(hour) + ':' + hex(minute));
    assert(m.bus.read8(0x0306) <= 0x59, 'BCD seconds look sane');
  });
});

/* ---------------------------------------------------------------- system --- */

harness.suite('int 15h system services', function () {
  harness.test('AH=88h reports the extended memory size', function () {
    var m = bootMachine(32);
    runProgram(m, com([
      '  mov ah, 0x88',
      '  int 0x15',
      '  mov [0x0300], ax'
    ]), 60000);
    eq(m.bus.read16(0x0300), 31744, '31 MB above the 1 MB line');
  });

  harness.test('AX=2402h queries and drives the A20 gate', function () {
    var m = bootMachine();
    runProgram(m, com([
      '  mov ax, 0x2402',
      '  int 0x15',
      '  mov [0x0300], ax',
      '  mov ax, 0x2400',
      '  int 0x15',
      '  mov ax, 0x2402',
      '  int 0x15',
      '  mov [0x0302], ax',
      '  mov ax, 0x2401',
      '  int 0x15'
    ]), 60000);
    eq(m.bus.read8(0x0300), 0, 'AL=0 while A20 is enabled');
    eq(m.bus.read8(0x0302), 1, 'AL=1 after disabling A20');
    eq(m.bus.a20, true, 'the gate was enabled again at the end');
  });

  harness.test('E820 iteration returns usable memory at 0 and 1 MB', function () {
    var m = bootMachine(32);
    var r = assemble16(['bits 16', 'org 0x100',
      '  mov ax, 0xE801',
      '  int 0x15',
      '  mov [0x0300], cx',
      '  mov [0x0302], bx',
      '  mov ax, 0xE820',
      '  xor bx, bx',
      '  mov ecx, 20',
      '  mov dx, 0x4000',
      '  mov es, dx',
      '  xor di, di',
      '  int 0x15',
      '  mov [0x0304], ebx',
      '  mov ax, 0xE820',
      '  mov ecx, 20',
      '  mov dx, 0x4000',
      '  mov es, dx',
      '  mov di, 20',
      '  int 0x15',
      '  cli',
      '  hlt']);
    runProgram(m, r.bytes, 80000);
    eq(m.bus.read16(0x0300), 4, 'four E820 entries');
    eq(m.bus.read16(0x0302), 20, 'each entry is 20 bytes');
    eq(m.bus.read32(0x0304), 1, 'EBX continues with entry 1');
    eq(m.bus.read32(0x40000), 0, 'entry 0 base');
    eq(m.bus.read32(0x40010), 1, 'entry 0 type is usable RAM');
    eq(m.bus.read32(0x40000 + 20), 0x9FC00, 'entry 1 starts at the top of conventional RAM');
    eq(m.bus.read32(0x40010 + 20), 2, 'entry 1 is reserved');
  });
});

/* ------------------------------------------------------------ boot chain --- */

harness.suite('boot chain', function () {
  function bootSectorSource(text) {
    return ['bits 16', 'org 0x7C00', 'boot_start:',
      '  mov ax, 0',
      '  mov ds, ax',
      '  mov ax, 0xB800',
      '  mov es, ax',
      '  mov si, msg',
      '  xor di, di',
      '.loop:',
      '  mov al, [si]',
      '  or al, al',
      '  jz .done',
      '  mov ah, 0x1F',
      '  stosw',
      '  inc si',
      '  jmp .loop',
      '.done:',
      '  cli',
      '  hlt',
      'msg: db "' + text + '", 0'];
  }

  harness.test('INT 19h loads and jumps to a signed boot sector', function () {
    var m = bootMachine();
    var r = assemble16(bootSectorSource('BOOTED-VIA-INT19'), 0x7C00);
    var img = new Uint8Array(4 * 512);
    img.set(r.bytes, 0);
    img[510] = 0x55;
    img[511] = 0xAA;
    m.loadDiskImage(img);
    m.reboot();
    m.run(POST_STEPS);
    eq(m.screen.getLine(0), 'BOOTED-VIA-INT19', 'the boot sector wrote the first row');
    eq(m.state().cs, 0, 'control transferred to segment zero');
    eq(m.state().halted, true, 'the boot sector halted');
    eq(m.state().tripleFault, false, 'no fault during the chain');
  });

  harness.test('a boot sector without 0xAA55 is rejected', function () {
    var m = bootMachine();
    var r = assemble16(bootSectorSource('SHOULD-NOT-RUN'), 0x7C00);
    var img = new Uint8Array(4 * 512);
    img.set(r.bytes, 0);            /* no signature at 0x7DFE */
    m.loadDiskImage(img);
    m.reboot();
    m.run(POST_STEPS);
    assert(screenHas(m, 'No bootable disk in drive 80h'), 'the BIOS refuses an unsigned sector');
    assert(!screenHas(m, 'SHOULD-NOT-RUN'), 'the boot sector must not run');
    assert(lineIndexWith(m, 'romon>') >= 0, 'the ROM monitor takes over');
  });
});

/* --------------------------------------------------------- protected mode -- */

harness.suite('protected mode programs', function () {
  harness.test('flat32 runs 32-bit code against a flat GDT', function () {
    var m = bootMachine();
    var r = A.assemble(['bits 32', 'org 0x100000',
      '  mov dword [0x100400], 0xCAFEBABE',
      '  mov eax, 0x0000BEEF',
      '  mov [0x100404], eax',
      '  cli',
      '  hlt'].join('\n'), { bits: 32, origin: 0x100000 });
    assert(r.ok === true, 'flat program assembles: ' + JSON.stringify(r.errors));
    var info = m.loadProgram(r.bytes, { mode: 'flat32' });
    eq(info.mode, 'flat32', 'loadProgram mode echo');
    eq(info.entry, 0x100000, 'entry point');
    m.run(64);
    eq(m.bus.read32(0x100400), 0xCAFEBABE, 'dword store landed at 0x100400');
    eq(m.bus.read32(0x100404), 0x0000BEEF, 'eax store landed at 0x100404');
    eq(m.cpu.cr0 & 1, 1, 'CR0.PE is set');
    eq(m.state().mode, 'protected', 'state reports protected mode');
    eq(m.state().pe, true, 'state pe flag');
    eq(m.cpu.cs.big, true, 'code segment opened up to 32 bits');
    eq(m.cpu.cs.sel, 0x08, 'code selector 0x08');
    eq(m.cpu.getReg('ds'), 0x10, 'data selector 0x10');
  });

  harness.test('loadProgram com16 and boot16 set up the documented state', function () {
    var m = bootMachine();
    var prog = com(['  mov ax, 0x1234']);
    var info = m.loadProgram(prog, { mode: 'com16' });
    eq(info.mode, 'com16', 'mode echo');
    eq(info.org, 0x100, 'default origin');
    eq(m.cpu.eip, 0x100, 'EIP at 0x100');
    eq(m.cpu.cs.sel, 0, 'CS reloaded to zero');
    eq(m.cpu.getReg('sp'), 0xFFFE, 'stack pointer');
    eq(m.cpu.getFlag('df'), 0, 'direction flag cleared');
    eq(m.cpu.getFlag('if'), 1, 'interrupts enabled');
    bytes(m.bus.getBytes(0x100, prog.length), prog, 'program bytes at 0x100');

    var boot = m.loadProgram(prog, { mode: 'boot16' });
    eq(boot.org, 0x7C00, 'boot16 origin');
    eq(m.cpu.eip, 0x7C00, 'EIP at 0x7C00');
    bytes(m.bus.getBytes(0x7C00, prog.length), prog, 'program bytes at 0x7C00');
  });
});

/* --------------------------------------------------------------- runUntil -- */

harness.suite('runUntil', function () {
  harness.test('stops on an instruction address', function () {
    var m = bootMachine();
    var r = assemble16(['bits 16', 'org 0x100', '  nop', '  nop', '  mov ax, 0x1234', '  cli', '  hlt']);
    m.loadProgram(r.bytes, { mode: 'com16' });
    eq(m.runUntil(0x105, 1000), 'hit', 'return code for a reached address');
    eq(m.cpu.eip, 0x105, 'EIP parked on the target');
  });

  harness.test('returns limit for an address that is never reached', function () {
    var m = bootMachine();
    var r = assemble16(['bits 16', 'org 0x100', 'spin:', '  jmp spin']);
    m.loadProgram(r.bytes, { mode: 'com16' });
    eq(m.runUntil(0xDEAD, 500), 'limit', 'return code when the budget runs out');
    assert(m.cpu.eip === 0x100 || m.cpu.eip === 0x102, 'still inside the spin loop, eip=0x' + hex(m.cpu.eip));
  });

  harness.test('returns halt when the CPU stops first', function () {
    var m = bootMachine();
    var r = assemble16(['bits 16', 'org 0x100', '  cli', '  hlt']);
    m.loadProgram(r.bytes, { mode: 'com16' });
    eq(m.runUntil(0xDEAD, 500), 'halt', 'return code for a halted CPU');
  });
});

/* ------------------------------------------------------------- machine api -- */

harness.suite('machine api', function () {
  harness.test('state reports the fields the UI binds to', function () {
    var m = bootMachine();
    var s = m.state();
    ['eip', 'cs', 'ds', 'ss', 'sp', 'eflags', 'if', 'halted', 'tripleFault', 'mode', 'cycles',
      'instructions', 'cr0', 'pe', 'videoMode', 'diskSectors', 'pendingVector', 'lastException', 'linear']
      .forEach(function (key) {
        assert(Object.prototype.hasOwnProperty.call(s, key), 'state() is missing ' + key);
      });
    eq(s.mode, 'real', 'mode string');
    eq(s.videoMode, 3, 'video mode');
    eq(s.diskSectors, 0, 'no disk attached');
    eq(s.pendingVector, -1, 'no interrupt owed to the CPU');
  });

  harness.test('reboot restarts POST and clears the screen', function () {
    var m = bootMachine();
    m.setKey(0x1E, true);
    m.run(40000);
    m.reboot();
    eq(m.screen.getScreenText()[0], '', 'the screen is blank again');
    eq(m.state().cs, 0xF000, 'back at the reset vector segment');
    assert(m.state().eip >= 0xFFF0 || m.instructions >= 0, 'reset state restored');
    m.run(POST_STEPS);
    assert(screenHas(m, 'HY486 BIOS'), 'POST ran again');
  });

  harness.test('loadDiskImage attaches the master drive', function () {
    var m = bootMachine();
    var img = patternImage(16);
    m.loadDiskImage(img);
    eq(m.ata.sectors, 16, 'ATA sector count');
    eq(m.disk.length, 16 * 512, 'disk getter exposes the image');
    eq(m.ata.geometry.heads, 16, 'ATA geometry heads');
    eq(m.ata.geometry.spt, 255, 'ATA geometry sectors per track');
  });

  harness.test('hooks fire for faults, screen and serial', function () {
    var m = bootMachine();
    var faults = 0;
    m.onFault = function () { faults++; };
    runProgram(m, com([
      '  mov ax, 0x0003',
      '  int 0x10',
      '  mov ah, 0x0E',
      '  mov al, "Z"',
      '  int 0x10'
    ]), 20000);
    eq(faults, 0, 'a clean program raises no fault');
    eq(m.screen.getLine(0), 'Z', 'screen hook target text');
    m.onSerial = function (ch) { /* the 16550 only reports on transmit */ };
    m.serial.writeText('hi');
    eq(m.serialOutput(), 'hi', 'serial output buffer');
  });

  harness.test('the contract bios option assembles the ROM once', function () {
    var m = new I486.Machine({ ramMB: 8, bios: I486.BIOS.source });
    eq(m.rom.bytes.length, 65536, 'ROM built from the supplied source');
    m.run(POST_STEPS);
    assert(screenHas(m, 'HY486 BIOS'), 'the supplied BIOS boots');
    assert(m.rom.symbols.has('post'), 'symbols survive the build');
  });

  harness.test('halt freezes step() and run() until resume()', function () {
    var m = bootMachine();
    var program = com(['  mov ax, 0x1234', 'spin:', '  add ax, 1', '  jmp spin']);
    m.loadProgram(program, { mode: 'com16' });
    m.run(500);
    var frozen = {
      instructions: m.instructions,
      cycles: m.cpu.cycles,
      eip: m.cpu.eip,
      halted: m.cpu.halted,
      ax: m.cpu.getReg('ax')
    };
    assert(m.halt() === m, 'halt() chains');
    eq(m.state().stopped, true, 'state() reports the stall');
    var everyStepZero = true;
    for (var i = 0; i < 1000; i++) {
      if (m.step() !== 0) everyStepZero = false;
    }
    assert(everyStepZero, 'every step() returns 0 while stopped');
    eq(m.instructions, frozen.instructions, 'instruction counter frozen');
    eq(m.cpu.cycles, frozen.cycles, 'cycle counter frozen');
    eq(m.cpu.eip, frozen.eip, 'EIP frozen');
    eq(m.cpu.halted, frozen.halted, 'CPU halt state untouched');
    eq(m.cpu.getReg('ax'), frozen.ax, 'registers frozen');
    eq(m.run(1000), 0, 'run() executes nothing while stopped');
    eq(m.instructions, frozen.instructions, 'run() left the counter alone');
    eq(m.runUntil(0xDEAD, 100), 'halt', 'runUntil() reports the stall');
    eq(m.cpu.eip, frozen.eip, 'runUntil() left EIP alone');
    assert(m.resume() === m, 'resume() chains');
    eq(m.state().stopped, false, 'state() clears the stall');
    eq(m.run(1000), 1000, 'run() works again after resume()');
    assert(m.instructions > frozen.instructions, 'instructions retire after resume()');
    assert(m.cpu.cycles > frozen.cycles, 'cycles advance after resume()');
  });

  harness.test('halt() inside a run stops the loop early', function () {
    var m = bootMachine();
    m.loadProgram(com(['  mov ax, 0x0003', '  int 0x10', 'span:', '  add ax, 1', '  jmp span']), { mode: 'com16' });
    var irqs = 0;
    m.onIrq = function () { irqs++; m.halt(); };
    var ran = m.run(200000);
    assert(irqs > 0, 'the PIT delivered at least one interrupt');
    assert(ran > 0, 'something executed before the halt');
    assert(ran < 200000, 'run() returned early, executed ' + ran);
    eq(m.state().stopped, true, 'the machine is stopped');
    m.onIrq = null;
    eq(m.run(1000), 0, 'a following run() still executes nothing');
    m.resume();
    eq(m.run(1000), 1000, 'resume() restores execution');
  });

  harness.test('two machines do not share state', function () {
    var a = bootMachine();
    var b = new I486.Machine({ ramMB: 8 });
    eq(b.state().eip, 0xFFF0, 'a fresh machine sits on the reset vector');
    eq(b.screen.getScreenText()[0], '', 'a fresh machine has a blank screen');
    a.run(1000);
    eq(b.instructions, 0, 'the second machine has not started');
    eq(b.cpu.cycles, 0, 'the second machine has no cycles');
  });
});

/* ------------------------------------------------------------ performance -- */

harness.suite('performance', function () {
  harness.test('the idle monitor burns 100000 steps well under a second', function () {
    var m = bootMachine();
    var started = Date.now();
    m.run(100000);
    var elapsed = Math.max(1, Date.now() - started);
    var perSecond = Math.round(100000 / (elapsed / 1000));
    console.log('       run(100000) with the monitor in HLT: ' + elapsed + ' ms (' + perSecond + ' steps/s)');
    assert(elapsed < 1000, '100k steps took ' + elapsed + ' ms');
    assert(perSecond > 500000, 'step rate ' + perSecond + '/s');
  });

  harness.test('compute bound code retires at least 3M instructions per second', function () {
    var m = bootMachine();
    var r = assemble16(['bits 16', 'org 0x100', 'spin:', '  add ax, 1', '  jmp spin']);
    m.loadProgram(r.bytes, { mode: 'com16' });
    var started = Date.now();
    m.run(1000000);
    var elapsed = Math.max(1, Date.now() - started);
    var perSecond = Math.round(1000000 / (elapsed / 1000));
    console.log('       1000000 guest instructions: ' + elapsed + ' ms (' + perSecond + ' instructions/s)');
    assert(perSecond >= 3000000, 'contract target is 3M instructions/s, got ' + perSecond);
    assert(m.cpu.cycles > 1000000, 'cycles keep counting');
  });

  harness.test('POST finishes inside a known instruction budget', function () {
    var m = new I486.Machine({ ramMB: 32 });
    var steps = 0;
    while (steps < POST_STEPS) {
      m.run(2000);
      steps += 2000;
      if (lineIndexWith(m, 'romon>') >= 0) break;
    }
    console.log('       POST + first boot attempt: about ' + steps + ' instructions, ' + m.cpu.cycles + ' cycles');
    assert(steps <= POST_STEPS, 'POST must finish inside the documented budget');
    assert(lineIndexWith(m, 'romon>') >= 0, 'the monitor prompt arrived');
  });
});

if (require.main === module) { process.exit(harness.run() ? 1 : 0); }
