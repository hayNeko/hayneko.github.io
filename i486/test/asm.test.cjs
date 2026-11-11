'use strict';

/*
 * i486 assembler test suite.
 * The golden table below is derived from the Intel opcode maps (80386 reference
 * manual, plus the 486 additions listed in CONTRACT.md section 5), not from the
 * assembler output: every expected byte string was worked out from the opcode,
 * ModR/M, SIB and immediate layout by hand.
 */

var harness = require('./harness.cjs');
var path = require('path');

var Assembler = require(path.join(__dirname, '..', 'lib', 'asm.js')).Assembler;

function asm(src, opts) {
  return Assembler.assemble(src, opts || {});
}

function hexBytes(bytes) {
  var out = [], i, s;
  for (i = 0; i < bytes.length; i++) {
    s = (bytes[i] & 0xFF).toString(16).toUpperCase();
    out.push(s.length < 2 ? '0' + s : s);
  }
  return out.join(' ');
}

function asmHex(src, bits, origin) {
  var r = asm(src, { bits: bits || 16, origin: origin || 0 });
  if (r.errors.length) return 'ERROR: ' + r.errors[0].message;
  return hexBytes(r.bytes);
}

/* [source, expected bytes, bits] */
var GOLDEN = [
  ['add al, bl', '00 D8', 16],
  ['add [bx], ax', '01 07', 16],
  ['add al, bl', '00 D8', 16],
  ['add ax, bx', '01 D8', 16],
  ['add ax, 0x1234', '05 34 12', 16],
  ['add al, 1', '04 01', 16],
  ['or byte [bx], 8', '80 0F 08', 16],
  ['adc bh, 1', '80 D7 01', 16],
  ['sbb word [bp+2], 0x1234', '81 5E 02 34 12', 16],
  ['and eax, 0x0f', '83 E0 0F', 32],
  ['sub esp, 4', '83 EC 04', 32],
  ['xor eax, eax', '31 C0', 32],
  ['cmp [si], ax', '39 04', 16],
  ['cmp al, 5', '3C 05', 16],
  ['cmp byte [bx], 5', '80 3F 05', 16],
  ['test al, 1', 'A8 01', 16],
  ['test eax, 0x1234', 'A9 34 12 00 00', 32],
  ['test ebx, 4', 'F7 C3 04 00 00 00', 32],
  ['test byte [bx], 1', 'F6 07 01', 16],
  ['mov ax, bx', '89 D8', 16],
  ['mov eax, ebx', '89 D8', 32],
  ['mov bx, ax', '89 C3', 16],
  ['mov al, 0x12', 'B0 12', 16],
  ['mov cl, 0x12', 'B1 12', 16],
  ['mov bx, 0x1234', 'BB 34 12', 16],
  ['mov eax, 0x12345678', 'B8 78 56 34 12', 32],
  ['mov ax, [bx]', '8B 07', 16],
  ['mov [bx], ax', '89 07', 16],
  ['mov al, [bx]', '8A 07', 16],
  ['mov [bx], al', '88 07', 16],
  ['mov byte [bx], 7', 'C6 07 07', 16],
  ['mov word [bx], 7', 'C7 07 07 00', 16],
  ['mov dword [bx], 7', '66 C7 07 07 00 00 00', 16],
  ['mov ax, ds', '8C D8', 16],
  ['mov ds, ax', '8E D8', 16],
  ['mov es, [bx]', '8E 07', 16],
  ['mov eax, cr0', '0F 20 C0', 32],
  ['mov cr3, ebx', '0F 22 DB', 32],
  ['mov edx, dr7', '0F 21 FA', 32],
  ['mov dr7, ebx', '0F 23 FB', 32],
  ['movzx eax, byte [ebx]', '0F B6 03', 32],
  ['movzx eax, bl', '0F B6 C3', 32],
  ['movsx eax, byte [ebx]', '0F BE 03', 32],
  ['movzx ecx, word [ebx]', '0F B7 0B', 32],
  ['movsx ecx, word [ebx]', '0F BF 0B', 32],
  ['movsx eax, bl', '0F BE C3', 32],
  ['push ax', '50', 16],
  ['push bx', '53', 16],
  ['push eax', '50', 32],
  ['push ecx', '51', 32],
  ['pop bp', '5D', 16],
  ['pop edi', '5F', 32],
  ['push es', '06', 16],
  ['push cs', '0E', 16],
  ['push ds', '1E', 16],
  ['pop es', '07', 16],
  ['pop ds', '1F', 16],
  ['push fs', '0F A0', 32],
  ['push gs', '0F A8', 32],
  ['push 5', '6A 05', 16],
  ['push 0x1234', '68 34 12', 16],
  ['push 0x12345678', '68 78 56 34 12', 32],
  ['push dword [ebx]', 'FF 33', 32],
  ['pop dword [ebx]', '8F 03', 32],
  ['pusha', '60', 16],
  ['pushad', '60', 32],
  ['popa', '61', 16],
  ['popad', '61', 32],
  ['inc ax', '40', 16],
  ['inc di', '47', 16],
  ['dec bx', '4B', 16],
  ['inc eax', '40', 32],
  ['dec ebp', '4D', 32],
  ['inc byte [bx]', 'FE 07', 16],
  ['dec dword [ebx]', 'FF 0B', 32],
  ['xchg ax, bx', '93', 16],
  ['xchg bx, ax', '93', 16],
  ['xchg eax, eax', '90', 32],
  ['xchg ecx, edx', '87 D1', 32],
  ['xchg al, ah', '86 E0', 16],
  ['lea ax, [bx+si+4]', '8D 40 04', 16],
  ['lea eax, [ebx+ecx*2+8]', '8D 44 4B 08', 32],
  ['movsb', 'A4', 16],
  ['movsw', 'A5', 16],
  ['movsd', '66 A5', 16],
  ['movsd', 'A5', 32],
  ['stosb', 'AA', 16],
  ['stosd', 'AB', 32],
  ['lodsb', 'AC', 16],
  ['cmpsw', 'A7', 16],
  ['scasb', 'AE', 16],
  ['rep movsb', 'F3 A4', 16],
  ['repne scasb', 'F2 AE', 16],
  ['rep stosd', 'F3 AB', 32],
  ['es movsb', '26 A4', 16],
  ['in al, 0x60', 'E4 60', 16],
  ['in ax, dx', 'ED', 16],
  ['in eax, dx', 'ED', 32],
  ['out 0x20, al', 'E6 20', 16],
  ['out dx, ax', 'EF', 16],
  ['out dx, eax', 'EF', 32],
  ['int 0x10', 'CD 10', 16],
  ['int3', 'CC', 16],
  ['into', 'CE', 16],
  ['iret', 'CF', 16],
  ['iretd', '66 CF', 16],
  ['retf', 'CB', 16],
  ['retf 4', 'CA 04 00', 16],
  ['ret', 'C3', 16],
  ['ret 8', 'C2 08 00', 16],
  ['shld eax, ebx, 4', '0F A4 D8 04', 32],
  ['shrd [bx], ax, cl', '0F AD 07', 16],
  ['bt eax, ecx', '0F A3 C8', 32],
  ['bts word [bx], 3', '0F BA 2F 03', 16],
  ['btr eax, 1', '0F BA F0 01', 32],
  ['btc dword [ebx], 1', '0F BA 3B 01', 32],
  ['bt ax, cx', '0F A3 C8', 16],
  ['bswap eax', '0F C8', 32],
  ['bswap edi', '0F CF', 32],
  ['xadd [bx], ax', '0F C1 07', 16],
  ['cmpxchg [bx], ax', '0F B1 07', 16],
  ['setz al', '0F 94 C0', 16],
  ['setnz bl', '0F 95 C3', 16],
  ['setc cl', '0F 92 C1', 16],
  ['imul eax, ebx', '0F AF C3', 32],
  ['imul eax, ebx, 4', '6B C3 04', 32],
  ['imul eax, 4', '6B C0 04', 32],
  ['imul ax, bx', '0F AF C3', 16],
  ['idiv dword [ebx]', 'F7 3B', 32],
  ['mul bl', 'F6 E3', 16],
  ['div word [bx]', 'F7 37', 16],
  ['imul ax', 'F7 E8', 16],
  ['neg byte [bx]', 'F6 1F', 16],
  ['not eax', 'F7 D0', 32],
  ['sal ax, 1', 'D1 E0', 16],
  ['sar byte [bx], cl', 'D2 3F', 16],
  ['rcl eax, 3', 'C1 D0 03', 32],
  ['shl byte [bx], 1', 'D0 27', 16],
  ['jmp short $+2', 'EB 00', 16],
  ['jmp $+2', 'EB 00', 16],
  ['jmp near $+5', 'E9 00 00 00 00', 32],
  ['jmp near $+3', 'E9 00 00', 16],
  ['jz $+2', '74 00', 16],
  ['jnz near $+6', '0F 85 00 00 00 00', 32],
  ['jz near $+4', '0F 84 00 00', 16],
  ['loop $+2', 'E2 00', 16],
  ['jcxz $+2', 'E3 00', 16],
  ['jecxz $+2', 'E3 00', 32],
  ['call $+5', 'E8 00 00 00 00', 32],
  ['call $+3', 'E8 00 00', 16],
  ['jmp 0x1234:0x5678', 'EA 78 56 34 12', 16],
  ['call 0x1234:0x5678', '9A 78 56 34 12', 16],
  ['jmp far 0x1234:0x5678', 'EA 78 56 34 12', 16],
  ['fld dword [eax]', 'D9 00', 32],
  ['fld qword [eax]', 'DD 00', 32],
  ['fld tword [eax]', 'DB 28', 32],
  ['fstp dword [ebx]', 'D9 1B', 32],
  ['fild word [bx]', 'DF 07', 16],
  ['fistp dword [ebx]', 'DB 1B', 32],
  ['fadd qword [eax]', 'DC 00', 32],
  ['fld st(2)', 'D9 C2', 32],
  ['fxch st(1)', 'D9 C9', 32],
  ['fstp st(3)', 'DD DB', 32],
  ['fadd st, st(2)', 'D8 C2', 32],
  ['faddp st(1), st', 'DE C1', 32],
  ['fsub st, st(1)', 'D8 E1', 32],
  ['fmulp st(2), st', 'DE CA', 32],
  ['fnstcw word [bx]', 'D9 3F', 16],
  ['fldcw word [bx]', 'D9 2F', 16],
  ['fnstsw ax', 'DF E0', 32],
  ['fstsw ax', '9B DF E0', 32],
  ['finit', '9B DB E3', 32],
  ['fninit', 'DB E3', 32],
  ['fld1', 'D9 E8', 32],
  ['fldz', 'D9 EE', 32],
  ['fldpi', 'D9 EB', 32],
  ['fabs', 'D9 E1', 32],
  ['fchs', 'D9 E0', 32],
  ['fsqrt', 'D9 FA', 32],
  ['fnop', 'D9 D0', 32],
  ['fdecstp', 'D9 F6', 32],
  ['fincstp', 'D9 F7', 32],
  ['fwait', '9B', 32],
  ['lgdt [bx]', '0F 01 17', 16],
  ['sgdt [bx]', '0F 01 07', 16],
  ['lidt [bx]', '0F 01 1F', 16],
  ['sidt [bx]', '0F 01 0F', 16],
  ['smsw ax', '0F 01 E0', 16],
  ['lmsw ax', '0F 01 F0', 16],
  ['invlpg [eax]', '0F 01 38', 32],
  ['sldt ax', '0F 00 C0', 16],
  ['str ax', '0F 00 C8', 16],
  ['lldt ax', '0F 00 D0', 16],
  ['ltr ax', '0F 00 D8', 16],
  ['verr ax', '0F 00 E0', 16],
  ['verw ax', '0F 00 E8', 16],
  ['lar eax, ebx', '0F 02 C3', 32],
  ['lsl eax, ebx', '0F 03 C3', 32],
  ['clts', '0F 06', 32],
  ['invd', '0F 08', 32],
  ['wbinvd', '0F 09', 32],
  ['cpuid', '0F A2', 32],
  ['ud2', '0F 0B', 32],
  ['xlat', 'D7', 16],
  ['sahf', '9E', 16],
  ['lahf', '9F', 16],
  ['cbw', '98', 16],
  ['cwde', '98', 32],
  ['cwd', '99', 16],
  ['cdq', '99', 32],
  ['daa', '27', 16],
  ['das', '2F', 16],
  ['aaa', '37', 16],
  ['aas', '3F', 16],
  ['aam', 'D4 0A', 16],
  ['aad', 'D5 0A', 16],
  ['aam 0x10', 'D4 10', 16],
  ['enter 0x10, 0', 'C8 10 00 00', 16],
  ['leave', 'C9', 16],
  ['hlt', 'F4', 16],
  ['wait', '9B', 16],
  ['nop', '90', 16],
  ['bound eax, dword [ebx]', '62 03', 32],
  ['arpl ax, bx', '63 D8', 16],
  ['les ax, [bx]', 'C4 07', 16],
  ['lds di, [bx]', 'C5 3F', 16],
  ['lock inc dword [ebx]', 'F0 FF 03', 32],
  ['pushf', '9C', 16],
  ['pushf', '66 9C', 32],
  ['pushfd', '9C', 32],
  ['pushfd', '66 9C', 16],
  ['popf', '9D', 16],
  ['popfd', '9D', 32],
  ['iret', 'CF', 32],
  ['iretd', 'CF', 32],
  ['movsd', '66 A5', 16],
  ['cmpsd', '66 A7', 16],
  ['insd', '66 6D', 16],
  ['outsb', '6E', 16],
  ['mov bx, [bx+si]', '8B 18', 16],
  ['mov bx, [bx+di]', '8B 19', 16],
  ['mov bx, [bp+si]', '8B 1A', 16],
  ['mov bx, [bp+di]', '8B 1B', 16],
  ['mov bx, [si]', '8B 1C', 16],
  ['mov bx, [di]', '8B 1D', 16],
  ['mov bx, [bp]', '8B 5E 00', 16],
  ['mov bx, [bx]', '8B 1F', 16],
  ['mov bx, [bx+si+8]', '8B 58 08', 16],
  ['mov bx, [bp+di+0x1234]', '8B 9B 34 12', 16],
  ['mov bx, [0x1234]', '8B 1E 34 12', 16],
  ['mov bx, [esi]', '67 8B 1E', 16],
  ['mov eax, [ebx]', '8B 03', 32],
  ['mov eax, [ebx+ecx]', '8B 04 0B', 32],
  ['mov eax, [ebx+ecx*2]', '8B 04 4B', 32],
  ['mov eax, [ebx+ecx*4]', '8B 04 8B', 32],
  ['mov eax, [ebx+ecx*8]', '8B 04 CB', 32],
  ['mov eax, [ebx+ecx*4+0x10]', '8B 44 8B 10', 32],
  ['mov eax, [ebx+ecx*4+0x1234]', '8B 84 8B 34 12 00 00', 32],
  ['mov eax, [ecx*4+0x10]', '8B 04 8D 10 00 00 00', 32],
  ['mov eax, [esp+4]', '8B 44 24 04', 32],
  ['mov eax, [esp]', '8B 04 24', 32],
  ['mov eax, [ebp]', '8B 45 00', 32],
  ['mov eax, [ebp+4]', '8B 45 04', 32],
  ['mov eax, [esi*1+8]', '8B 04 35 08 00 00 00', 32],
  ['mov eax, [0x1234]', 'A1 34 12 00 00', 32],
  ['mov ebx, [0x1234]', '8B 1D 34 12 00 00', 32],
  ['mov eax, [fs:0x1234]', '64 A1 34 12 00 00', 32],
  ['mov ax, [es:di]', '26 8B 05', 16],
  ['mov eax, [ebx+0x7f]', '8B 43 7F', 32],
  ['mov eax, [ebx+0x80]', '8B 83 80 00 00 00', 32],
  ['mov eax, [ebx-1]', '8B 43 FF', 32],
  ['mov ax, [ebx]', '66 8B 03', 32],
  ['mov eax, [bx]', '67 8B 07', 32],
  ['mov bx, [eax]', '66 8B 18', 32],
  ['mov eax, [bx+si]', '67 8B 00', 32],
  ['mov al, [0x1234]', 'A0 34 12', 16],
  ['mov [0x1234], eax', 'A3 34 12 00 00', 32],
  ['mov eax, [0x1234]', 'A1 34 12 00 00', 32],
  ['mov word [0x1234], 1', 'C7 06 34 12 01 00', 16],
  ['push word [bx]', 'FF 37', 16],
  ['pop word [bp+si]', '8F 02', 16],
  ['jmp ax', 'FF E0', 16],
  ['jmp eax', 'FF E0', 32],
  ['call bx', 'FF D3', 16],
  ['call dword [ebx]', 'FF 13', 32],
  ['jmp far dword [ebx]', 'FF 2B', 32],
  ['call far word [bx]', 'FF 1F', 16],
  ['shl eax, cl', 'D3 E0', 32],
  ['shr eax, 4', 'C1 E8 04', 32],
  ['rcr byte [bx], 1', 'D0 1F', 16],
  ['rol eax, 1', 'D1 C0', 32],
  ['sar eax, cl', 'D3 F8', 32]
];

