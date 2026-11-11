'use strict';

/*
 * Tests for I486.Disk (HYFS) and I486.Guest (boot sector + HY486 kernel).
 *
 * The guest suites boot the produced image on the accepted CPU, bus and devices
 * with the small stand-in BIOS in this file, so the boot loader, console, filesystem
 * commands and the .COM runner are executed for real instead of only assembled.
 * The stand-in BIOS is test scaffolding, not part of the product.
 */

var fs = require('fs');
var path = require('path');
var harness = require('./harness.cjs');

require('../lib/asm.js');
require('../lib/disasm.js');
require('../lib/cpu.js');
require('../lib/bus.js');
require('../lib/devices.js');
require('../lib/disk.js');
require('../lib/guest.js');

var I486 = globalThis.I486;
var Disk = I486.Disk;
var Guest = I486.Guest;
var Assembler = I486.Assembler;
var Disassembler = I486.Disassembler;

var suite = harness.suite;
var test = harness.test;
var assert = harness.assert;
var eq = harness.eq;
var neq = harness.neq;
var throws = harness.throws;

var KERNEL_DEFINES = {
  FS_DIR_START: Disk.DIR_SECTOR,
  FS_DIR_SECTORS: Disk.DIR_SECTORS,
  FS_CLUSTER_SECTORS: Disk.CLUSTER_SECTORS,
  FS_SUPER_SECTOR: Disk.SUPER_SECTOR
};

function fill(len, value) {
  var out = new Uint8Array(len), i;
  for (i = 0; i < len; i++) out[i] = (value + i * 7) & 0xFF;
  return out;
}

