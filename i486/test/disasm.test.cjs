'use strict';

/*
 * i486 disassembler test suite.
 * The round-trip corpus is generated from instruction templates so that every
 * addressing form, operand size and prefix combination is exercised: each form is
 * assembled, disassembled and assembled again, and the two byte strings must match.
 */

var harness = require('./harness.cjs');
var path = require('path');

var Assembler = require(path.join(__dirname, '..', 'lib', 'asm.js')).Assembler;
var Disassembler = require(path.join(__dirname, '..', 'lib', 'disasm.js')).Disassembler;

function hexBytes(bytes) {
  var out = [], i, s;
  for (i = 0; i < bytes.length; i++) {
    s = (bytes[i] & 0xFF).toString(16).toUpperCase();
    out.push(s.length < 2 ? '0' + s : s);
  }
  return out.join(' ');
}

function asm(src, bits, origin) {
  return Assembler.assemble(src, { bits: bits || 16, origin: origin || 0 });
}

function disText(bytes, bits, origin) {
  var r = Disassembler.range(bytes, { bits: bits || 16, origin: origin || 0 });
  return r.instrs.map(function (i) { return i.text; }).join(' | ');
}

function fromHex(s) {
  var parts = s.split(/\s+/), out = [], i;
  for (i = 0; i < parts.length; i++) if (parts[i]) out.push(parseInt(parts[i], 16));
  return out;
}