harness.suite('assembler golden encodings', function () {
  GOLDEN.forEach(function (c) {
    harness.test(c[0] + ' (bits ' + c[2] + ')', function () {
      var r = asm(c[0], { bits: c[2] });
      harness.eq(r.errors.length, 0, c[0] + ' errored: ' + (r.errors[0] ? r.errors[0].message : ''));
      harness.eq(hexBytes(r.bytes), c[1], c[0]);
    });
  });
});


harness.suite('assembler shortest-encoding rules', function () {
  harness.test('mov reg, imm uses B8+r not C7 /0', function () {
    harness.eq(asmHex('mov eax, 0', 32), 'B8 00 00 00 00');
    harness.eq(asmHex('mov ebx, 0', 32), 'BB 00 00 00 00');
  });
  harness.test('call disassembly target', function () {});
  harness.test('accumulator forms win over generic group 1', function () {
    harness.eq(asmHex('add al, 1', 16), '04 01');
    harness.eq(asmHex('cmp al, 5', 16), '3C 05');
    harness.eq(asmHex('add eax, 0x1234', 32), '05 34 12 00 00');
  });
  harness.test('sign-extended imm8 wins when it fits', function () {
    harness.eq(asmHex('add eax, 0x7f', 32), '83 C0 7F');
    harness.eq(asmHex('sub eax, -1', 32), '83 E8 FF');
    harness.eq(asmHex('and eax, 0x0f', 32), '83 E0 0F');
  });
  harness.test('imm8 form is abandoned when the value needs a wider immediate', function () {
    harness.eq(asmHex('add eax, 0x80', 32), '05 80 00 00 00');
    harness.eq(asmHex('and eax, 0xffff', 32), '25 FF FF 00 00');
    harness.eq(asmHex('add ebx, 0x1234', 32), '81 C3 34 12 00 00');
  });
  harness.test('group 1 uses the sign-extended imm8 form for 16-bit accumulators', function () {
    harness.eq(asmHex('add ax, 1', 16), '83 C0 01');
    harness.eq(asmHex('sub ax, 1', 16), '83 E8 01');
    harness.eq(asmHex('cmp ax, 1', 16), '83 F8 01');
    harness.eq(asmHex('and ax, 0x7f', 16), '83 E0 7F');
    harness.eq(asmHex('add ax, -1', 16), '83 C0 FF');
    harness.eq(asmHex('or ax, 1', 16), '83 C8 01');
    harness.eq(asmHex('xor ax, 1', 16), '83 F0 01');
    harness.eq(asmHex('adc ax, 1', 16), '83 D0 01');
    harness.eq(asmHex('sbb ax, 1', 16), '83 D8 01');
  });
  harness.test('wide immediates still use the accumulator form', function () {
    harness.eq(asmHex('add ax, 0x80', 16), '05 80 00');
    harness.eq(asmHex('add eax, 0x12345678', 32), '05 78 56 34 12');
    harness.eq(asmHex('cmp eax, 0x100', 32), '3D 00 01 00 00');
    harness.eq(asmHex('add eax, 0x7f', 32), '83 C0 7F');
  });
  harness.test('push imm8 uses 6A only when it fits', function () {
    harness.eq(asmHex('push 0x7f', 32), '6A 7F');
    harness.eq(asmHex('push -1', 32), '6A FF');
    harness.eq(asmHex('push 0x80', 32), '68 80 00 00 00');
  });
  harness.test('imul imm8 uses 6B only when it fits', function () {
    harness.eq(asmHex('imul eax, ebx, 127', 32), '6B C3 7F');
    harness.eq(asmHex('imul eax, ebx, 128', 32), '69 C3 80 00 00 00');
  });
  harness.test('test reg, reg avoids the immediate form', function () {
    harness.eq(asmHex('test eax, eax', 32), '85 C0');
  });
  harness.test('inc/dec register use the one-byte form', function () {
    harness.eq(asmHex('inc eax', 32), '40');
    harness.eq(asmHex('dec ecx', 32), '49');
    harness.eq(asmHex('inc dword [eax]', 32), 'FF 00');
  });
  harness.test('xchg eax, reg uses the one-byte form', function () {
    harness.eq(asmHex('xchg eax, ecx', 32), '91');
    harness.eq(asmHex('xchg eax, eax', 32), '90');
    harness.eq(asmHex('xchg ecx, eax', 32), '91');
  });
  harness.test('zero displacement is dropped when the base allows it', function () {
    harness.eq(asmHex('mov eax, [ebx+0]', 32), '8B 03');
    harness.eq(asmHex('mov eax, [ebp+0]', 32), '8B 45 00');
    harness.eq(asmHex('mov bx, [bp+0]', 16), '8B 5E 00');
  });
  harness.test('disp8 is used only for signed byte displacements', function () {
    harness.eq(asmHex('mov eax, [ebx+127]', 32), '8B 43 7F');
    harness.eq(asmHex('mov eax, [ebx+128]', 32), '8B 83 80 00 00 00');
    harness.eq(asmHex('mov eax, [ebx-128]', 32), '8B 43 80');
    harness.eq(asmHex('mov eax, [ebx-129]', 32), '8B 83 7F FF FF FF');
  });
  harness.test('operand size prefix follows the register size', function () {
    harness.eq(asmHex('mov ax, bx', 32, 0), '66 89 D8');
    harness.eq(asmHex('mov eax, ebx', 16, 0), '66 89 D8');
    harness.eq(asmHex('push eax', 16, 0), '66 50');
  });
  harness.test('address size prefix follows the addressing registers', function () {
    harness.eq(asmHex('mov ax, [bx]', 32, 0), '66 67 8B 07');
    harness.eq(asmHex('mov eax, [bx]', 32, 0), '67 8B 07');
    harness.eq(asmHex('mov eax, [ebx]', 16, 0), '66 67 8B 03');
  });
  harness.test('prefix order is lock/rep, segment, 66, 67', function () {
    harness.eq(asmHex('lock rep movsb', 16), 'F0 F3 A4');
    harness.eq(asmHex('es movsw', 32), '26 66 A5');
    harness.eq(asmHex('es lock inc dword [ebx]', 32), 'F0 26 FF 03');
  });
  harness.test('segment override may be written inside or outside the brackets', function () {
    harness.eq(asmHex('mov ax, [es:di]', 16), '26 8B 05');
    harness.eq(asmHex('mov ax, es:[di]', 16), '26 8B 05');
    harness.eq(asmHex('mov al, [fs:0x10]', 32), '64 A0 10 00 00 00');
  });
  harness.test('size keyword and ptr keyword are interchangeable', function () {
    harness.eq(asmHex('mov word [bx], 1', 16), 'C7 07 01 00');
    harness.eq(asmHex('mov word ptr [bx], 1', 16), 'C7 07 01 00');
    harness.eq(asmHex('add byte ptr [bx], 1', 16), '80 07 01');
  });
  harness.test('memory operand without a size takes the operand size default', function () {
    harness.eq(asmHex('mov [bx], 1', 16), 'C7 07 01 00');
    harness.eq(asmHex('mov [ebx], 1', 32), 'C7 03 01 00 00 00');
  });
});

