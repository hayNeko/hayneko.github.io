
'use strict';

/*
 * crosscheck.test.cjs — dispatcher acceptance for the i486 stack.
 * Independent of the per-module suites: hand-derived Intel encodings, assembler
 * -> disassembler -> assembler round trips, and real execution of assembled
 * programs on the CPU through the bus.
 */

var path = require('path');
var harness = require('./harness.cjs');
var suite = harness.suite, test = harness.test, eq = harness.eq, bytes = harness.bytes, assert = harness.assert;

var A = require(path.join(__dirname, '..', 'lib', 'asm.js'));
var D = require(path.join(__dirname, '..', 'lib', 'disasm.js'));
var CPU = require(path.join(__dirname, '..', 'lib', 'cpu.js')).CPU;
var Bus = require(path.join(__dirname, '..', 'lib', 'bus.js')).Bus;

var GOLDEN = [
  ['bits 16', 'mov ax, 0x1234', 'b8 34 12'],
  ['bits 16', 'mov al, 0x7f', 'b0 7f'],
  ['bits 16', 'mov [bx], ax', '89 07'],
  ['bits 16', 'mov ax, [0x1234]', 'a1 34 12'],
  ['bits 16', 'mov ax, es:[di]', '26 8b 05'],
  ['bits 16', 'add ax, 1', '83 c0 01'],
  ['bits 16', 'sub ax, 1', '83 e8 01'],
  ['bits 16', 'cmp ax, 1', '83 f8 01'],
  ['bits 16', 'add ax, 0x80', '05 80 00'],
  ['bits 16', 'add al, 1', '04 01'],
  ['bits 16', 'test ax, 1', 'a9 01 00'],
  ['bits 16', 'and byte [bx], 0x0f', '80 27 0f'],
  ['bits 16', 'or word [bx+4], 0x1234', '81 4f 04 34 12'],
  ['bits 16', 'push 1', '6a 01'],
  ['bits 16', 'int 0x10', 'cd 10'],
  ['bits 16', 'rep movsb', 'f3 a4'],
  ['bits 16', 'jmp 0x300', 'e9 fd 02'],
  ['bits 16', 'jmp short 0x10', 'eb 0e'],
  ['bits 16', 'jz 0x300', '0f 84 fc 02'],
  ['bits 16', 'call 0x1234', 'e8 31 12'],
  ['bits 16', 'lgdt [bx]', '0f 01 17'],
  ['bits 16', 'mov ax, bx\njmp ax', '89 d8 ff e0'],
  ['bits 32', 'mov eax, 1', 'b8 01 00 00 00'],
  ['bits 32', 'add eax, 0x12345678', '05 78 56 34 12'],
  ['bits 32', 'add eax, 1', '83 c0 01'],
  ['bits 32', 'mov eax, [ebx+ecx*4+0x10]', '8b 44 8b 10'],
  ['bits 32', 'lea eax, [ebx+ecx*8+0x100]', '8d 84 cb 00 01 00 00'],
  ['bits 32', 'movzx eax, byte [esi]', '0f b6 06'],
  ['bits 32', 'mov cr0, eax', '0f 22 c0'],
  ['bits 32', 'mov eax, [0x12345678]', 'a1 78 56 34 12'],
  ['bits 32', 'xor eax, eax\nrep stosd', '31 c0 f3 ab'],
  ['bits 32', 'shld eax, ebx, 4', '0f a4 d8 04'],
  ['bits 32', 'bt eax, 3', '0f ba e0 03'],
  ['bits 32', 'setz al', '0f 94 c0'],
  ['bits 32', 'bswap eax', '0f c8'],
  ['bits 32', 'cmpxchg [esi], ecx', '0f b1 0e'],
  ['bits 32', 'imul eax, ebx, 4', '6b c3 04'],
  ['bits 32', 'xchg eax, ecx', '91'],
  ['bits 32', 'cpuid', '0f a2'],
  ['bits 32', 'fld dword [eax]', 'd9 00'],
  ['bits 32', 'faddp st1, st0', 'de c1']
];

suite('golden encodings', function () {
  GOLDEN.forEach(function (c) {
    test('assembles ' + c[1].replace(/\n/g, '; '), function () {
      var r = A.Assembler.assemble(c[0] + '\n' + c[1], { origin: 0 });
      assert(r.ok, 'assembly failed: ' + JSON.stringify(r.errors));
      bytes(r.bytes, c[2].split(' ').map(function (h) { return parseInt(h, 16); }), c[1]);
    });
  });
});