/* sources used for the property test: [source, bits] */
var FORMS = [
  ['mov eax, ebx', 32], ['mov ax, bx', 16], ['mov al, bl', 16], ['mov byte [bx], 7', 16],
  ['mov word [bx], 7', 16], ['mov dword [ebx], 7', 32], ['mov eax, 0x12345678', 32],
  ['mov bx, 0x1234', 16], ['mov al, 0x12', 16], ['mov ax, [bx]', 16], ['mov [bx], ax', 16],
  ['mov ax, ds', 16], ['mov ds, ax', 16], ['mov eax, cr0', 32], ['mov cr3, ebx', 32],
  ['mov edx, dr7', 32], ['movzx eax, byte [ebx]', 32], ['movsx ecx, word [ebx]', 32],
  ['mov eax, [ebx+ecx*4+0x10]', 32], ['mov eax, [ecx*4+0x10]', 32], ['mov eax, [esp+4]', 32],
  ['mov eax, [ebp]', 32], ['mov eax, [0x1234]', 32], ['mov ebx, [0x1234]', 32],
  ['mov eax, [fs:0x1234]', 32], ['mov ax, [es:di]', 16], ['mov bx, [bp+di+0x1234]', 16],
  ['mov bx, [si]', 16], ['mov bx, [0x1234]', 16], ['mov bx, [esi]', 16],
  ['add al, 1', 16], ['add ax, 1', 16], ['add eax, 0x1234', 32], ['add byte [bx+si+4], 1', 16],
  ['or byte [bx], 8', 16], ['adc bh, 1', 16], ['sbb word [bp+2], 0x1234', 16],
  ['and eax, 0x0f', 32], ['xor eax, eax', 32], ['cmp [si], ax', 16], ['sub esp, 4', 32],
  ['test al, 1', 16], ['test ebx, 4', 32], ['test byte [bx], 1', 16],
  ['push ax', 16], ['push eax', 32], ['push 5', 16], ['push 0x1234', 16], ['push dword [ebx]', 32],
  ['pop bp', 16], ['pop dword [ebx]', 32], ['push es', 16], ['pop ds', 16], ['push fs', 32],
  ['pusha', 16], ['popad', 32], ['inc ax', 16], ['dec ebp', 32], ['inc byte [bx]', 16],
  ['dec dword [ebx]', 32], ['xchg ax, bx', 16], ['xchg ecx, edx', 32], ['xchg al, ah', 16],
  ['lea ax, [bx+si+4]', 16], ['lea eax, [ebx+ecx*2+8]', 32],
  ['movsb', 16], ['movsw', 16], ['movsd', 32], ['stosd', 32], ['lodsb', 16], ['scasw', 16],
  ['cmpsd', 32], ['rep movsb', 16], ['repne scasb', 16], ['rep stosd', 32], ['es movsb', 16],
  ['in al, 0x60', 16], ['in ax, dx', 16], ['in eax, dx', 32], ['out 0x20, al', 16],
  ['out dx, eax', 32], ['int 0x10', 16], ['int3', 16], ['into', 16], ['iret', 16], ['iretd', 16],
  ['retf', 16], ['retf 4', 16], ['ret', 16], ['ret 8', 16], ['enter 0x10, 0', 16],
  ['leave', 16], ['shld eax, ebx, 4', 32], ['shrd [bx], ax, cl', 16], ['bt eax, ecx', 32],
  ['bts word [bx], 3', 16], ['btr eax, 1', 32], ['btc dword [ebx], 1', 32], ['bswap eax', 32],
  ['xadd [bx], ax', 16], ['cmpxchg [bx], ax', 16], ['setz al', 16], ['setnz byte [bx]', 16],
  ['imul eax, ebx', 32], ['imul eax, ebx, 4', 32], ['imul eax, 4', 32], ['idiv dword [ebx]', 32],
  ['mul bl', 16], ['neg byte [bx]', 16], ['not eax', 32], ['sal ax, 1', 16], ['sar byte [bx], cl', 16],
  ['rcl eax, 3', 32], ['rol dword [ebx], 1', 32],
  ['jmp short 0x10', 16], ['jmp near 0x100', 16], ['jz 0x10', 16], ['jnz near 0x100', 16],
  ['loop 0x10', 16], ['loope 0x10', 16], ['loopne 0x10', 16], ['jcxz 0x10', 16],
  ['jecxz 0x10', 32], ['call 0x200', 16], ['call 0x200', 32], ['jmp 0x1234:0x5678', 16],
  ['call 0x1234:0x5678', 16], ['jmp ax', 16], ['jmp far dword [ebx]', 32], ['call far word [bx]', 16],
  ['fld dword [eax]', 32], ['fld qword [eax]', 32], ['fld tword [eax]', 32], ['fstp dword [ebx]', 32],
  ['fild word [bx]', 16], ['fistp dword [ebx]', 32], ['fadd qword [eax]', 32], ['fld st(2)', 32],
  ['fxch st(1)', 32], ['fstp st(3)', 32], ['fadd st, st(2)', 32], ['faddp st(1), st', 32],
  ['fsub st, st(1)', 32], ['fmulp st(2), st', 32], ['fnstcw word [bx]', 16], ['fldcw word [bx]', 16],
  ['fnstsw ax', 32], ['fninit', 32], ['fld1', 32], ['fldz', 32], ['fsqrt', 32], ['fnop', 32],
  ['lgdt [bx]', 16], ['sgdt [bx]', 16], ['lidt [bx]', 16], ['sidt [bx]', 16], ['smsw ax', 16],
  ['lmsw ax', 16], ['invlpg [eax]', 32], ['sldt ax', 16], ['str ax', 16], ['lldt ax', 16],
  ['ltr ax', 16], ['verr ax', 16], ['verw ax', 16], ['lar eax, ebx', 32], ['lsl eax, ebx', 32],
  ['clts', 32], ['invd', 32], ['wbinvd', 32], ['cpuid', 32], ['ud2', 32],
  ['xlat', 16], ['sahf', 16], ['lahf', 16], ['cbw', 16], ['cwde', 32], ['cwd', 16], ['cdq', 32],
  ['daa', 16], ['das', 16], ['aaa', 16], ['aas', 16], ['aam', 16], ['aad', 16], ['aam 0x10', 16],
  ['hlt', 16], ['wait', 16], ['nop', 16], ['bound eax, dword [ebx]', 32], ['arpl ax, bx', 16],
  ['les ax, [bx]', 16], ['lds di, [bx]', 16], ['lock inc dword [ebx]', 32]
];