function ascii(text) {
  var out = new Uint8Array(text.length), i;
  for (i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xFF;
  return out;
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if ((a[i] & 0xFF) !== (b[i] & 0xFF)) return false;
  return true;
}

function findPattern(haystack, pattern) {
  var i, j;
  for (i = 0; i + pattern.length <= haystack.length; i++) {
    for (j = 0; j < pattern.length; j++) if (haystack[i + j] !== pattern[j]) break;
    if (j === pattern.length) return i;
  }
  return -1;
}

var HELLO_COM = [
  '; HELLO.COM: prints through the guest INT 21h AH=09h service',
  'bits 16',
  'org 0x100',
  '    mov dx, hello_text',
  '    mov ah, 0x09',
  '    int 0x21',
  '    mov ax, 0x4C00',
  '    int 0x21',
  'hello_text:',
  '    db "HELLO FROM DISK", 13, 10, "$", 0'
].join('\n');

/* --------------------------------------------------------------- HYFS disk -- */

suite('disk: format', function () {
  test('creates an image of the requested size', function () {
    var img = Disk.format({ sectors: 1024 });
    eq(img.length, 1024 * 512, 'image bytes');
    eq(img.length % Disk.SECTOR_SIZE, 0, 'whole sectors');
    eq(Disk.superblock(img).totalSectors, 1024, 'superblock sector count');
  });

  test('superblock fields follow the contract layout', function () {
    var img = Disk.format({ sectors: 512, bootKernel: 'HY486.SYS' });
    var sb = Disk.superblock(img);
    eq(sb.magic, 'HYFS', 'magic');
    eq(sb.version, 1, 'version');
    eq(sb.sectorSize, 512, 'sector size');
    eq(sb.clusterSectors, 4, 'cluster is four sectors');
    eq(sb.dirStart, 2, 'directory starts at sector 2');
    eq(sb.dirSectors, 8, 'directory sectors');
    eq(sb.dataStart, 12, 'data starts at sector 12');
    eq(sb.bootKernel, 'HY486.SYS', 'boot kernel name');
    eq(img[512 + 0], 0x48, 'H at 0x200');
    eq(img[512 + 3], 0x53, 'S at 0x203');
  });

  test('directory entries are 32 bytes and files land in contiguous clusters', function () {
    var img = Disk.format({
      sectors: 512,
      files: [{ name: 'A.BIN', data: fill(100, 1) }, { name: 'B.BIN', data: fill(3000, 2) }]
    });
    var all = Disk.entries(img);
    eq(all.length, 2, 'two entries');
    eq(all[0].name, 'A.BIN', 'first name');
    eq(all[1].name, 'B.BIN', 'second name');
    eq(all[0].offset, 2 * 512, 'first entry starts at sector 2');
    eq(all[1].offset, 2 * 512 + 32, 'entries are 32 bytes apart');
    eq(all[0].size, 100, 'first size');
    eq(all[1].size, 3000, 'second size');
    eq(all[0].firstCluster, Disk.FIRST_CLUSTER, 'first cluster is 3');
    eq(all[1].firstCluster, Disk.FIRST_CLUSTER + 1, 'second file follows the first');
    eq(Disk.check(img).ok, true, 'image is consistent: ' + JSON.stringify(Disk.check(img).errors));
  });

  test('list reports names, sizes and attributes', function () {
    var img = Disk.format({ sectors: 256, files: [{ name: 'README.TXT', data: ascii('hi'), attr: 0x20 }] });
    var list = Disk.list(img);
    eq(list.length, 1, 'one file');
    eq(list[0].name, 'README.TXT', 'name');
    eq(list[0].size, 2, 'size');
    eq(list[0].attr, 0x20, 'attr');
  });

  test('rejects impossible geometries', function () {
    throws(function () { Disk.format({ sectors: 8 }); }, 'too few sectors must throw');
    throws(function () { Disk.format({ sectors: 0x10000 }); }, 'more than 65535 sectors must throw');
    throws(function () { Disk.format({ sectors: 64, files: [{ name: 'BADNAME.TOOLONG', data: fill(10, 0) }] }); },
      'a name that does not fit 12 bytes must throw');
    throws(function () {
      Disk.format({ sectors: 64, files: [{ name: 'A.BIN', data: fill(10, 0) }, { name: 'A.BIN', data: fill(10, 0) }] });
    }, 'duplicate names must throw');
  });

  test('format zeroes sector 0 and leaves it for the boot loader', function () {
    var img = Disk.format({ sectors: 64 });
    var zero = true, i;
    for (i = 0; i < 512; i++) if (img[i] !== 0) zero = false;
    eq(zero, true, 'boot sector area is zeroed');
  });
});

suite('disk: files', function () {
  test('readFile round-trips bytes exactly', function () {
    var data = fill(700, 3);
    var img = Disk.format({ sectors: 512, files: [{ name: 'DATA.BIN', data: data }] });
    var back = Disk.readFile(img, 'DATA.BIN');
    eq(back.length, 700, 'length');
    eq(sameBytes(back, data), true, 'bytes');
  });

  test('lookup is case-insensitive and misses return null', function () {
    var img = Disk.format({ sectors: 256, files: [{ name: 'LOWER.TXT', data: ascii('abc') }] });
    eq(Disk.readFile(img, 'lower.txt') !== null, true, 'lower-case lookup finds the file');
    eq(Disk.readFile(img, 'LOWER.TXT').length, 3, 'exact lookup');
    eq(Disk.readFile(img, 'MISSING.TXT'), null, 'missing file is null');
    eq(Disk.readFile(img, ''), null, 'empty name is null');
  });

  test('a 5000-byte file survives a round trip', function () {
    var data = fill(5000, 9);
    var img = Disk.format({ sectors: 1024 });
    eq(Disk.writeFile(img, 'BIG.DAT', data), true, 'writeFile accepted the file');
    var back = Disk.readFile(img, 'BIG.DAT');
    eq(back.length, 5000, 'length');
    eq(sameBytes(back, data), true, 'bytes');
    eq(Disk.list(img)[0].size, 5000, 'directory size');
    eq(Disk.check(img).ok, true, 'still consistent');
  });

  test('writeFile updates an existing entry and its data', function () {
    var img = Disk.format({ sectors: 512, files: [{ name: 'EDIT.TXT', data: ascii('first') }] });
    eq(Disk.writeFile(img, 'edit.txt', ascii('second version')), true, 'overwrite accepted');
    eq(Disk.list(img).length, 1, 'still one file');
    eq(Disk.list(img)[0].size, 14, 'new size in the directory');
    eq(sameBytes(Disk.readFile(img, 'EDIT.TXT'), ascii('second version')), true, 'new bytes');
    eq(Disk.check(img).ok, true, 'consistent after the overwrite');
  });

  test('writeFile rejects bad names and data that does not fit', function () {
    var img = Disk.format({ sectors: 64 });
    eq(Disk.writeFile(img, 'ok.txt', ascii('x')), true, 'small file fits');
    eq(Disk.writeFile(img, 'WAY-TOO-LONG-NAME.TXT', ascii('x')), false, 'long name rejected');
    eq(Disk.writeFile(img, 'HUGE.BIN', fill(200000, 1)), false, 'oversized file rejected');
    eq(Disk.list(img).length, 1, 'directory was not corrupted');
  });

  test('deleteFile clears the directory entry', function () {
    var img = Disk.format({ sectors: 256, files: [{ name: 'GONE.TXT', data: ascii('bye') }] });
    var entry = Disk.entries(img)[0];
    eq(Disk.deleteFile(img, 'gone.txt'), true, 'delete by lower-case name');
    eq(Disk.list(img).length, 0, 'entry removed');
    eq(img[entry.offset], 0, 'first name byte is zero');
    eq(Disk.readFile(img, 'GONE.TXT'), null, 'reads back as missing');
    eq(Disk.superblock(img).fileCount, 0, 'superblock file count');
    eq(Disk.deleteFile(img, 'GONE.TXT'), false, 'deleting twice reports false');
    eq(Disk.check(img).ok, true, 'consistent after the delete');
  });

  test('two files written in sequence never overlap', function () {
    var a = fill(120, 1), b = fill(3000, 2);
    var img = Disk.format({ sectors: 512, files: [{ name: 'ONE.BIN', data: a }] });
    eq(Disk.writeFile(img, 'TWO.BIN', b), true, 'second write');
    var all = Disk.entries(img);
    eq(all.length, 2, 'two entries');
    eq(all[1].firstCluster >= all[0].firstCluster + 1, true, 'second starts after the first cluster');
    eq(all[1].firstCluster * Disk.CLUSTER_SIZE >= all[0].size, true, 'cluster offsets do not overlap');
    eq(sameBytes(Disk.readFile(img, 'ONE.BIN'), a), true, 'first file intact');
    eq(sameBytes(Disk.readFile(img, 'TWO.BIN'), b), true, 'second file intact');
    eq(Disk.check(img).ok, true, 'no overlap reported');
  });

  test('empty files take no cluster', function () {
    var img = Disk.format({ sectors: 128, files: [{ name: 'EMPTY.TXT', data: new Uint8Array(0) }] });
    eq(Disk.list(img)[0].size, 0, 'zero size');
    eq(Disk.entries(img)[0].firstCluster, 0, 'no first cluster');
    eq(Disk.readFile(img, 'EMPTY.TXT').length, 0, 'reads back empty');
    eq(Disk.check(img).ok, true, 'consistent');
  });

  test('mount is a live view of the image', function () {
    var img = Disk.format({ sectors: 256, files: [{ name: 'SEED.TXT', data: ascii('seed') }] });
    var view = Disk.mount(img);
    eq(view.files.length, 1, 'sees the seeded file');
    eq(sameBytes(view.readFile('SEED.TXT'), ascii('seed')), true, 'reads through the view');
    eq(view.writeFile('ADDED.TXT', ascii('added')), true, 'writes through the view');
    eq(view.files.length, 2, 'files list refreshed');
    eq(view.list().length, 2, 'list() matches');
    eq(view.deleteFile('SEED.TXT'), true, 'delete through the view');
    eq(view.files.length, 1, 'files list refreshed again');
    eq(view.files[0].name, 'ADDED.TXT', 'remaining name');
    eq(Disk.list(img).length, 1, 'image itself changed');
  });

  test('check rejects a broken superblock', function () {
    var img = Disk.format({ sectors: 128 });
    img[512] = 0;
    var report = Disk.check(img);
    eq(report.ok, false, 'broken magic is reported');
    eq(report.errors.length > 0, true, 'with at least one error');
    throws(function () { Disk.list(img); }, 'listing a non-HYFS image throws');
  });
});

/* ------------------------------------------------------------- guest build -- */

suite('guest: build', function () {
  var built = null;
  function once() {
    if (!built) {
      built = Guest.build({
        assembler: Assembler,
        sectors: 2048,
        files: [{ name: 'HELLO.COM', data: Assembler.assemble(HELLO_COM, { bits: 16, origin: 0x100 }).bytes }]
      });
    }
    return built;
  }

  test('assembles both stages without errors', function () {
    var b = once();
    assert(b.image && b.image.length, 'image produced');
    eq(b.kernel.length > 0, true, 'kernel bytes');
    eq(b.image.length, 2048 * 512, 'image sized to the requested sectors');
  });

  test('boot sector is 512 bytes and ends with 55 AA', function () {
    var b = once();
    eq(b.bootSector.length, 512, 'boot sector length');
    eq(b.bootSector[510], 0x55, 'signature low byte');
    eq(b.bootSector[511], 0xAA, 'signature high byte');
    eq(sameBytes(b.image.subarray(0, 512), b.bootSector), true, 'sector 0 of the image holds the boot sector');
  });

  test('boot sector enables A20, uses INT 13h AH=42 and far jumps to 0x8000', function () {
    var boot = once().bootSector;
    eq(findPattern(boot, [0xE4, 0x92]) >= 0, true, 'in al, 0x92');
    eq(findPattern(boot, [0xE6, 0x92]) >= 0, true, 'out 0x92, al');
    eq(findPattern(boot, [0xB4, 0x42]) >= 0, true, 'mov ah, 0x42');
    eq(findPattern(boot, [0xCD, 0x13]) >= 0, true, 'int 0x13');
    eq(findPattern(boot, [0xEA, 0x00, 0x80, 0x00, 0x00]) >= 0, true, 'jmp 0x0000:0x8000');
  });

  test('kernel fits the segment and the contract limit', function () {
    var b = once();
    eq(b.kernel.length <= 48 * 1024, true, 'kernel within the 48 KB contract ceiling');
    eq(b.kernel.length <= Guest.KERNEL_LIMIT, true, 'kernel within the 32 KB real-mode segment window');
    eq(b.kernelSize, b.kernel.length, 'reported size');
  });

  test('image carries the superblock and the kernel clusters', function () {
    var b = once();
    var sb = Disk.superblock(b.image);
    eq(sb.magic, 'HYFS', 'superblock magic');
    eq(sb.bootKernel, 'HY486.SYS', 'boot kernel recorded in the superblock');
    eq(sb.fileCount, 2, 'kernel plus HELLO.COM');
    var stored = Disk.readFile(b.image, 'HY486.SYS');
    eq(sameBytes(stored, b.kernel), true, 'kernel file matches the assembled bytes');
    eq(b.kernelLba, Disk.FIRST_CLUSTER * Disk.CLUSTER_SECTORS, 'kernel sits at the first data cluster');
    eq(sameBytes(b.image.subarray(b.kernelLba * 512, b.kernelLba * 512 + b.kernel.length), b.kernel), true,
      'kernel bytes at the boot LBA');
    eq(Disk.check(b.image).ok, true, 'image is consistent');
  });

  test('extra files are placed on the image', function () {
    var b = once();
    var names = b.files.map(function (f) { return f.name; });
    eq(names.indexOf('HELLO.COM') >= 0, true, 'HELLO.COM listed');
    eq(names.indexOf('HY486.SYS') >= 0, true, 'kernel listed');
    var hello = Disk.readFile(b.image, 'HELLO.COM');
    eq(hello.length > 0, true, 'HELLO.COM has bytes');
  });

  test('a kernel that cannot fit segment 0 is rejected', function () {
    throws(function () {
      Guest.build({ assembler: Assembler, sectors: 2048, kernelSource: 'bits 16\norg 0x8000\nresb 33000\n' });
    }, 'oversized kernel must be rejected');
  });
});

suite('guest: kernel source', function () {
  var kernelAsm = null;
  function kernel() {
    if (!kernelAsm) {
      kernelAsm = Assembler.assemble(Guest.kernelSource, { bits: 16, origin: 0x8000, defines: KERNEL_DEFINES });
    }
    return kernelAsm;
  }

  test('kernel source assembles cleanly', function () {
    var r = kernel();
    eq(r.errors.length, 0, 'no assembler errors: ' + JSON.stringify(r.errors.slice(0, 4)));
    eq(r.ok, true, 'ok flag');
    eq(r.bytes.length > 1024, true, 'kernel has real code');
  });

  test('symbol table exposes the shell entry points', function () {
    var r = kernel();
    eq(r.symbols.has('kernel_start'), true, 'kernel_start');
    eq(r.symbols.has('shell_loop'), true, 'shell_loop');
    eq(r.symbols.has('dispatch'), true, 'dispatch');
    eq(r.symbols.has('read_line'), true, 'read_line');
    eq(r.symbols.get('shell_loop') > r.symbols.get('kernel_start'), true, 'shell entry lives after the start');
    eq(r.symbols.get('kernel_start'), 0x8000, 'kernel_start is the load address');
  });

  test('every command has a handler symbol', function () {
    var r = kernel();
    ['do_help', 'do_dir', 'do_type', 'do_run', 'do_del', 'do_mem', 'do_ver', 'do_time', 'do_date',
      'do_cls', 'do_reboot', 'do_halt', 'do_boot', 'com_start', 'com_exit', 'svc21'].forEach(function (name) {
      eq(r.symbols.has(name), true, 'symbol ' + name);
    });
  });

  test('no reference is left undefined', function () {
    var r = kernel();
    eq(r.errors.length, 0, 'undefined symbols would show up as errors');
    eq(r.symbols.get('shell_loop') > 0, true, 'shell_loop resolved');
  });

  test('every kernel instruction disassembles and re-assembles identically', function () {
    var r = kernel();
    var codeEnd = r.symbols.get('msg_banner1');
    eq(codeEnd > 0x8000, true, 'the data section starts after the code');
    var rows = Disassembler.range(r.bytes, { bits: 16, origin: 0x8000, maxInstrs: 60000 }).instrs;
    var code = rows.filter(function (row) { return row.addr < codeEnd; });
    eq(code.length > 200, true, 'kernel has plenty of instructions');
    var text = code.map(function (row) { return row.text; }).join('\n');
    var again = Assembler.assemble(text, { bits: 16, origin: 0x8000 });
    eq(again.ok, true, 'disassembly re-assembles: ' + JSON.stringify(again.errors.slice(0, 3)));
    eq(sameBytes(again.bytes, r.bytes.subarray(0, codeEnd - 0x8000)), true, 'round trip reproduces the kernel code');
  });

  test('the shell command table names the documented commands', function () {
    var r = kernel();
    var src = Guest.kernelSource;
    ['HELP', 'DIR', 'TYPE', 'RUN', 'DEL', 'MEM', 'VER', 'TIME', 'DATE', 'CLS', 'REBOOT', 'HALT', 'BOOT', 'BREAK']
      .forEach(function (cmd) {
        eq(src.indexOf('db "' + cmd + '", 0') >= 0, true, 'command word ' + cmd);
      });
    eq(r.symbols.get('cmd_break') > 0, true, 'command table is in the image');
  });

  test('the boot source is a single sector worth of code', function () {
    var boot = Assembler.assemble(Guest.bootSource, {
      bits: 16, origin: 0x7C00, defines: { KERNEL_LBA: 12, KERNEL_SECTORS: 10, BOOT_SUPER_SECTOR: 1 }
    });
    eq(boot.ok, true, 'boot source assembles');
    eq(boot.bytes.length <= 510, true, 'boot code leaves room for the 55 AA signature');
    eq(boot.symbols.has('boot_read'), true, 'read helper present');
    eq(boot.symbols.has('boot_hang'), true, 'error hang loop present');
  });
});

/* -------------------------------------------------------- stand-in BIOS ----- */

var STUB_SOURCE = String.raw`; Test-only BIOS: INT 13h extended read/write over ATA PIO, INT 16h from a key
; buffer, INT 15h AH=88h/24h and INT 1Ah AH=02h/04h. Loaded at linear 0x1000 as
; segment 0x0100 offset 0, so the IVT far pointers point at 0x0100:<label>.
; BX, CX and DX are scratch for INT 13h (only AH/CF and the DAP buffer matter);
; INT 15h, INT 16h and INT 1Ah keep their result registers intact.
bits 16
org 0

int13:
    push bp
    mov bp, sp
    push si
    push di
    push ds
    push es
    cmp ah, 0x00
    je i13_reset
    cmp ah, 0x08
    je i13_geom
    cmp ah, 0x41
    je i13_ext
    cmp ah, 0x15
    je i13_type
    cmp ah, 0x42
    je i13_read
    cmp ah, 0x43
    je i13_write
    jmp i13_fail
i13_reset:
    clc
    mov ah, 0
    jmp i13_out
i13_geom:
    mov cx, GEOM_CX
    mov dh, GEOM_DH
    mov dl, 0x80
    xor bx, bx
    clc
    mov ah, 0
    jmp i13_out
i13_ext:
    mov bx, 0xAA55
    mov ah, 0x30
    clc
    jmp i13_out
i13_type:
    mov ah, 3
    mov cx, 1
    mov dx, 0
    clc
    jmp i13_out
i13_fail:
    stc
    mov ah, 1
    jmp i13_out
i13_read:
    mov byte [bio_cmd], 0x20
    jmp i13_transfer
i13_write:
    mov byte [bio_cmd], 0x30
i13_transfer:
    mov cx, [si+2]
    test cx, cx
    jz i13_fail
    cmp cx, 128
    ja i13_fail
    mov [bio_count], cl
    mov ax, [si+8]
    mov [bio_lba], ax
    mov ax, [si+4]
    mov [bio_off], ax
    mov ax, [si+6]
    mov [bio_seg], ax
i13_tr_loop:
    mov dx, 0x1F2
    mov al, 1
    out dx, al
    mov ax, [bio_lba]
    mov dx, 0x1F3
    out dx, al
    mov al, ah
    mov dx, 0x1F4
    out dx, al
    xor al, al
    mov dx, 0x1F5
    out dx, al
    mov dx, 0x1F6
    mov al, 0xE0
    out dx, al
    mov dx, 0x1F7
    mov al, [bio_cmd]
    out dx, al
i13_tr_wait:
    mov dx, 0x1F7
    in al, dx
    test al, 0x80
    jnz i13_tr_wait
    test al, 0x08
    jz i13_fail
    mov ax, [bio_seg]
    mov es, ax
    mov di, [bio_off]
    mov si, di
    mov dx, 0x1F0
    mov cx, 256
    cmp byte [bio_cmd], 0x20
    jne i13_tr_write
    rep insw
    jmp i13_tr_next
i13_tr_write:
    rep outsw
i13_tr_next:
    add word [bio_off], 512
    add word [bio_lba], 1
    dec byte [bio_count]
    jnz i13_tr_loop
    clc
    mov ah, 0
    jmp i13_out
i13_out:
    pushf
    pop bx
    and bx, 1
    and word [bp+6], 0xFFFE
    or [bp+6], bx
    pop es
    pop ds
    pop di
    pop si
    pop bp
    iret

int16:
    push bp
    mov bp, sp
    push bx
    mov word [bio_zf], 0
    cmp ah, 0x01
    je i16_check
    cmp ah, 0x00
    jne i16_other
i16_read:
    cmp byte [bio_key_len], 0
    jne i16_take
    sti
    hlt
    jmp i16_read
i16_take:
    call i16_pop
    clc
    jmp i16_out
i16_check:
    cmp byte [bio_key_len], 0
    je i16_none
    call i16_pop
    clc
    jmp i16_out
i16_none:
    xor ax, ax
    mov word [bio_zf], 0x40
    clc
    jmp i16_out
i16_other:
    xor ax, ax
    clc
    jmp i16_out
i16_pop:
    mov bx, [bio_key_pos]
    mov al, [bx+bio_key_buf]
    inc bx
    mov [bio_key_pos], bx
    dec byte [bio_key_len]
    mov ah, 0
    ret
i16_out:
    push ax
    pushf
    pop bx
    and bx, 1
    mov ax, bx
    mov bx, [bio_zf]
    or ax, bx
    and word [bp+6], 0xFFBE
    or [bp+6], ax
    mov word [bio_zf], 0
    pop ax
    pop bx
    pop bp
    iret

int15:
    push bp
    mov bp, sp
    push bx
    cmp ah, 0x88
    je i15_mem
    cmp ah, 0x24
    je i15_a20
    xor ax, ax
    clc
    jmp i15_out
i15_mem:
    mov ax, EXT_KB
    clc
    jmp i15_out
i15_a20:
    mov ax, 1
    clc
i15_out:
    pushf
    pop bx
    and bx, 1
    and word [bp+6], 0xFFFE
    or [bp+6], bx
    pop bx
    pop bp
    iret

int1a:
    push bp
    mov bp, sp
    push bx
    cmp ah, 0x02
    je i1a_time
    cmp ah, 0x04
    je i1a_date
    xor cx, cx
    xor dx, dx
    clc
    jmp i1a_out
i1a_time:
    mov cx, 0x1234
    mov dx, 0x5600
    clc
    jmp i1a_out
i1a_date:
    mov cx, 0x2024
    mov dx, 0x1231
    clc
i1a_out:
    pushf
    pop bx
    and bx, 1
    and word [bp+6], 0xFFFE
    or [bp+6], bx
    pop bx
    pop bp
    iret

int21_stub:
    clc
    iret

; Variables live at fixed low addresses so the handlers can reach them with DS=0
; (the callers keep DS=0), above the .COM load window and below the boot sector.
bio_cmd         equ 0x7B00
bio_count       equ 0x7B01
bio_zf          equ 0x7B02
bio_lba         equ 0x7B04
bio_off         equ 0x7B06
bio_seg         equ 0x7B08
bio_key_len     equ 0x7B0A
bio_key_pos     equ 0x7B0C
bio_key_buf     equ 0x7B10
`;
var STUB_BASE = 0x1000;
var STUB_SEG = 0x0100;

function stubBios(sectors) {
  var cyl = Math.max(1, Math.floor(sectors / (16 * 63))) - 1;
  if (cyl < 0) cyl = 0;
  var cx = ((cyl & 0xFF) << 8) | (((cyl >> 8) & 3) << 6) | 63;
  var r = Assembler.assemble(STUB_SOURCE, {
    bits: 16,
    origin: 0,
    defines: { GEOM_CX: cx, GEOM_DH: 15, EXT_KB: 3072 }
  });
  if (!r.ok) throw new Error('stand-in BIOS failed to assemble: ' + JSON.stringify(r.errors.slice(0, 4)));
  return r;
}

function setVector(bus, num, offset) {
  bus.write8(num * 4, offset & 0xFF);
  bus.write8(num * 4 + 1, (offset >>> 8) & 0xFF);
  bus.write8(num * 4 + 2, STUB_SEG & 0xFF);
  bus.write8(num * 4 + 3, (STUB_SEG >>> 8) & 0xFF);
}

/* Boots an image the way INT 19h would: the CPU starts at 0:7C00 with DL=0x80. */
function bootImage(image, keysText) {
  var bus = new I486.Bus({ ramMB: 4 });
  var dev = I486.Devices.install(bus, {});
  dev.ata.setImage(image);
  dev.vga.setMode(3);
  var stub = stubBios(dev.ata.sectors);
  bus.setBytes(0x7C00, image.subarray(0, 512));
  bus.setBytes(STUB_BASE, stub.bytes);
  function sym(name) {
    var v = stub.symbols.get(name);
    if (v === undefined) throw new Error('stand-in BIOS symbol missing: ' + name);
    return v;
  }
  var keys = ascii(keysText || '');
  if (keys.length) bus.setBytes(sym('bio_key_buf'), keys);
  bus.write8(sym('bio_key_len'), keys.length);
  setVector(bus, 0x13, sym('int13'));
  setVector(bus, 0x16, sym('int16'));
  setVector(bus, 0x15, sym('int15'));
  setVector(bus, 0x1A, sym('int1a'));
  setVector(bus, 0x21, sym('int21_stub'));
  var cpu = new I486.CPU(bus);
  cpu.reset();
  cpu.setSeg('cs', 0);
  cpu.setSeg('ds', 0);
  cpu.setSeg('es', 0);
  cpu.setSeg('ss', 0);
  cpu.setReg('eip', 0x7C00);
  cpu.setReg('sp', 0x7C00);
  cpu.setReg('dl', 0x80);
  cpu.setFlag('if', 1);
  return { bus: bus, dev: dev, cpu: cpu, stub: stub };
}

function runGuest(machine, limit) {
  var total = 0, n, guard = 0;
  while (total < limit && guard < 400) {
    n = machine.cpu.run(50000);
    total += n;
    guard++;
    if (machine.cpu.tripleFault || machine.cpu.halted || n === 0) break;
  }
  return total;
}

function screenText(machine) {
  return machine.dev.vga.getScreenText().join('\n');
}

var bootRun = null;
var bootKeys = 'ver\r' + 'dir\r' + 'run HELLO.COM\r' + 'badcmd\r';

function bootedGuest() {
  if (bootRun) return bootRun;
  var hello = Assembler.assemble(HELLO_COM, { bits: 16, origin: 0x100 });
  var image = Guest.build({
    assembler: Assembler,
    sectors: 2048,
    files: [{ name: 'HELLO.COM', data: hello.bytes }]
  }).image;
  bootRun = bootImage(image, bootKeys);
  bootRun.executed = runGuest(bootRun, 2000000);
  bootRun.screen = screenText(bootRun);
  return bootRun;
}

/* ------------------------------------------------------------- boot chain --- */

suite('guest: boot chain', function () {
  test('the image boots without a fault and stops at the prompt', function () {
    var m = bootedGuest();
    eq(m.cpu.tripleFault, false, 'no triple fault');
    eq(m.cpu.halted, true, 'the shell waits in INT 16h');
    eq(m.executed > 10000, true, 'the guest really ran (' + m.executed + ' instructions)');
    eq(m.bus.read8(0x7DFE), 0x55, 'boot signature stayed at 0x7DFE');
    eq(m.bus.read8(0x7DFF), 0xAA, 'boot signature high byte');
  });

  test('the banner reports name, version, memory and geometry', function () {
    var s = bootedGuest().screen;
    eq(s.indexOf('HY486 mini-kernel version 1.00') >= 0, true, 'banner name and version');
    eq(s.indexOf('16-bit real mode') >= 0, true, 'banner mode line');
    eq(s.indexOf('memory above 1MB: 3072 KB') >= 0, true, 'INT 15h AH=88h memory size');
    eq(s.indexOf('disk 80h geometry:') >= 0, true, 'INT 13h AH=08h geometry line');
    eq(s.indexOf('type help for the command list') >= 0, true, 'hint line');
  });

  test('the shell shows its prompt', function () {
    var s = bootedGuest().screen;
    var count = s.split('hy486>').length - 1;
    eq(s.indexOf('hy486>') >= 0, true, 'prompt text');
    eq(count >= 4, true, 'one prompt per command (' + count + ' seen)');
  });

  test('ver prints the kernel version line', function () {
    var s = bootedGuest().screen;
    eq(s.indexOf('HY486 version 1.00, HYFS, 16-bit real mode') >= 0, true, 'ver output');
  });

  test('dir lists both files with sizes', function () {
    var s = bootedGuest().screen;
    eq(s.indexOf('name         size') >= 0, true, 'directory header');
    eq(s.indexOf('HY486.SYS') >= 0, true, 'kernel listed');
    eq(s.indexOf('HELLO.COM') >= 0, true, 'program listed');
    eq(s.indexOf('2 file(s)') >= 0, true, 'file count');
  });

  test('run starts the .COM and returns to the prompt', function () {
    var s = bootedGuest().screen;
    eq(s.indexOf('HELLO FROM DISK') >= 0, true, 'INT 21h AH=09h output');
    eq(s.indexOf('done') >= 0, true, 'return message');
  });

  test('done starts on its own line when the program leaves no newline', function () {
    var noNl = [
      '; HELLO.COM variant whose INT 21h AH=09h string has no CR/LF',
      'bits 16',
      'org 0x100',
      '    mov dx, bare_text',
      '    mov ah, 0x09',
      '    int 0x21',
      '    mov ax, 0x4C00',
      '    int 0x21',
      'bare_text:',
      '    db "HELLO FROM DISK", 36, 0'
    ].join('\n');
    var prog = Assembler.assemble(noNl, { bits: 16, origin: 0x100 });
    eq(prog.ok, true, 'the bare program assembles');
    eq(prog.bytes.indexOf(13) < 0 && prog.bytes.indexOf(10) < 0, true, 'the program output carries no newline');
    var built = Guest.build({ assembler: Assembler, sectors: 1024, files: [{ name: 'BARE.COM', data: prog.bytes }] });
    var m = bootImage(built.image, 'run BARE.COM\r');
    runGuest(m, 900000);
    var lines = screenText(m).split('\n');
    var doneAt = -1, i;
    for (i = 0; i < lines.length; i++) if (lines[i].trim() === 'done') doneAt = i;
    eq(doneAt > 0, true, 'a line holds exactly "done": ' + JSON.stringify(lines));
    eq(lines[doneAt - 1].trim(), 'HELLO FROM DISK', 'done follows the program output on the next line');
    eq(screenText(m).indexOf('HELLO FROM DISKdone') < 0, true, 'done is not glued onto the program output');
    eq(lines[doneAt + 1].indexOf('hy486>') >= 0, true, 'the prompt follows on its own line');
  });

  test('an unknown command reports bad command', function () {
    var s = bootedGuest().screen;
    eq(s.indexOf('bad command: BADCMD') >= 0, true, 'bad command line');
  });

  test('a broken superblock stops the boot loader with a message', function () {
    var image = Guest.build({ assembler: Assembler, sectors: 1024 }).image;
    image[512] = 0x00;
    var m = bootImage(image, '');
    var ran = runGuest(m, 400000);
    var screen = screenText(m);
    eq(ran > 30, true, 'the boot sector ran (' + ran + ' instructions)');
    eq(screen.indexOf('HY486 boot: no HYFS superblock') >= 0, true, 'boot error message: ' + JSON.stringify(screen.slice(0, 60)));
    eq(m.cpu.halted, true, 'the loader halts after the error');
  });

  test('time and date read the RTC through INT 1Ah', function () {
    var image = Guest.build({ assembler: Assembler, sectors: 1024 }).image;
    var m = bootImage(image, 'time\rdate\r');
    runGuest(m, 600000);
    var screen = screenText(m);
    eq(screen.indexOf('12:34:56') >= 0, true, 'time output: ' + JSON.stringify(screen.split('\n').slice(-4)));
    eq(screen.indexOf('2024-12-31') >= 0, true, 'date output');
  });

  test('del removes a file from the disk image', function () {
    var hello = Assembler.assemble(HELLO_COM, { bits: 16, origin: 0x100 });
    var built = Guest.build({
      assembler: Assembler,
      sectors: 1024,
      files: [{ name: 'HELLO.COM', data: hello.bytes }]
    });
    var m = bootImage(built.image, 'del HELLO.COM\r');
    runGuest(m, 600000);
    var screen = screenText(m);
    eq(screen.indexOf('deleted HELLO.COM') >= 0, true, 'delete confirmation');
    eq(m.dev.ata.image === built.image, true, 'the ATA image is the same buffer');
    eq(Disk.readFile(built.image, 'HELLO.COM'), null, 'file gone from the image');
    eq(Disk.check(built.image).ok, true, 'image still consistent');
  });

  test('help, mem and type answer with real content', function () {
    var hello = Assembler.assemble(HELLO_COM, { bits: 16, origin: 0x100 });
    var text = 'HELLO TEXT\r\nSECOND LINE\r\n';
    var built = Guest.build({
      assembler: Assembler,
      sectors: 1024,
      files: [{ name: 'HELLO.COM', data: hello.bytes }, { name: 'NOTE.TXT', data: ascii(text) }]
    });
    var m = bootImage(built.image, 'help\rmem\rtype NOTE.TXT\r');
    runGuest(m, 900000);
    var screen = screenText(m);
    eq(screen.indexOf('help dir type FILE run FILE del FILE') >= 0, true, 'help lists the commands');
    eq(screen.indexOf('conventional memory: 640 KB') >= 0, true, 'mem reports base memory');
    eq(screen.indexOf('extended memory: 3072 KB') >= 0, true, 'mem reports extended memory');
    eq(screen.indexOf('HELLO TEXT') >= 0, true, 'type prints the file');
    eq(screen.indexOf('SECOND LINE') >= 0, true, 'type prints every line');
  });

  test('halt stops the CPU and says so', function () {
    var image = Guest.build({ assembler: Assembler, sectors: 1024 }).image;
    var m = bootImage(image, 'halt\r');
    runGuest(m, 600000);
    eq(screenText(m).indexOf('halted') >= 0, true, 'halt message');
    eq(m.cpu.halted, true, 'the CPU is halted');
  });

  test('boot FILE chain-loads a 512-byte sector image', function () {
    var sector = Assembler.assemble([
      'bits 16',
      'org 0x7C00',
      '    cli',
      '    xor ax, ax',
      '    mov ds, ax',
      '    mov ax, 0xB800',
      '    mov es, ax',
      '    mov al, 0x42',
      '    mov ah, 0x0F',
      '    mov [es:0], ax',
      '    mov al, 0x4F',
      '    mov [es:2], ax',
      '    mov al, 0x4F',
      '    mov [es:4], ax',
      '    mov al, 0x54',
      '    mov [es:6], ax',
      'boot_here:',
      '    cli',
      '    hlt',
      '    jmp boot_here'
    ].join('\n'), { bits: 16, origin: 0x7C00 });
    eq(sector.ok, true, 'chain-load image assembles');
    var img = new Uint8Array(512);
    img.set(sector.bytes, 0);
    img[510] = 0x55;
    img[511] = 0xAA;
    var built = Guest.build({ assembler: Assembler, sectors: 1024, files: [{ name: 'SEC.BIN', data: img }] });
    var m = bootImage(built.image, 'boot SEC.BIN\r');
    runGuest(m, 900000);
    eq(screenText(m).indexOf('BOOT') >= 0, true, 'the chain-loaded sector painted its text');
    eq(m.cpu.halted, true, 'the chain-loaded sector halted');
  });

  test('reboot is a far jump to the reset vector', function () {
    var built = Guest.build({ assembler: Assembler, sectors: 1024 });
    eq(findPattern(built.kernel, [0xEA, 0x00, 0x00, 0xFF, 0xFF]) >= 0, true, 'jmp 0xFFFF:0x0000 is in the kernel image');
  });

  test('cls clears the screen', function () {
    var image = Guest.build({ assembler: Assembler, sectors: 1024 }).image;
    var m = bootImage(image, 'cls\r');
    runGuest(m, 600000);
    var screen = screenText(m);
    eq(screen.indexOf('HY486 mini-kernel') < 0, true, 'banner scrolled away by cls');
    eq(screen.indexOf('hy486> cls') < 0, true, 'command line cleared too');
    eq(screen.indexOf('hy486>') >= 0, true, 'a fresh prompt is drawn');
  });
});

/* ------------------------------------------------- machine.js integration --- */

var PROBE_BOOT = [
  '; control boot sector: proves the machine can boot an image at all',
  'bits 16',
  'org 0x7C00',
  '    cli',
  '    xor ax, ax',
  '    mov ds, ax',
  '    mov ax, 0xB800',
  '    mov es, ax',
  '    mov ax, 0x0720',
  '    mov [es:0], ax',
  '    mov al, 0x48',
  '    mov ah, 0x07',
  '    mov [es:2], ax',
  '    mov al, 0x59',
  '    mov [es:4], ax',
  '    mov al, 0x50',
  '    mov [es:6], ax',
  'probe_hang:',
  '    cli',
  '    hlt',
  '    jmp probe_hang'
].join('\n');

function probeImage() {
  var r = Assembler.assemble(PROBE_BOOT, { bits: 16, origin: 0x7C00 });
  if (!r.ok) throw new Error('control boot sector failed to assemble: ' + JSON.stringify(r.errors.slice(0, 3)));
  var img = new Uint8Array(128 * 512);
  img.set(r.bytes, 0);
  img[510] = 0x55;
  img[511] = 0xAA;
  return img;
}

/* Drive the machine in slices: each call ticks devices, takes acked IRQs and
   retries shadowed ones, which is how the page runs it. */
function runChunks(m, total, chunk) {
  var left = total;
  while (left > 0) {
    if (m.run(Math.min(chunk, left)) <= 0) break;
    left -= chunk;
  }
}

function machineScreen(m) {
  return m.screen && typeof m.screen.getScreenText === 'function' ? m.screen.getScreenText().join('\n') : '';
}

suite('guest: machine integration', function () {
  test('boots through I486.Machine once the platform can boot', function () {
    var machinePath = path.join(__dirname, '..', 'lib', 'machine.js');
    var biosPath = path.join(__dirname, '..', 'lib', 'bios.js');
    if (!fs.existsSync(machinePath) || !fs.existsSync(biosPath)) {
      console.log('  note: i486/lib/machine.js or bios.js is absent; machine integration test skipped');
      return;
    }
    require(biosPath);
    require(machinePath);
    var M = globalThis.I486.Machine;
    assert(typeof M === 'function', 'I486.Machine is a constructor');

    /* Control boot: a 512-byte sector that paints 'X' and halts. If this does not
       run, machine.js + bios.js cannot boot any image yet, so a failure here would
       say nothing about the guest image. The note names the evidence. */
    var control = new M({ ramMB: 4 });
    control.loadDiskImage(probeImage());
    control.powerOn();
    runChunks(control, 2000000, 50000);
    if (machineScreen(control).indexOf('HYP') < 0) {
      console.log('  note: machine.js + bios.js cannot boot any image yet; guest integration is skipped');
      console.log('        control boot stopped at ' + control.cpu.cs.sel.toString(16) + ':' + control.cpu.eip.toString(16) +
        ' halted=' + control.cpu.halted + ' tripleFault=' + control.cpu.tripleFault +
        ' 0000:7C00=' + Array.from(control.bus.getBytes(0x7C00, 4)).map(function (b) {
          return (b < 16 ? '0' : '') + b.toString(16);
        }).join(' '));
      return;
    }

    var hello = Assembler.assemble(HELLO_COM, { bits: 16, origin: 0x100 });
    var image = Guest.build({
      assembler: Assembler,
      sectors: 2048,
      files: [{ name: 'HELLO.COM', data: hello.bytes }]
    }).image;
    var m = new M({ ramMB: 4 });
    m.loadDiskImage(image);
    m.powerOn();
    runChunks(m, 2000000, 50000);
    var screen = machineScreen(m);
    eq(screen.indexOf('HY486 mini-kernel version 1.00') >= 0, true,
      'banner on the machine screen: ' + JSON.stringify(screen.slice(-200)));
    eq(screen.indexOf('hy486>') >= 0, true, 'shell prompt on the machine screen');

    [0x2F, 0x12, 0x13, 0x1C].forEach(function (code) {
      m.setKey(code, true);
      m.setKey(code, false);
    });
    runChunks(m, 600000, 20000);
    screen = machineScreen(m);
    eq(screen.indexOf('HY486 version 1.00') >= 0, true, 'ver answered inside the machine');
  });
});

/* The stand-in BIOS harness is exported so the guest can be poked at from the
   command line while machine.js is still moving; run-all never touches it. */
module.exports = {
  bootImage: bootImage,
  runGuest: runGuest,
  runChunks: runChunks,
  screenText: screenText,
  stubBios: stubBios
};

if (require.main === module) { process.exit(harness.run() ? 1 : 0); }