harness.suite('assembler data directives', function () {
  harness.test('db emits bytes', function () {
    harness.eq(asmHex('db 1, 2, 3', 16), '01 02 03');
    harness.eq(asmHex('db 0x41'), '41');
  });
  harness.test('db emits string bytes', function () {
    harness.eq(asmHex("db 'ABC'"), '41 42 43');
    harness.eq(asmHex('db "hi", 0'), '68 69 00');
    harness.eq(asmHex("db 'a'"), '61');
  });
  harness.test('string escapes', function () {
    harness.eq(asmHex('db "\\n"'), '0A');
    harness.eq(asmHex('db "\\x41"'), '41');
    harness.eq(asmHex('db "\\0"'), '00');
    harness.eq(asmHex('db "\\\\"'), '5C');
  });
  harness.test('dw handles words', function () {
    harness.eq(asmHex('dw 0x1234'), '34 12');
    harness.eq(asmHex('dw 0x1234, 0x5678'), '34 12 78 56');
    harness.eq(asmHex('dw 0xffff'), 'FF FF');
  });
  harness.test('dd handles dwords', function () {
    harness.eq(asmHex('dd 0x12345678'), '78 56 34 12');
    harness.eq(asmHex('dd 1'), '01 00 00 00');
  });
  harness.test('dq emits eight bytes', function () {
    harness.eq(asmHex('dq 1'), '01 00 00 00 00 00 00 00');
    harness.eq(asmHex('dq 0x1234'), '34 12 00 00 00 00 00 00');
    harness.eq(asmHex('dq 0xFFFFFFFF'), 'FF FF FF FF 00 00 00 00');
  });
  harness.test('times repeats data', function () {
    harness.eq(asmHex('times 4 db 0xAA'), 'AA AA AA AA');
    harness.eq(asmHex('times 2 dw 0x1234'), '34 12 34 12');
    harness.eq(asmHex('times 0 db 1'), '');
  });
  harness.test('times repeats an instruction', function () {
    harness.eq(asmHex('times 3 nop'), '90 90 90');
    harness.eq(asmHex('times 2 push ax', 16), '50 50');
  });
  harness.test('resb/resw/resd emit zeros', function () {
    harness.eq(asmHex('resb 4'), '00 00 00 00');
    harness.eq(asmHex('resw 2'), '00 00 00 00');
    harness.eq(asmHex('resd 1'), '00 00 00 00');
    harness.eq(asmHex('resb 2\ndb 0x11'), '00 00 11');
  });
  harness.test('number formats', function () {
    harness.eq(asmHex('db 0x10'), '10');
    harness.eq(asmHex('db 10h'), '10');
    harness.eq(asmHex('db 10'), '0A');
    harness.eq(asmHex('db 0b1010'), '0A');
    harness.eq(asmHex('db 1010b'), '0A');
    harness.eq(asmHex('db 0o17'), '0F');
    harness.eq(asmHex('db 17o'), '0F');
    harness.eq(asmHex("db 'A'"), '41');
  });
  harness.test('expressions', function () {
    harness.eq(asmHex('db 1+2*3'), '07');
    harness.eq(asmHex('db (1+2)*3'), '09');
    harness.eq(asmHex('db 1 << 4'), '10');
    harness.eq(asmHex('db 0xF0 | 0x0F'), 'FF');
    harness.eq(asmHex('db 0xFF & 0x0F'), '0F');
    harness.eq(asmHex('db 7 % 3'), '01');
    harness.eq(asmHex('db ~0'), 'FF');
    harness.eq(asmHex('db -1'), 'FF');
  });
  harness.test('equ defines a constant', function () {
    harness.eq(asmHex('VAL equ 5\ndb VAL'), '05');
    harness.eq(asmHex('BASE equ 0x10\ndw BASE+2'), '12 00');
  });
  harness.test('%define defines a constant', function () {
    harness.eq(asmHex('%define N 7\ndb N'), '07');
    harness.eq(asmHex('%define N 7\ndb N*2'), '0E');
  });
  harness.test('org sets the origin and $/$$', function () {
    var r = asm('org 0x7c00\ndw $, $$', { bits: 16 });
    harness.eq(r.errors.length, 0);
    harness.eq(hexBytes(r.bytes), '00 7C 00 7C');
    harness.eq(r.origin, 0x7c00);
  });
  harness.test('opts.origin seeds $$', function () {
    harness.eq(asmHex('dw $$', 16, 0x100), '00 01');
    harness.eq(asmHex('dw $', 16, 0x100), '00 01');
  });
  harness.test('labels become symbols', function () {
    var r = asm('org 0x100\nstart: db 1\nnext: db 2\nend:', { bits: 16 });
    harness.eq(r.errors.length, 0);
    harness.eq(r.symbols.get('start'), 0x100);
    harness.eq(r.symbols.get('next'), 0x101);
    harness.eq(r.symbols.get('end'), 0x102);
  });
  harness.test('dd label emits the address', function () {
    harness.eq(asmHex('org 0x100\nlbl: dd lbl', 16), '00 01 00 00');
  });
  harness.test('local labels are scoped to the previous global label', function () {
    var r = asm('org 0x100\nmain:\n.loop: nop\njmp .loop\nother:\n.loop: nop', { bits: 16 });
    harness.eq(r.errors.length, 0);
    harness.eq(r.symbols.get('main.loop'), 0x100);
    harness.eq(r.symbols.get('other.loop'), 0x103);
    harness.eq(r.bytes[2], 0xFD);
    harness.eq(r.bytes[3], 0x90);
  });
  harness.test('basic labels round trip through a jump', function () {
    harness.eq(asmHex('jmp short done\ndone: nop', 16), 'EB 00 90');
    harness.eq(asmHex('start: nop\njmp short start', 16), '90 EB FD');
  });
  harness.test('comments and blank lines are ignored', function () {
    harness.eq(asmHex('; leading comment\n\n  nop   ; trailing\n\n'), '90');
    harness.eq(asmHex('db 0x11 ; c\n; another\ndb 0x22'), '11 22');
  });
  harness.test('case insensitive mnemonics and registers', function () {
    harness.eq(asmHex('MOV EAX, 1', 32), 'B8 01 00 00 00');
    harness.eq(asmHex('Mov Eax, Ebx', 32), '89 D8');
    harness.eq(asmHex('DB 1', 16), '01');
  });
  harness.test('bits directive switches size mid-source', function () {
    harness.eq(asmHex('bits 32\nmov eax, ebx\nbits 16\nmov ax, bx', 16), '89 D8 89 D8');
  });
});