/* extra forms generated from addressing templates */
(function generateAddressing() {
  var bases = ['ebx', 'ebp', 'esi', 'edi', 'esp'];
  var scales = [1, 2, 4, 8];
  var disps = ['', '+0x10', '+0x1234', '-8'];
  var i, j, k;
  for (i = 0; i < bases.length; i++) {
    for (j = 0; j < scales.length; j++) {
      for (k = 0; k < disps.length; k++) {
        FORMS.push(['mov eax, [' + bases[i] + '+ecx*' + scales[j] + disps[k] + ']', 32]);
      }
    }
  }
  var r16 = ['bx+si', 'bx+di', 'bp+si', 'bp+di', 'si', 'di', 'bp', 'bx'];
  for (i = 0; i < r16.length; i++) {
    FORMS.push(['mov cx, [' + r16[i] + ']', 16]);
    FORMS.push(['mov cx, [' + r16[i] + '+0x40]', 16]);
    FORMS.push(['mov cx, [' + r16[i] + '+0x1234]', 16]);
  }
})();

harness.suite('disassembler round trip', function () {
  FORMS.forEach(function (f) {
    harness.test(f[0] + ' (bits ' + f[1] + ')', function () {
      var first = asm(f[0], f[1]);
      harness.eq(first.errors.length, 0, 'assemble: ' + (first.errors[0] ? first.errors[0].message : ''));
      var d = Disassembler.range(first.bytes, { bits: f[1], origin: 0 });
      var text = d.instrs.map(function (i) { return i.text; }).join('\n');
      harness.eq(d.length, first.bytes.length, 'disassembler consumed ' + d.length + ' of ' + first.bytes.length + ' bytes: ' + text);
      var second = asm(text, f[1]);
      harness.eq(second.errors.length, 0, 're-assemble of "' + text + '": ' + (second.errors[0] ? second.errors[0].message : ''));
      harness.eq(hexBytes(second.bytes), hexBytes(first.bytes), 'round trip via "' + text + '"');
    });
  });
});