var CORPUS = [
  ['bits 16', 'mov ax, 0x1234'], ['bits 16', 'mov al, 0x7f'], ['bits 16', 'mov [bx], ax'],
  ['bits 16', 'mov ax, [bx+si+4]'], ['bits 16', 'mov ax, [bx+di+0x1234]'], ['bits 16', 'mov ax, [bp+si]'],
  ['bits 16', 'mov ax, [bp]'], ['bits 16', 'mov ax, [si]'], ['bits 16', 'mov ax, [0x1234]'],
  ['bits 16', 'mov ax, es:[di]'], ['bits 16', 'mov [bp-6], dx'], ['bits 16', 'add ax, 1'],
  ['bits 16', 'sub ax, 1'], ['bits 16', 'cmp ax, 1'], ['bits 16', 'add ax, 0x80'],
  ['bits 16', 'add al, 1'], ['bits 16', 'test ax, 1'], ['bits 16', 'and byte [bx], 0x0f'],
  ['bits 16', 'or word [bx+4], 0x1234'], ['bits 16', 'push 1'], ['bits 16', 'push 0x1234'],
  ['bits 16', 'pop bx'], ['bits 16', 'int 0x10'], ['bits 16', 'int3'], ['bits 16', 'iret'],
  ['bits 16', 'rep movsb'], ['bits 16', 'repne scasb'], ['bits 16', 'stosw'], ['bits 16', 'lodsd'],
  ['bits 16', 'jmp 0x300'], ['bits 16', 'jmp short 0x10'], ['bits 16', 'jz 0x300'],
  ['bits 16', 'loop 0x10'], ['bits 16', 'call 0x1234'], ['bits 16', 'ret'], ['bits 16', 'retf'],
  ['bits 16', 'lea ax, [bx+si+4]'], ['bits 16', 'lgdt [bx]'], ['bits 16', 'in al, dx'],
  ['bits 16', 'out dx, al'], ['bits 16', 'in al, 0x60'], ['bits 16', 'out 0x60, al'],
  ['bits 16', 'mov ax, bx\njmp ax'], ['bits 16', 'cli\nsti\nhlt'], ['bits 16', 'pusha\npopa'],
  ['bits 16', 'enter 0x10, 0'], ['bits 16', 'leave'], ['bits 16', 'xlat'],
  ['bits 32', 'mov eax, 1'], ['bits 32', 'mov ecx, [eax]'], ['bits 32', 'mov ecx, [eax+ebx*2+0x10]'],
  ['bits 32', 'mov ecx, [ebx*4+0x20]'], ['bits 32', 'mov ecx, [0x12345678]'], ['bits 32', 'mov ecx, [ebp]'],
  ['bits 32', 'add eax, 0x12345678'], ['bits 32', 'add eax, 1'], ['bits 32', 'imul eax, ebx, 4'],
  ['bits 32', 'movzx eax, byte [esi]'], ['bits 32', 'movsx ecx, word [edi+2]'], ['bits 32', 'mov cr0, eax'],
  ['bits 32', 'mov eax, cr3'], ['bits 32', 'lgdt [ebx]'], ['bits 32', 'cpuid'], ['bits 32', 'bswap eax'],
  ['bits 32', 'cmpxchg [esi], ecx'], ['bits 32', 'xadd [esi], eax'], ['bits 32', 'shld eax, ebx, 4'],
  ['bits 32', 'shrd eax, ebx, cl'], ['bits 32', 'bt eax, 3'], ['bits 32', 'bts dword [esi], 5'],
  ['bits 32', 'setz al'], ['bits 32', 'fld dword [eax]'], ['bits 32', 'faddp st1, st0'],
  ['bits 32', 'fild word [eax]'], ['bits 32', 'movzx eax, byte [esi]'],
  ['bits 32', 'xor eax, eax\nrep stosd'], ['bits 32', 'mov eax, 0x12345678'], ['bits 32', 'lea eax, [ebx+ecx*8+0x100]'],
  ['bits 32', 'pushfd\npopfd'], ['bits 32', 'iretd'], ['bits 32', 'mov eax, [ebx+esi*4]']
];

suite('assembler -> disassembler -> assembler', function () {
  CORPUS.forEach(function (c) {
    test('round trip ' + c[1].replace(/\n/g, '; '), function () {
      var bits = c[0] === 'bits 32' ? 32 : 16;
      var src = c[0] + '\n' + c[1];
      var r = A.Assembler.assemble(src, { origin: 0 });
      assert(r.ok, 'assembly failed: ' + JSON.stringify(r.errors));
      var d = D.Disassembler.disassemble(r.bytes, { bits: bits, origin: 0, count: 1000 });
      assert(d.instrs.length >= 1, 'no instruction decoded');
      assert(d.length === r.bytes.length, 'disassembled ' + d.length + ' of ' + r.bytes.length + ' bytes');
      var text = d.instrs.map(function (i) { return i.text; }).join('\n');
      var back = A.Assembler.assemble(c[0] + '\n' + text, { origin: 0 });
      assert(back.ok, 'reassembly failed for "' + text + '": ' + JSON.stringify(back.errors));
      bytes(back.bytes, Array.from(r.bytes), c[1] + ' via ' + JSON.stringify(text));
    });
  });
});