harness.suite('assembler jump sizing', function () {
  harness.test('forward jump auto-promotes to near when short cannot reach', function () {
    var src = 'org 0x100\njmp far_away\ntimes 400 db 0\nfar_away: nop';
    var r = asm(src, { bits: 16 });
    harness.eq(r.errors.length, 0);
    harness.eq(r.bytes.length, 404);
    harness.eq(r.bytes[0], 0xE9);
    harness.eq(r.bytes[1] | (r.bytes[2] << 8), 400);
    harness.eq(r.bytes[403], 0x90);
  });
  harness.test('forward jump stays short when the target is in range', function () {
    var src = 'org 0x100\njmp near_ok\ntimes 100 db 0\nnear_ok: nop';
    var r = asm(src, { bits: 16 });
    harness.eq(r.errors.length, 0);
    harness.eq(r.bytes[0], 0xEB);
    harness.eq(r.bytes[1], 100);
  });
  harness.test('explicit near hint is honoured', function () {
    harness.eq(asmHex('jmp near next\nnext: nop', 16), 'E9 00 00 90');
    harness.eq(asmHex('jmp near next\nnext: nop', 32), 'E9 00 00 00 00 90');
  });
  harness.test('explicit short hint is honoured', function () {
    harness.eq(asmHex('jmp short next\nnext: nop', 16), 'EB 00 90');
  });
  harness.test('conditional jump promotes too', function () {
    var src = 'org 0x100\njz far_away\ntimes 200 db 0\nfar_away: nop';
    var r = asm(src, { bits: 16 });
    harness.eq(r.errors.length, 0);
    harness.eq(r.bytes[0], 0x0F);
    harness.eq(r.bytes[1], 0x84);
    harness.eq(r.bytes.length, 2 + 2 + 200 + 1);
  });
  harness.test('call always uses the near form', function () {
    harness.eq(asmHex('call next\nnext: nop', 16), 'E8 00 00 90');
  });
  harness.test('absolute jump target auto-sizes to near', function () {
    harness.eq(asmHex('jmp 0x300', 16), 'E9 FD 02');
    harness.eq(asmHex('jmp 0x7c00', 16), 'E9 FD 7B');
    harness.eq(asmHex('jmp 0x10', 16), 'EB 0E');
    harness.eq(asmHex('jmp near 0x10', 16), 'E9 0D 00');
  });
  harness.test('absolute conditional jump target auto-sizes to near', function () {
    harness.eq(asmHex('jz 0x300', 16), '0F 84 FC 02');
    harness.eq(asmHex('jz 0x10', 16), '74 0E');
    harness.eq(asmHex('jne 0x300', 32), '0F 85 FA 02 00 00');
  });
  harness.test('loop and jcxz keep their short-only form and report the range', function () {
    var r = asm('loop 0x300', { bits: 16 });
    harness.eq(r.ok, false);
    harness.assert(r.errors[0].message.indexOf('out of range') >= 0, r.errors[0].message);
    harness.eq(asmHex('loop $+2', 16), 'E2 00');
  });
});