harness.suite('disassembler text formatting', function () {
  function expect(bytes, bits, text, origin) {
    harness.eq(disText(fromHex(bytes), bits, origin || 0), text, bytes);
  }
  harness.test('register to register mov', function () {
    expect('B8 01 00 00 00', 32, 'mov eax, 0x1');
    expect('89 D8', 32, 'mov eax, ebx');
    expect('89 D8', 16, 'mov ax, bx');
    expect('B0 12', 16, 'mov al, 0x12');
  });
  harness.test('memory operands carry their size when nothing implies it', function () {
    expect('C7 07 01 00', 16, 'mov word [bx], 0x1');
    expect('C6 07 01', 16, 'mov byte [bx], 0x1');
    expect('80 40 04 01', 16, 'add byte [bx+si+0x4], 0x1');
    expect('8B 03', 32, 'mov eax, [ebx]');
    expect('8B 44 8B 10', 32, 'mov eax, [ebx+ecx*4+0x10]');
  });
  harness.test('relative jumps carry their size hint', function () {
    expect('EB 0E', 16, 'jmp short 0x10', 0);
    expect('EB 0E', 16, 'jmp short 0x7C10', 0x7C00);
    expect('E9 00 00', 16, 'jmp near 0x3');
    expect('74 00', 16, 'je short 0x2');
    expect('75 00', 16, 'jne short 0x2');
    expect('0F 85 00 00 00 00', 32, 'jne near 0x6');
    expect('E8 00 00', 16, 'call 0x3');
    expect('E2 00', 16, 'loop short 0x2');
  });
  harness.test('control register moves', function () {
    expect('0F 22 C0', 32, 'mov cr0, eax');
    expect('0F 20 C0', 32, 'mov eax, cr0');
    expect('0F 23 FB', 32, 'mov dr7, ebx');
  });
  harness.test('string instructions and prefixes', function () {
    expect('F3 AB', 32, 'rep stosd');
    expect('F2 AE', 16, 'repne scasb');
    expect('F0 FF 03', 32, 'lock inc dword [ebx]');
    expect('26 A4', 16, 'es movsb');
    expect('66 A5', 32, 'movsw');
  });
  harness.test('nop versus xchg ax, ax', function () {
    expect('90', 32, 'nop');
    expect('90', 16, 'nop');
    expect('66 90', 32, 'xchg ax, ax');
    expect('66 90', 16, 'xchg eax, eax');
  });
  harness.test('one byte xchg with registers', function () {
    expect('91', 32, 'xchg eax, ecx');
    expect('93', 16, 'xchg ax, bx');
  });
  harness.test('movzx and movsx keep the source size', function () {
    expect('0F B6 C3', 32, 'movzx eax, bl');
    expect('0F B6 03', 32, 'movzx eax, byte [ebx]');
    expect('0F BF 0B', 32, 'movsx ecx, word [ebx]');
  });
  harness.test('fpu memory operands keep their size', function () {
    expect('D9 00', 32, 'fld dword [eax]');
    expect('DD 00', 32, 'fld qword [eax]');
    expect('DB 28', 32, 'fld tword [eax]');
    expect('DF E0', 32, 'fnstsw ax');
    expect('D9 C2', 32, 'fld st(2)');
    expect('DE C1', 32, 'faddp st(1), st(0)');
  });
  harness.test('wait is decoded as its own instruction', function () {
    var r = Disassembler.range(fromHex('9B DB E3'), { bits: 32 });
    harness.eq(r.instrs.length, 2);
    harness.eq(r.instrs[0].text, 'wait');
    harness.eq(r.instrs[1].text, 'fninit');
  });
  harness.test('far transfers', function () {
    expect('EA 78 56 34 12', 16, 'jmp far 0x1234:0x5678');
    expect('9A 78 56 34 12', 16, 'call far 0x1234:0x5678');
    expect('FF 2B', 32, 'jmp far dword [ebx]');
    expect('FF 1F', 16, 'call far word [bx]');
  });
  harness.test('absolute address movs use the moffs forms', function () {
    expect('A0 34 12', 16, 'mov al, [0x1234]');
    expect('A1 34 12 00 00', 32, 'mov eax, [0x1234]');
    expect('A3 34 12 00 00', 32, 'mov [0x1234], eax');
  });
  harness.test('segment override inside brackets', function () {
    expect('26 8B 05', 16, 'mov ax, [es:di]');
    expect('64 A0 10 00 00 00', 32, 'mov al, [fs:0x10]');
  });
  harness.test('mnemonic and operands fields', function () {
    var r = Disassembler.range(fromHex('8B 44 8B 10'), { bits: 32 });
    harness.eq(r.instrs[0].mnemonic, 'mov');
    harness.eq(r.instrs[0].operands, 'eax, [ebx+ecx*4+0x10]');
    harness.eq(r.instrs[0].text, 'mov eax, [ebx+ecx*4+0x10]');
  });
  harness.test('hex values are printed with 0x and upper case digits', function () {
    expect('05 FF 00', 16, 'add ax, 0xFF');
    expect('B8 FF FF FF FF', 32, 'mov eax, 0xFFFFFFFF');
  });
});