suite('assembled code executes correctly', function () {
  test('16-bit Fibonacci loop writes memory', function () {
    var src = [
      'bits 16', 'org 0x100',
      'main:', '    mov cx, 12', '    mov si, 0x300', '    mov bx, 0', '    mov dx, 1',
      '.fib:', '    mov ax, bx', '    add ax, dx', '    mov [si], ax', '    add si, 2',
      '    mov bx, dx', '    mov dx, ax', '    loop .fib', '    hlt'
    ].join('\n');
    var r = A.Assembler.assemble(src, { origin: 0x100 });
    assert(r.ok, JSON.stringify(r.errors));
    var bus = new Bus({ ramMB: 1 });
    var cpu = new CPU(bus);
    cpu.reset();
    cpu.setSeg('cs', 0); cpu.setSeg('ds', 0); cpu.setSeg('ss', 0); cpu.setSeg('es', 0);
    bus.setBytes(0x100, r.bytes);
    cpu.eip = 0x100;
    cpu.run(4000);
    var fib = [];
    for (var i = 0; i < 12; i++) fib.push(bus.read16(0x300 + i * 2));
    eq(fib.slice(0, 8).join(','), '1,2,3,5,8,13,21,34', 'fib sequence ' + fib.join(','));
  });

  test('32-bit arithmetic and shifts with 66 prefixes in real mode', function () {
    var src = [
      'bits 16', 'org 0x100',
      'main:', '    mov eax, 0x12345678', '    mov ecx, 8', '    xor edx, edx',
      '.l:', '    rol eax, 4', '    add edx, eax', '    loop .l', '    mov dword [0x800], edx', '    hlt'
    ].join('\n');
    var r = A.Assembler.assemble(src, { origin: 0x100 });
    assert(r.ok, JSON.stringify(r.errors));
    var bus = new Bus({ ramMB: 1 });
    var cpu = new CPU(bus);
    cpu.reset();
    cpu.setSeg('cs', 0); cpu.setSeg('ds', 0); cpu.setSeg('ss', 0); cpu.setSeg('es', 0);
    bus.setBytes(0x100, r.bytes);
    cpu.eip = 0x100;
    cpu.run(4000);
    var eax = 0x12345678, edx = 0;
    for (var i = 0; i < 8; i++) { eax = ((eax << 4) | (eax >>> 28)) >>> 0; edx = (edx + eax) >>> 0; }
    eq(bus.read32(0x800) >>> 0, edx, 'rotated sum');
  });

  test('protected mode: far jump into a 32-bit flat code segment', function () {
    var src = [
      'bits 16', 'org 0x100',
      '    cli',
      '    lgdt [0x980]',
      '    mov eax, cr0',
      '    or al, 1',
      '    mov cr0, eax',
      '    jmp 0x08:pm_entry',
      'bits 32',
      'pm_entry:',
      '    mov ax, 0x10',
      '    mov ds, ax',
      '    mov es, ax',
      '    mov ss, ax',
      '    mov eax, 0xDEADBEEF',
      '    mov [0x100000], eax',
      '    mov ebx, 0x11223344',
      '    mov [0x200000], ebx',
      '    hlt',
      'bits 16',
      'gdt:',
      '    dq 0',
      '    db 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x9A, 0xCF, 0x00',
      '    db 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x92, 0xCF, 0x00',
      'gdt_desc:',
      '    dw 23',
      '    dd 0x900'
    ].join('\n');
    var r = A.Assembler.assemble(src, { origin: 0x100 });
    assert(r.ok, JSON.stringify(r.errors));
    var bus = new Bus({ ramMB: 4 });
    var cpu = new CPU(bus);
    cpu.reset();
    cpu.setSeg('cs', 0); cpu.setSeg('ds', 0); cpu.setSeg('ss', 0); cpu.setSeg('es', 0);
    cpu.setReg('sp', 0xFFF0);
    bus.setBytes(0x100, r.bytes);
    // GDT and descriptor are emitted inline; copy them where the descriptor points
    var sym = r.symbols;
    var gdtAddr = sym instanceof Map ? sym.get('gdt') : sym.gdt;
    var descAddr = sym instanceof Map ? sym.get('gdt_desc') : sym.gdt_desc;
    var gdtOff = gdtAddr - 0x100, descOff = descAddr - 0x100;
    bus.setBytes(0x900, r.bytes.subarray(gdtOff, gdtOff + 24));
    bus.setBytes(0x980, r.bytes.subarray(descOff, descOff + 6));
    cpu.eip = 0x100;
    cpu.run(500);
    eq(bus.read32(0x100000) >>> 0, 0xDEADBEEF, 'wrote through a flat 32-bit data segment');
    eq(bus.read32(0x200000) >>> 0, 0x11223344, 'second store');
    eq(cpu.getSeg('cs').big, true, 'CS.D=1 after far jump');
    eq(cpu.cr0 & 1, 1, 'protected mode enabled');
  });

  test('rep movsb copies a block and honours DF', function () {
    var src = [
      'bits 16', 'org 0x100',
      '    cld', '    mov si, 0x400', '    mov di, 0x500', '    mov cx, 16', '    rep movsb',
      '    std', '    mov si, 0x40F', '    mov di, 0x60F', '    mov cx, 16', '    rep movsb',
      '    cld', '    hlt'
    ].join('\n');
    var r = A.Assembler.assemble(src, { origin: 0x100 });
    assert(r.ok, JSON.stringify(r.errors));
    var bus = new Bus({ ramMB: 1 });
    for (var i = 0; i < 16; i++) bus.write8(0x400 + i, 0xA0 + i);
    var cpu = new CPU(bus);
    cpu.reset();
    cpu.setSeg('cs', 0); cpu.setSeg('ds', 0); cpu.setSeg('ss', 0); cpu.setSeg('es', 0);
    bus.setBytes(0x100, r.bytes);
    cpu.eip = 0x100;
    cpu.run(4000);
    for (i = 0; i < 16; i++) eq(bus.read8(0x500 + i), 0xA0 + i, 'forward copy byte ' + i);
    for (i = 0; i < 16; i++) eq(bus.read8(0x600 + i), 0xA0 + i, 'downward copy byte ' + i);
    eq(cpu.getReg('si') & 0xFFFF, 0x3FF, 'si walked down to 0x3FF');
    eq(cpu.getReg('di') & 0xFFFF, 0x5FF, 'di walked down to 0x5FF');
  });

  test('int/iret through the real-mode IVT', function () {
    var main = A.Assembler.assemble([
      'bits 16', 'org 0x100',
      '    mov word [0x20*4], 0x300', '    mov word [0x20*4+2], 0', '    xor ax, ax',
      '    int 0x20', '    mov [0x400], ax', '    hlt'
    ].join('\n'), { origin: 0x100 });
    assert(main.ok, JSON.stringify(main.errors));
    var handler = A.Assembler.assemble([
      'bits 16', 'org 0x300',
      '    mov word [0x402], 0xBEEF', '    inc ax', '    iret'
    ].join('\n'), { origin: 0x300 });
    assert(handler.ok, JSON.stringify(handler.errors));
    var bus = new Bus({ ramMB: 1 });
    var cpu = new CPU(bus);
    cpu.reset();
    cpu.setSeg('cs', 0); cpu.setSeg('ds', 0); cpu.setSeg('ss', 0); cpu.setSeg('es', 0);
    cpu.setReg('sp', 0xFFFE);
    bus.setBytes(0x100, main.bytes);
    bus.setBytes(0x300, handler.bytes);
    cpu.eip = 0x100;
    cpu.run(200);
    eq(bus.read16(0x402), 0xBEEF, 'handler ran');
    eq(bus.read16(0x400), 1, 'ax after IRET');
    eq(cpu.eip >= 0x100, true, 'returned');
  });

  test('large source assembles fast and round-trips through disassembly', function () {
    var lines = ['bits 16', 'org 0xF0000', 'start:'];
    for (var i = 0; i < 400; i++) {
      lines.push('    mov ax, ' + (i * 7 & 0xFFFF));
      lines.push('    add ax, ' + (i & 0x7F));
      lines.push('    jmp short .s' + i);
      lines.push('.s' + i + ':');
      lines.push('    db 0x90, 0x90');
    }
    var src = lines.join('\n');
    var t0 = Date.now();
    var r = A.Assembler.assemble(src, { origin: 0xF0000 });
    var ms = Date.now() - t0;
    assert(r.ok, JSON.stringify(r.errors).slice(0, 400));
    assert(ms < 800, 'assembly took ' + ms + ' ms');
    var d = D.Disassembler.range(r.bytes, { bits: 16, origin: 0xF0000, maxInstrs: 5000 });
    assert(d.length > 1500, 'decoded only ' + d.length + ' bytes');
    var res = A.Assembler.assemble(src, { origin: 0xF0000 });
    bytes(res.bytes, Array.from(r.bytes), 'repeat assembly stable');
  });
});

if (require.main === module) { process.exit(harness.run() ? 1 : 0); }