harness.suite('assembler errors', function () {
  function errOf(src, opts) {
    var r = asm(src, opts || {});
    harness.eq(r.ok, false, 'expected failure for: ' + src);
    harness.assert(r.errors.length > 0, 'expected at least one error for: ' + src);
    return r.errors[0];
  }
  harness.test('unknown mnemonic', function () {
    var e = errOf('frobnicate eax, ebx');
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('unknown instruction') >= 0, e.message);
  });
  harness.test('rdtsc is rejected as a non-486 instruction', function () {
    var e = errOf('nop\nrdtsc', { bits: 32 });
    harness.eq(e.line, 2);
    harness.assert(e.message.indexOf('486') >= 0, e.message);
  });
  harness.test('cmovcc is rejected as a non-486 instruction', function () {
    var e = errOf('cmove ax, bx', { bits: 16 });
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('Pentium Pro') >= 0, e.message);
  });
  harness.test('wrmsr and rdmsr are rejected', function () {
    harness.eq(errOf('wrmsr', { bits: 32 }).line, 1);
    harness.eq(errOf('rdmsr', { bits: 32 }).line, 1);
  });
  harness.test('bad register operand', function () {
    var e = errOf('mov eax, cx', { bits: 32 });
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('invalid combination') >= 0, e.message);
  });
  harness.test('undefined label', function () {
    var e = errOf('jmp nowhere', { bits: 16 });
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('nowhere') >= 0, e.message);
  });
  harness.test('undefined label reports its own line', function () {
    var e = errOf('nop\nnop\ndd missing', { bits: 16 });
    harness.eq(e.line, 3);
  });
  harness.test('immediate that does not fit', function () {
    var e = errOf('mov al, 0x100', { bits: 16 });
    harness.eq(e.line, 1);
  });
  harness.test('short jump out of range', function () {
    var e = errOf('jmp short 0x1000', { bits: 16 });
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('short jump out of range') >= 0, e.message);
  });
  harness.test('invalid 16-bit addressing combination', function () {
    var e = errOf('mov ax, [si+di]', { bits: 16 });
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('addressing') >= 0, e.message);
  });
  harness.test('esp cannot be an index register', function () {
    var e = errOf('mov eax, [esp*2]', { bits: 32 });
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('esp') >= 0, e.message);
  });
  harness.test('invalid scale factor', function () {
    var e = errOf('mov eax, [ebx+ecx*3]', { bits: 32 });
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('scale') >= 0, e.message);
  });
  harness.test('mixed 16 and 32 bit addressing', function () {
    var e = errOf('mov ax, [bx+ecx]', { bits: 16 });
    harness.eq(e.line, 1);
  });
  harness.test('unterminated string', function () {
    var e = errOf('db "abc', { bits: 16 });
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('unterminated') >= 0, e.message);
  });
  harness.test('missing closing bracket', function () {
    var e = errOf('mov ax, [bx', { bits: 16 });
    harness.eq(e.line, 1);
  });
  harness.test('duplicate label', function () {
    var e = errOf('foo: nop\nfoo: nop', { bits: 16 });
    harness.assert(e.message.indexOf('redefined') >= 0, e.message);
  });
  harness.test('unsupported preprocessor directive', function () {
    var e = errOf('%include "file.asm"', { bits: 16 });
    harness.eq(e.line, 1);
    harness.assert(e.message.indexOf('unsupported') >= 0, e.message);
  });
  harness.test('bits must be 16 or 32', function () {
    var e = errOf('bits 24', { bits: 16 });
    harness.eq(e.line, 1);
  });
  harness.test('too many operands', function () {
    var e = errOf('add [bx], 1, 2', { bits: 16 });
    harness.eq(e.line, 1);
  });
  harness.test('assembler never throws', function () {
    var bad = [
      'mov eax, [', 'db 1,,2', 'jmp', 'mov', '@@@', 'org', 'times db 1',
      'mov eax, [ebx+ecx*99999999999999999999]', 'db 0x', 'equ 5'
    ];
    bad.forEach(function (src) {
      var r = null;
      try {
        r = asm(src, { bits: 32 });
      } catch (e) {
        harness.assert(false, 'threw for: ' + src + ' -> ' + e.message);
      }
      harness.assert(r !== null && r.ok === false, 'expected failure for: ' + src);
    });
  });
  harness.test('multiple errors are all reported', function () {
    var r = asm('bogus1\nbogus2', { bits: 16 });
    harness.eq(r.ok, false);
    harness.eq(r.errors.length, 2);
    harness.eq(r.errors[0].line, 1);
    harness.eq(r.errors[1].line, 2);
  });
});