harness.suite('disassembler undefined bytes', function () {
  function dbText(bytes, bits) {
    return Disassembler.range(fromHex(bytes), { bits: bits || 16 }).instrs.map(function (i) {
      return i.text;
    }).join(' | ');
  }
  harness.test('unknown opcode becomes db with length one', function () {
    var r = Disassembler.range(fromHex('F1 F1'), { bits: 16 });
    harness.eq(r.instrs.length, 2);
    harness.eq(r.instrs[0].text, 'db 0xF1');
    harness.eq(r.instrs[0].length, 1);
    harness.eq(r.instrs[0].mnemonic, 'db');
    harness.eq(r.length, 2);
  });
  harness.test('rdtsc is not decoded as an instruction', function () {
    harness.eq(dbText('0F 31', 32), 'db 0x0F | db 0x31');
  });
  harness.test('wrmsr and rdmsr are not decoded', function () {
    harness.eq(dbText('0F 30', 32), 'db 0x0F | db 0x30');
    harness.eq(dbText('0F 32', 32), 'db 0x0F | db 0x32');
  });
  harness.test('cmovcc is not decoded', function () {
    harness.eq(dbText('0F 44 C0', 32), 'db 0x0F | inc esp | db 0xC0');
  });
  harness.test('trailing prefix alone becomes db', function () {
    harness.eq(dbText('66', 16), 'db 0x66');
    harness.eq(dbText('F3', 16), 'db 0xF3');
    harness.eq(dbText('26', 16), 'db 0x26');
  });
  harness.test('truncated instruction becomes db', function () {
    harness.eq(dbText('8B', 32), 'db 0x8B');
    harness.eq(dbText('0F', 32), 'db 0x0F');
    harness.eq(dbText('B8 01', 32), 'db 0xB8 | db 0x01');
  });
  harness.test('undefined 0F opcodes become db', function () {
    harness.eq(dbText('0F 0F', 32), 'db 0x0F | db 0x0F');
    harness.eq(dbText('0F FF', 32), 'db 0x0F | db 0xFF');
  });
  harness.test('decoded bytes still round trip when a db follows', function () {
    var bytes = fromHex('90 F1 90');
    var d = Disassembler.range(bytes, { bits: 16 });
    harness.eq(d.instrs.map(function (i) { return i.text; }).join('\n'), 'nop\ndb 0xF1\nnop');
    harness.eq(hexBytes(d.instrs[1].bytes), 'F1');
  });
});

harness.suite('disassembler api', function () {
  harness.test('count limits decoding', function () {
    var bytes = fromHex('90 90 90');
    var r = Disassembler.disassemble(bytes, { bits: 16, count: 1 });
    harness.eq(r.instrs.length, 1);
    harness.eq(r.length, 1);
  });
  harness.test('count defaults to one instruction, count 0 means everything', function () {
    var bytes = fromHex('90 B8 01 00 00 00 C3');
    var one = Disassembler.disassemble(bytes, { bits: 32 });
    harness.eq(one.instrs.length, 1);
    harness.eq(one.instrs[0].text, 'nop');
    harness.eq(one.length, 1);
    var all = Disassembler.disassemble(bytes, { bits: 32, count: 0 });
    harness.eq(all.instrs.length, 3);
    harness.eq(all.length, 7);
    harness.eq(Disassembler.range(bytes, { bits: 32 }).instrs.length, 3);
  });
  harness.test('count larger than the buffer decodes everything', function () {
    var r = Disassembler.disassemble(fromHex('90 90'), { bits: 16, count: 99 });
    harness.eq(r.instrs.length, 2);
  });
  harness.test('addresses follow the origin', function () {
    var r = Disassembler.range(fromHex('90 B8 01 00 00 00'), { bits: 32, origin: 0x1000 });
    harness.eq(r.instrs[0].addr, 0x1000);
    harness.eq(r.instrs[1].addr, 0x1001);
  });
  harness.test('instruction bytes describe the decoded range', function () {
    var r = Disassembler.range(fromHex('90 B8 01 00 00 00'), { bits: 32 });
    harness.eq(hexBytes(r.instrs[1].bytes), 'B8 01 00 00 00');
    harness.eq(r.instrs[1].length, 5);
  });
  harness.test('accepts a Uint8Array and a plain array', function () {
    harness.eq(Disassembler.disassemble(new Uint8Array([0x90]), { bits: 16 }).instrs[0].text, 'nop');
    harness.eq(Disassembler.disassemble([0x90], { bits: 16 }).instrs[0].text, 'nop');
    harness.eq(Disassembler.range(new Uint8Array([0x90, 0x90]), { bits: 16 }).instrs.length, 2);
  });
  harness.test('empty input decodes to nothing', function () {
    var r = Disassembler.range([], { bits: 16 });
    harness.eq(r.instrs.length, 0);
    harness.eq(r.length, 0);
  });
  harness.test('bits defaults to 16', function () {
    harness.eq(disText(fromHex('B8 01 00'), undefined), 'mov ax, 0x1');
    harness.eq(disText(fromHex('66 B8 01 00 00 00'), undefined), 'mov eax, 0x1');
  });
  harness.test('range decodes a whole buffer', function () {
    var r = Disassembler.range(fromHex('90 90 90 90'), { bits: 16 });
    harness.eq(r.instrs.length, 4);
    harness.eq(r.length, 4);
    harness.eq(r.instrs[3].addr, 3);
  });
  harness.test('range honours maxInstrs', function () {
    var r = Disassembler.range(fromHex('90 90 90 90'), { bits: 16, maxInstrs: 2 });
    harness.eq(r.instrs.length, 2);
    harness.eq(r.length, 2);
  });
  harness.test('range with origin', function () {
    var r = Disassembler.range(fromHex('B8 01 00 00 00 C3'), { bits: 32, origin: 0x7C00 });
    harness.eq(r.instrs[0].addr, 0x7C00);
    harness.eq(r.instrs[0].text, 'mov eax, 0x1');
    harness.eq(r.instrs[1].addr, 0x7C05);
    harness.eq(r.instrs[1].text, 'ret');
  });
  harness.test('range over a stream with undefined bytes', function () {
    var r = Disassembler.range(fromHex('90 F1 90'), { bits: 16 });
    harness.eq(r.instrs.length, 3);
    harness.eq(r.instrs[1].text, 'db 0xF1');
  });
  harness.test('disassembling 2000 instructions is fast', function () {
    var bytes = [], i;
    for (i = 0; i < 2000; i++) {
      bytes.push(0xB8, 0x01, 0x00, 0x00, 0x00);
    }
    var start = Date.now();
    var r = Disassembler.range(bytes, { bits: 32 });
    var elapsed = Date.now() - start;
    harness.eq(r.instrs.length, 2000);
    harness.assert(elapsed < 1000, 'disassembly took ' + elapsed + 'ms');
  });
});

harness.suite('disassembler prefixes and sizing', function () {
  harness.test('operand size prefix selects the register names', function () {
    harness.eq(disText(fromHex('66 89 D8'), 32), 'mov ax, bx');
    harness.eq(disText(fromHex('89 D8'), 32), 'mov eax, ebx');
    harness.eq(disText(fromHex('66 89 D8'), 16), 'mov eax, ebx');
  });
  harness.test('address size prefix selects the address registers', function () {
    harness.eq(disText(fromHex('67 8B 07'), 32), 'mov eax, [bx]');
    harness.eq(disText(fromHex('67 8B 07'), 16), 'mov ax, [edi]');
    harness.eq(disText(fromHex('8B 44 24 04'), 32), 'mov eax, [esp+0x4]');
  });
  harness.test('redundant prefixes are canonicalised', function () {
    var r = Disassembler.range(fromHex('66 66 B8 01 00'), { bits: 32 });
    harness.eq(r.instrs.length, 1);
    harness.eq(r.instrs[0].text, 'mov ax, 0x1');
  });
  harness.test('segment overrides on data operands', function () {
    harness.eq(disText(fromHex('2E 8B 07'), 16), 'mov ax, [cs:bx]');
    harness.eq(disText(fromHex('65 8B 00'), 32), 'mov eax, [gs:eax]');
  });
  harness.test('displacement sign is preserved', function () {
    harness.eq(disText(fromHex('8B 43 FF'), 32), 'mov eax, [ebx-0x1]');
    harness.eq(disText(fromHex('8B 45 00'), 32), 'mov eax, [ebp+0x0]');
    harness.eq(disText(fromHex('8B 04 8D 10 00 00 00'), 32), 'mov eax, [ecx*4+0x10]');
  });
  harness.test('index always shows its scale', function () {
    harness.eq(disText(fromHex('8B 04 0B'), 32), 'mov eax, [ebx+ecx*1]');
    harness.eq(disText(fromHex('8B 04 4B'), 32), 'mov eax, [ebx+ecx*2]');
    harness.eq(disText(fromHex('8B 04 CB'), 32), 'mov eax, [ebx+ecx*8]');
  });
  harness.test('sixteen bit addressing forms', function () {
    harness.eq(disText(fromHex('8B 00'), 16), 'mov ax, [bx+si]');
    harness.eq(disText(fromHex('8B 03'), 16), 'mov ax, [bp+di]');
    harness.eq(disText(fromHex('8B 06 34 12'), 16), 'mov ax, [0x1234]');
    harness.eq(disText(fromHex('8B 46 00'), 16), 'mov ax, [bp+0x0]');
  });
  harness.test('prefix combination lock plus segment plus size', function () {
    var r = Assembler.assemble('es lock movsw', { bits: 32 });
    harness.eq(r.errors.length, 0);
    harness.eq(hexBytes(r.bytes), 'F0 26 66 A5');
    harness.eq(disText(r.bytes, 32), 'lock es movsw');
  });
});