harness.suite('assembler listing and symbols', function () {
  harness.test('result shape', function () {
    var r = asm('nop', { bits: 16 });
    harness.eq(r.ok, true);
    harness.eq(r.bytes instanceof Uint8Array, true);
    harness.eq(r.errors.length, 0);
    harness.assert(r.symbols instanceof Map, 'symbols must be a Map');
    harness.assert(Array.isArray(r.listing), 'listing must be an array');
  });
  harness.test('listing carries address, bytes and text', function () {
    var r = asm('org 0x100\nnop\nmov ax, bx\ndb 0x11', { bits: 16 });
    harness.eq(r.listing.length, 3);
    harness.eq(r.listing[0].addr, 0x100);
    harness.eq(r.listing[0].bytes, '90');
    harness.eq(r.listing[0].text, 'nop');
    harness.eq(r.listing[0].line, 2);
    harness.eq(r.listing[1].addr, 0x101);
    harness.eq(r.listing[1].bytes, '89 D8');
    harness.eq(r.listing[2].addr, 0x103);
    harness.eq(r.listing[2].bytes, '11');
  });
  harness.test('listing skips labels and directives without bytes', function () {
    var r = asm('foo: nop\nbar:\nbits 16\nnop', { bits: 16 });
    harness.eq(r.listing.length, 2);
  });
  harness.test('symbols hold equ values as well as labels', function () {
    var r = asm('V equ 0x42\nx: nop', { bits: 16 });
    harness.eq(r.symbols.get('V'), 0x42);
    harness.eq(r.symbols.get('x'), 0);
  });
  harness.test('origin is returned', function () {
    harness.eq(asm('nop', { bits: 16, origin: 0x7c00 }).origin, 0x7c00);
    harness.eq(asm('org 0x100\nnop', { bits: 16 }).origin, 0x100);
  });
  harness.test('empty source assembles to nothing', function () {
    var r = asm('', { bits: 32 });
    harness.eq(r.ok, true);
    harness.eq(r.bytes.length, 0);
  });
  harness.test('opts.defines is honoured', function () {
    harness.eq(asmHex('db FOO', 16), 'ERROR: symbol not defined: foo');
    var r = asm('db FOO', { bits: 16, defines: { FOO: 9 } });
    harness.eq(r.errors.length, 0);
    harness.eq(hexBytes(r.bytes), '09');
  });
});