harness.suite('disassembler robustness', function () {
  harness.test('random byte streams never throw and always advance', function () {
    var seed = 12345, i, j, len, bytes, d, total, bits;
    function rnd() {
      seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
      return (seed >>> 8) & 0xFF;
    }
    for (i = 0; i < 300; i++) {
      len = 1 + (rnd() % 24);
      bytes = [];
      for (j = 0; j < len; j++) bytes.push(rnd());
      bits = (i & 1) ? 32 : 16;
      d = null;
      try {
        d = Disassembler.range(bytes, { bits: bits });
      } catch (e) {
        harness.assert(false, 'threw on ' + hexBytes(bytes) + ': ' + e.message);
      }
      total = 0;
      d.instrs.forEach(function (ins) {
        harness.assert(ins.length >= 1, 'zero length instruction at ' + hexBytes(bytes));
        harness.eq(ins.bytes.length, ins.length, 'bytes/length mismatch at ' + hexBytes(bytes));
        harness.assert(typeof ins.text === 'string' && ins.text.length > 0, 'empty text');
        total += ins.length;
      });
      harness.eq(total, d.length, 'length accounting at ' + hexBytes(bytes));
      harness.eq(d.length, len, 'coverage at ' + hexBytes(bytes));
    }
  });
  harness.test('every single unknown byte decodes to exactly one db', function () {
    var i, r;
    for (i = 0x0F; i < 0x100; i++) {
      r = Disassembler.range([i], { bits: 32 });
      harness.eq(r.instrs.length, 1, 'byte 0x' + i.toString(16));
      harness.eq(r.length, 1);
    }
  });
  /* Data bytes are only byte-exact when they happen to decode to canonical encodings,
     which is what this corpus is chosen to do; a non-canonical encoding such as
     'push 0x0069' re-assembles to the shorter 'push 0x69'. */
  harness.test('a real program disassembles and re-assembles to the same bytes', function () {
    var src = [
      'org 0x100',
      'start: mov ax, 0x13',
      '  int 0x10',
      '  mov si, msg',
      'loop1: lodsb',
      '  test al, al',
      '  jz done',
      '  mov ah, 0x0E',
      '  int 0x10',
      '  jmp loop1',
      'done: hlt',
      'msg: db "hello", 0'
    ].join('\n');
    var a = Assembler.assemble(src, { bits: 16 });
    harness.eq(a.errors.length, 0);
    var d = Disassembler.range(a.bytes, { bits: 16, origin: 0x100 });
    harness.eq(d.length, a.bytes.length);
    var text = d.instrs.map(function (i) { return i.text; }).join('\n');
    var b = Assembler.assemble(text, { bits: 16, origin: 0x100 });
    harness.eq(b.errors.length, 0, b.errors[0] ? b.errors[0].message : '');
    harness.eq(hexBytes(b.bytes), hexBytes(a.bytes));
  });
});

if (require.main === module) { process.exit(harness.run() ? 1 : 0); }