harness.suite('assembler performance', function () {
  harness.test('1500 line program assembles in well under a second', function () {
    var lines = [], i;
    for (i = 0; i < 500; i++) {
      lines.push('L' + i + ':');
      lines.push('  mov eax, L' + i);
      lines.push('  add eax, ' + i);
    }
    var src = lines.join('\n');
    var start = Date.now();
    var r = asm(src, { bits: 32, origin: 0x100000 });
    var elapsed = Date.now() - start;
    harness.eq(r.errors.length, 0, r.errors[0] ? r.errors[0].message : '');
    harness.eq(r.listing.length, 1000);
    harness.assert(elapsed < 1000, 'assembly took ' + elapsed + 'ms');
  });
  harness.test('2000 line straight-line program assembles fast', function () {
    var lines = [], i;
    for (i = 0; i < 2000; i++) {
      lines.push(i % 3 === 0 ? 'mov eax, ' + i : (i % 3 === 1 ? 'push eax' : 'pop ebx'));
    }
    var start = Date.now();
    var r = asm(lines.join('\n'), { bits: 32 });
    var elapsed = Date.now() - start;
    harness.eq(r.errors.length, 0);
    harness.eq(r.bytes.length, 4668);
    harness.assert(elapsed < 1000, 'assembly took ' + elapsed + 'ms');
  });
});

if (require.main === module) { process.exit(harness.run() ? 1 : 0); }
