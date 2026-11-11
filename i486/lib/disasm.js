(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * i486 disassembler. Decodes the same 16/32-bit x86 subset the assembler emits and
   * prints it in the exact syntax I486.Assembler.assemble() parses, so
   * assemble(disassemble(bytes)) reproduces the original bytes for every canonical
   * encoding (right prefix order, shortest mod/rm/disp form, one encoding per mnemonic
   * choice). Non-canonical encodings still decode, but re-assembling them yields the
   * canonical form instead of the original bytes.
   *
   * disassemble(bytes, {bits, origin, count}) decodes at most count instructions;
   * count defaults to 1, as CONTRACT.md section 9 writes it, and a count of 0 or less
   * decodes the whole buffer. range(bytes, {bits, origin, maxInstrs}) decodes from
   * origin until the buffer is exhausted or maxInstrs instructions were produced.
   * Both return { instrs: [{addr, bytes, length, text, mnemonic, operands}], length }
   * where length is the number of bytes covered and instruction addresses start at
   * origin. bits defaults to 16, origin to 0.
   *
   * Text conventions:
   *   - relative transfers carry an explicit hint: 'jmp short 0x7C00', 'jz near 0x7C10';
   *     'call', 'loop*' and 'jcxz' have a single form and get no hint
   *   - memory operands carry an explicit size when nothing else in the instruction
   *     implies it: 'mov eax, dword [ebx+ecx*4+0x10]', 'add byte [bx+si+0x4], 0x1'
   *   - displacements are signed: '[ebx-0x4]', '[ebp+0x0]' (ebp always needs a disp)
   *   - indexes always carry their scale: '[ecx*4+0x10]', '[eax+ecx*1]'
   *   - a segment override on a memory operand is printed inside the brackets
   *     ('mov ax, [es:di]'), on a string instruction as a prefix ('es movsb')
   *   - bytes that are not a valid i486 instruction print as 'db 0xNN' and consume
   *     exactly one byte, so a prefix followed by junk becomes one db per byte
   *
   * Opcodes that a 486DX does not have (0F 30 wrmsr, 0F 31 rdtsc, 0F 32 rdmsr,
   * 0F 40-4F cmovcc, 0F 0B ud2 is real so it decodes) print as 'db 0x0F' plus the
   * following byte: the assembler refuses them, so decoding them properly would break
   * the round trip.
   */

  var SEGN = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];
  var REG8N = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
  var REG16N = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
  var REG32N = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];

  function hexU(v) {
    return '0x' + (v >>> 0).toString(16).toUpperCase();
  }

  function byteHex(v) {
    var s = (v & 0xFF).toString(16).toUpperCase();
    return '0x' + (s.length < 2 ? '0' + s : s);
  }

  function regName(size, num) {
    if (size === 8) return REG8N[num];
    if (size === 16) return REG16N[num];
    return REG32N[num];
  }

  function sizeKeyword(size) {
    if (size === 8) return 'byte';
    if (size === 16) return 'word';
    if (size === 32) return 'dword';
    if (size === 64) return 'qword';
    if (size === 80) return 'tword';
    return '';
  }

  function toBytes(src) {
    var i, out;
    if (src instanceof Uint8Array) return src;
    if (Array.isArray(src)) return new Uint8Array(src);
    if (src && typeof src.length === 'number') {
      out = new Uint8Array(src.length);
      for (i = 0; i < src.length; i++) out[i] = src[i] & 0xFF;
      return out;
    }
    return new Uint8Array(0);
  }


  /* ---------------------------------------------------------------- decode engine */

  var MOD16 = [[3, 6], [3, 7], [5, 6], [5, 7], [6, -1], [7, -1], [5, -1], [3, -1]];

  function readU8(ctx) {
    if (ctx.pos >= ctx.buf.length) throw new DecodeError();
    return ctx.buf[ctx.pos++];
  }

  function readU16(ctx) {
    var v = readU8(ctx);
    return v | (readU8(ctx) << 8);
  }

  function readU32(ctx) {
    var v = readU16(ctx);
    return (v | (readU16(ctx) << 16)) >>> 0;
  }

  function readU(ctx, n) {
    return n === 1 ? readU8(ctx) : n === 2 ? readU16(ctx) : readU32(ctx);
  }

  function readS(ctx, n) {
    var v = readU(ctx, n);
    if (n === 1) return v < 0x80 ? v : v - 0x100;
    if (n === 2) return v < 0x8000 ? v : v - 0x10000;
    return v > 0x7FFFFFFF ? v - 0x100000000 : v;
  }

  function readModRM(ctx) {
    var b = readU8(ctx), md = { mod: b >> 6, reg: (b >> 3) & 7, rm: b & 7, mem: null };
    if (md.mod !== 3) md.mem = readMem(ctx, md.mod, md.rm);
    return md;
  }

  function readMem(ctx, mod, rm) {
    var base = -1, index = -1, scale = 1, disp = 0, dispSize = 0, pair, sib, ss;
    if (ctx.asize === 16) {
      if (mod === 0 && rm === 6) {
        disp = readU16(ctx);
        dispSize = 2;
      } else {
        pair = MOD16[rm];
        base = pair[0];
        index = pair[1];
        if (mod === 1) { disp = readS(ctx, 1); dispSize = 1; }
        else if (mod === 2) { disp = readS(ctx, 2); dispSize = 2; }
      }
      return { base: base, index: index, scale: 1, disp: disp, dispSize: dispSize };
    }
    if (rm === 4) {
      sib = readU8(ctx);
      ss = sib >> 6;
      index = (sib >> 3) & 7;
      base = sib & 7;
      if (index === 4) index = -1;
      scale = 1 << ss;
      if (mod === 0 && base === 5) {
        base = -1;
        disp = readU32(ctx);
        dispSize = 4;
      }
    } else if (mod === 0 && rm === 5) {
      disp = readU32(ctx);
      dispSize = 4;
    } else {
      base = rm;
    }
    if (dispSize === 0) {
      if (mod === 1) { disp = readS(ctx, 1); dispSize = 1; }
      else if (mod === 2) { disp = readS(ctx, 4); dispSize = 4; }
    }
    return { base: base, index: index, scale: scale, disp: disp, dispSize: dispSize };
  }

  function memText(ctx, mem, seg) {
    var s = '', parts = '', d;
    if (seg >= 0) s += SEGN[seg] + ':';
    if (mem.base < 0 && mem.index < 0) {
      return '[' + s + hexU(mem.disp) + ']';
    }
    parts = '';
    if (mem.base >= 0) parts += regName(ctx.asize, mem.base);
    if (mem.index >= 0) {
      if (parts) parts += '+';
      parts += regName(ctx.asize, mem.index);
      if (ctx.asize === 32) parts += '*' + mem.scale;
    }
    if (mem.dispSize) {
      d = mem.disp;
      if (d < 0) parts += '-0x' + (-d).toString(16).toUpperCase();
      else parts += '+0x' + d.toString(16).toUpperCase();
    }
    return '[' + s + parts + ']';
  }

  function rmText(ctx, md, size, sizeKw) {
    if (md.mod === 3) return regName(size, md.rm);
    ctx.sawMem = true;
    return (sizeKw ? sizeKw + ' ' : '') + memText(ctx, md.mem, ctx.seg);
  }

  function impliedSize(specs, skip) {
    var i, sp;
    for (i = 0; i < specs.length; i++) {
      if (i === skip) continue;
      sp = specs[i];
      if (sp === 'Gv' || sp === 'Rv' || sp === 'eAX') return 'v';
      if (sp === 'Gb' || sp === 'AL' || sp === 'CL' || sp === 'DL' || sp === 'Rb' || sp === 'Sw') return 8;
      if (sp === 'Gw' || sp === 'AX' || sp === 'DX') return 16;
      if (sp === 'Gd' || sp === 'EAX' || sp === 'R32') return 32;
    }
    return 0;
  }

  function needSizeKeyword(specs, idx, memSize, osize) {
    var imp = impliedSize(specs, idx);
    if (imp === 'v') imp = osize;
    if (specs[idx] === 'Efar' || specs[idx] === 'Mfar') return true;
    return imp !== memSize;
  }

  function specSize(spec, osize) {
    switch (spec) {
      case 'Eb': case 'Gb': case 'AL': case 'CL': case 'DL': case 'Rb':
      case 'Mem8': case 'Ob': return 8;
      case 'Ew': case 'Gw': case 'AX': case 'DX': case 'Sw': case 'S0': case 'S1':
      case 'S2': case 'S3': case 'S4': case 'S5': case 'Mem16': return 16;
      case 'Ed': case 'Gd': case 'EAX': case 'R32': case 'Mem32': return 32;
      case 'Mem64': return 64;
      case 'Mem80': return 80;
      default: return osize;
    }
  }

  function operandText(ctx, spec, md, val, specs, idx) {
    var size = ctx.osize, ms, kw;
    switch (spec) {
      case 'Eb': case 'Ew': case 'Ed': case 'Ev':
        ms = specSize(spec, size);
        kw = (md.mod === 3 || spec === 'Ev') ? '' : sizeKeyword(ms);
        if (spec !== 'Ev' && md.mod !== 3 && needSizeKeyword(specs, idx, ms, size)) kw = sizeKeyword(ms);
        else if (spec === 'Ev' && md.mod !== 3 && needSizeKeyword(specs, idx, ms, size)) kw = sizeKeyword(ms);
        return rmText(ctx, md, ms, kw);
      case 'Efar':
        return 'far ' + rmText(ctx, md, size, sizeKeyword(size));
      case 'M': case 'Mem48':
        return rmText(ctx, md, size, '');
      case 'Mem8': case 'Mem16': case 'Mem32': case 'Mem64': case 'Mem80':
        ms = specSize(spec, size);
        return rmText(ctx, md, ms, sizeKeyword(ms));
      case 'Gb': return regName(8, md.reg);
      case 'Gw': return regName(16, md.reg);
      case 'Gd': return regName(32, md.reg);
      case 'Gv': return regName(size, md.reg);
      case 'Rb': return regName(8, ctx.opLow);
      case 'Rv': return regName(size, ctx.opLow);
      case 'Rd': return regName(32, ctx.opLow);
      case 'R32': return regName(32, md.rm);
      case 'AL': return 'al';
      case 'CL': return 'cl';
      case 'DX': return 'dx';
      case 'AX': return 'ax';
      case 'EAX': return 'eax';
      case 'eAX': return regName(size, 0);
      case 'Sw': return SEGN[md.reg];
      case 'S0': case 'S1': case 'S2': case 'S3': case 'S4': case 'S5':
        return SEGN[spec.charCodeAt(1) - 48];
      case 'Cd': return 'cr' + md.reg;
      case 'Dd': return 'dr' + md.reg;
      case 'st': return 'st(' + md.rm + ')';
      case 'sti': return 'st(' + md.rm + ')';
      case 'st0': return 'st(0)';
      case 'st1': return 'st(1)';
      case '1': return '1';
      case '0': return '0';
      case 'Ib': case 'Iw': case 'Iv': case 'Id': return hexU(val);
      case 'Ibs': return val < 0 ? '-0x' + (-val).toString(16).toUpperCase() : '0x' + val.toString(16).toUpperCase();
      case 'Jb': case 'Jz': {
        var target = (ctx.origin + ctx.pos + val) >>> 0;
        if (spec === 'Jb') return 'short ' + hexU(target);
        return (ctx.d && ctx.d.nohint ? '' : 'near ') + hexU(target);
      }
      case 'Ap':
        return 'far ' + hexU(val.sel >>> 0) + ':' + hexU(val.off >>> 0);
      case 'Ob': case 'Ov': {
        ctx.sawMem = true;
        var inner = hexU(val);
        if (ctx.seg >= 0) return '[' + SEGN[ctx.seg] + ':' + inner + ']';
        return '[' + inner + ']';
      }
      default: return '?';
    }
  }

  function decodeGeneric(ctx) {
    var d = ctx.d, specs, md = null, vals = [], i, sp, texts = [], parts = [], mnem;

    if (d.hasModrm) md = readModRM(ctx);
    ctx.md = md;
    specs = (typeof d.o === 'function') ? d.o(ctx) : d.o;

    for (i = 0; i < specs.length; i++) {
      sp = specs[i];
      switch (sp) {
        case 'Ib': vals.push(readU8(ctx)); break;
        case 'Ibs': vals.push(readS(ctx, 1)); break;
        case 'Iw': vals.push(readU16(ctx)); break;
        case 'Id': vals.push(readU32(ctx)); break;
        case 'Iv': vals.push(readU(ctx, ctx.osize === 16 ? 2 : 4)); break;
        case 'Jb': vals.push(readS(ctx, 1)); break;
        case 'Jz': vals.push(readS(ctx, ctx.osize === 16 ? 2 : 4)); break;
        case 'Ap': {
          var off = readU(ctx, ctx.osize === 16 ? 2 : 4);
          var sel = readU16(ctx);
          vals.push({ off: off, sel: sel });
          break;
        }
        case 'Ob': case 'Ov': vals.push(readU(ctx, ctx.asize === 16 ? 2 : 4)); break;
        default: vals.push(0);
      }
    }

    if (d.grp) {
      mnem = d.grp[md ? md.reg : 0];
      if (!mnem) return null;
    } else if (d.alt) {
      mnem = d.alt[ctx.osize] || d.m;
    } else {
      mnem = d.m;
    }

    for (i = 0; i < specs.length; i++) {
      texts.push(operandText(ctx, specs[i], md, vals[i], specs, i));
    }
    return {
      mnemonic: mnem,
      operands: texts.join(', '),
      text: mnem + (texts.length ? ' ' + texts.join(', ') : '')
    };
  }


  /* ---------------------------------------------------------------- opcode tables */

  var MAP1 = new Array(256), MAP2 = new Array(256);

  function inferModrm(entry) {
    var o = entry.o, i, sp;
    if (typeof o === 'function') return true;
    for (i = 0; i < o.length; i++) {
      sp = o[i];
      switch (sp) {
        case 'Eb': case 'Ew': case 'Ed': case 'Ev': case 'Efar':
        case 'M': case 'Mem8': case 'Mem16': case 'Mem32': case 'Mem64': case 'Mem80': case 'Mem48':
        case 'R32': case 'Gb': case 'Gw': case 'Gd': case 'Gv': case 'Sw': case 'Cd': case 'Dd':
          return true;
        default: break;
      }
    }
    return false;
  }

  function add(map, op, entry) {
    if (entry.hasModrm === undefined) entry.hasModrm = inferModrm(entry);
    map[op] = entry;
  }

  var JCC = ['jo', 'jno', 'jb', 'jae', 'je', 'jne', 'jbe', 'ja',
             'js', 'jns', 'jp', 'jnp', 'jl', 'jge', 'jle', 'jg'];
  var SETCC = ['seto', 'setno', 'setb', 'setae', 'sete', 'setne', 'setbe', 'seta',
               'sets', 'setns', 'setp', 'setnp', 'setl', 'setge', 'setle', 'setg'];
  var SHIFTN = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', 'sal', 'sar'];

  function decodeNop(ctx) {
    var r;
    if (ctx.p66) {
      r = regName(ctx.osize, 0);
      return { mnemonic: 'xchg', operands: r + ', ' + r, text: 'xchg ' + r + ', ' + r };
    }
    return { mnemonic: 'nop', operands: '', text: 'nop' };
  }

  function decodeAam(ctx) {
    var v = readU8(ctx), m = ctx.op === 0xD4 ? 'aam' : 'aad';
    if (v === 0x0A) return { mnemonic: m, operands: '', text: m };
    return { mnemonic: m, operands: hexU(v), text: m + ' ' + hexU(v) };
  }

  (function buildOpcodeMap() {
    var i, b, m, alt;

    var ARITH = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
    for (i = 0; i < 8; i++) {
      m = ARITH[i];
      b = i * 8;
      add(MAP1, b + 0, { m: m, o: ['Eb', 'Gb'] });
      add(MAP1, b + 1, { m: m, o: ['Ev', 'Gv'] });
      add(MAP1, b + 2, { m: m, o: ['Gb', 'Eb'] });
      add(MAP1, b + 3, { m: m, o: ['Gv', 'Ev'] });
      add(MAP1, b + 4, { m: m, o: ['AL', 'Ib'] });
      add(MAP1, b + 5, { m: m, o: ['eAX', 'Iv'] });
    }

    add(MAP1, 0x06, { m: 'push', o: ['S0'] });
    add(MAP1, 0x07, { m: 'pop', o: ['S0'] });
    add(MAP1, 0x0E, { m: 'push', o: ['S1'] });
    add(MAP1, 0x16, { m: 'push', o: ['S2'] });
    add(MAP1, 0x17, { m: 'pop', o: ['S2'] });
    add(MAP1, 0x1E, { m: 'push', o: ['S3'] });
    add(MAP1, 0x1F, { m: 'pop', o: ['S3'] });
    add(MAP1, 0x27, { m: 'daa', o: [] });
    add(MAP1, 0x2F, { m: 'das', o: [] });
    add(MAP1, 0x37, { m: 'aaa', o: [] });
    add(MAP1, 0x3F, { m: 'aas', o: [] });

    for (i = 0; i < 8; i++) {
      add(MAP1, 0x40 + i, { m: 'inc', o: ['Rv'], plus: true });
      add(MAP1, 0x48 + i, { m: 'dec', o: ['Rv'], plus: true });
      add(MAP1, 0x50 + i, { m: 'push', o: ['Rv'], plus: true });
      add(MAP1, 0x58 + i, { m: 'pop', o: ['Rv'], plus: true });
      add(MAP1, 0x90 + i, { m: 'xchg', o: ['eAX', 'Rv'], plus: true });
      add(MAP1, 0xB0 + i, { m: 'mov', o: ['Rb', 'Ib'], plus: true });
      add(MAP1, 0xB8 + i, { m: 'mov', o: ['Rv', 'Iv'], plus: true });
    }
    add(MAP1, 0x90, { m: 'nop', o: [], fn: decodeNop, hasModrm: false });

    add(MAP1, 0x60, { m: 'pusha', o: [], alt: { 16: 'pusha', 32: 'pushad' } });
    add(MAP1, 0x61, { m: 'popa', o: [], alt: { 16: 'popa', 32: 'popad' } });
    add(MAP1, 0x62, { m: 'bound', o: ['Gv', 'M'] });
    add(MAP1, 0x63, { m: 'arpl', o: ['Ew', 'Gw'] });
    add(MAP1, 0x68, { m: 'push', o: ['Iv'] });
    add(MAP1, 0x69, { m: 'imul', o: ['Gv', 'Ev', 'Iv'] });
    add(MAP1, 0x6A, { m: 'push', o: ['Ibs'] });
    add(MAP1, 0x6B, { m: 'imul', o: ['Gv', 'Ev', 'Ibs'] });
    add(MAP1, 0x6C, { m: 'insb', o: [] });
    add(MAP1, 0x6D, { m: 'insw', o: [], alt: { 16: 'insw', 32: 'insd' } });
    add(MAP1, 0x6E, { m: 'outsb', o: [] });
    add(MAP1, 0x6F, { m: 'outsw', o: [], alt: { 16: 'outsw', 32: 'outsd' } });

    for (i = 0; i < 16; i++) add(MAP1, 0x70 + i, { m: JCC[i], o: ['Jb'] });

    add(MAP1, 0x80, { m: 'add', o: ['Eb', 'Ib'], grp: ARITH });
    add(MAP1, 0x81, { m: 'add', o: ['Ev', 'Iv'], grp: ARITH });
    add(MAP1, 0x82, { m: 'add', o: ['Eb', 'Ib'], grp: ARITH });
    add(MAP1, 0x83, { m: 'add', o: ['Ev', 'Ibs'], grp: ARITH });
    add(MAP1, 0x84, { m: 'test', o: ['Eb', 'Gb'] });
    add(MAP1, 0x85, { m: 'test', o: ['Ev', 'Gv'] });
    add(MAP1, 0x86, { m: 'xchg', o: ['Eb', 'Gb'] });
    add(MAP1, 0x87, { m: 'xchg', o: ['Ev', 'Gv'] });
    add(MAP1, 0x88, { m: 'mov', o: ['Eb', 'Gb'] });
    add(MAP1, 0x89, { m: 'mov', o: ['Ev', 'Gv'] });
    add(MAP1, 0x8A, { m: 'mov', o: ['Gb', 'Eb'] });
    add(MAP1, 0x8B, { m: 'mov', o: ['Gv', 'Ev'] });
    add(MAP1, 0x8C, { m: 'mov', o: ['Ew', 'Sw'] });
    add(MAP1, 0x8D, { m: 'lea', o: ['Gv', 'M'] });
    add(MAP1, 0x8E, { m: 'mov', o: ['Sw', 'Ew'] });
    add(MAP1, 0x8F, { grp: ['pop', null, null, null, null, null, null, null], o: ['Ev'] });

    add(MAP1, 0x98, { m: 'cbw', o: [], alt: { 16: 'cbw', 32: 'cwde' } });
    add(MAP1, 0x99, { m: 'cwd', o: [], alt: { 16: 'cwd', 32: 'cdq' } });
    add(MAP1, 0x9A, { m: 'call', o: ['Ap'] });
    add(MAP1, 0x9B, { m: 'wait', o: [] });
    add(MAP1, 0x9C, { m: 'pushf', o: [], alt: { 16: 'pushf', 32: 'pushfd' } });
    add(MAP1, 0x9D, { m: 'popf', o: [], alt: { 16: 'popf', 32: 'popfd' } });
    add(MAP1, 0x9E, { m: 'sahf', o: [] });
    add(MAP1, 0x9F, { m: 'lahf', o: [] });

    add(MAP1, 0xA0, { m: 'mov', o: ['AL', 'Ob'] });
    add(MAP1, 0xA1, { m: 'mov', o: ['eAX', 'Ov'] });
    add(MAP1, 0xA2, { m: 'mov', o: ['Ob', 'AL'] });
    add(MAP1, 0xA3, { m: 'mov', o: ['Ov', 'eAX'] });
    add(MAP1, 0xA4, { m: 'movsb', o: [] });
    add(MAP1, 0xA5, { m: 'movsw', o: [], alt: { 16: 'movsw', 32: 'movsd' } });
    add(MAP1, 0xA6, { m: 'cmpsb', o: [] });
    add(MAP1, 0xA7, { m: 'cmpsw', o: [], alt: { 16: 'cmpsw', 32: 'cmpsd' } });
    add(MAP1, 0xA8, { m: 'test', o: ['AL', 'Ib'] });
    add(MAP1, 0xA9, { m: 'test', o: ['eAX', 'Iv'] });
    add(MAP1, 0xAA, { m: 'stosb', o: [] });
    add(MAP1, 0xAB, { m: 'stosw', o: [], alt: { 16: 'stosw', 32: 'stosd' } });
    add(MAP1, 0xAC, { m: 'lodsb', o: [] });
    add(MAP1, 0xAD, { m: 'lodsw', o: [], alt: { 16: 'lodsw', 32: 'lodsd' } });
    add(MAP1, 0xAE, { m: 'scasb', o: [] });
    add(MAP1, 0xAF, { m: 'scasw', o: [], alt: { 16: 'scasw', 32: 'scasd' } });

    add(MAP1, 0xC0, { m: 'shl', o: ['Eb', 'Ib'], grp: SHIFTN });
    add(MAP1, 0xC1, { m: 'shl', o: ['Ev', 'Ib'], grp: SHIFTN });
    add(MAP1, 0xC2, { m: 'ret', o: ['Iw'] });
    add(MAP1, 0xC3, { m: 'ret', o: [] });
    add(MAP1, 0xC4, { m: 'les', o: ['Gv', 'M'] });
    add(MAP1, 0xC5, { m: 'lds', o: ['Gv', 'M'] });
    add(MAP1, 0xC6, { m: 'mov', o: ['Eb', 'Ib'] });
    add(MAP1, 0xC7, { m: 'mov', o: ['Ev', 'Iv'] });
    add(MAP1, 0xC8, { m: 'enter', o: ['Iw', 'Ib'] });
    add(MAP1, 0xC9, { m: 'leave', o: [] });
    add(MAP1, 0xCA, { m: 'retf', o: ['Iw'] });
    add(MAP1, 0xCB, { m: 'retf', o: [] });
    add(MAP1, 0xCC, { m: 'int3', o: [] });
    add(MAP1, 0xCD, { m: 'int', o: ['Ib'] });
    add(MAP1, 0xCE, { m: 'into', o: [] });
    add(MAP1, 0xCF, { m: 'iret', o: [], alt: { 16: 'iret', 32: 'iretd' } });

    add(MAP1, 0xD0, { m: 'shl', o: ['Eb', '1'], grp: SHIFTN });
    add(MAP1, 0xD1, { m: 'shl', o: ['Ev', '1'], grp: SHIFTN });
    add(MAP1, 0xD2, { m: 'shl', o: ['Eb', 'CL'], grp: SHIFTN });
    add(MAP1, 0xD3, { m: 'shl', o: ['Ev', 'CL'], grp: SHIFTN });
    add(MAP1, 0xD4, { m: 'aam', o: [], fn: decodeAam, hasModrm: false });
    add(MAP1, 0xD5, { m: 'aad', o: [], fn: decodeAam, hasModrm: false });
    add(MAP1, 0xD7, { m: 'xlat', o: [] });

    for (i = 0xD8; i <= 0xDF; i++) {
      add(MAP1, i, { m: 'fpu', o: [], fn: decodeFPU, hasModrm: false });
    }

    add(MAP1, 0xE0, { m: 'loopne', o: ['Jb'] });
    add(MAP1, 0xE1, { m: 'loope', o: ['Jb'] });
    add(MAP1, 0xE2, { m: 'loop', o: ['Jb'] });
    add(MAP1, 0xE3, { m: 'jcxz', o: ['Jb'], alt: { 16: 'jcxz', 32: 'jecxz' } });
    add(MAP1, 0xE4, { m: 'in', o: ['AL', 'Ib'] });
    add(MAP1, 0xE5, { m: 'in', o: ['eAX', 'Ib'] });
    add(MAP1, 0xE6, { m: 'out', o: ['Ib', 'AL'] });
    add(MAP1, 0xE7, { m: 'out', o: ['Ib', 'eAX'] });
    add(MAP1, 0xE8, { m: 'call', o: ['Jz'], nohint: true });
    add(MAP1, 0xE9, { m: 'jmp', o: ['Jz'] });
    add(MAP1, 0xEA, { m: 'jmp', o: ['Ap'] });
    add(MAP1, 0xEB, { m: 'jmp', o: ['Jb'] });
    add(MAP1, 0xEC, { m: 'in', o: ['AL', 'DX'] });
    add(MAP1, 0xED, { m: 'in', o: ['eAX', 'DX'] });
    add(MAP1, 0xEE, { m: 'out', o: ['DX', 'AL'] });
    add(MAP1, 0xEF, { m: 'out', o: ['DX', 'eAX'] });

    add(MAP1, 0xF4, { m: 'hlt', o: [] });
    add(MAP1, 0xF5, { m: 'cmc', o: [] });
    add(MAP1, 0xF6, { o: function (ctx) { return ctx.md.reg <= 1 ? ['Eb', 'Ib'] : ['Eb']; }, grp: ['test', 'test', 'not', 'neg', 'mul', 'imul', 'div', 'idiv'] });
    add(MAP1, 0xF7, { o: function (ctx) { return ctx.md.reg <= 1 ? ['Ev', 'Iv'] : ['Ev']; }, grp: ['test', 'test', 'not', 'neg', 'mul', 'imul', 'div', 'idiv'] });
    add(MAP1, 0xF8, { m: 'clc', o: [] });
    add(MAP1, 0xF9, { m: 'stc', o: [] });
    add(MAP1, 0xFA, { m: 'cli', o: [] });
    add(MAP1, 0xFB, { m: 'sti', o: [] });
    add(MAP1, 0xFC, { m: 'cld', o: [] });
    add(MAP1, 0xFD, { m: 'std', o: [] });
    add(MAP1, 0xFE, { grp: ['inc', 'dec', null, null, null, null, null, null], o: ['Eb'] });
    add(MAP1, 0xFF, {
      grp: ['inc', 'dec', 'call', 'call', 'jmp', 'jmp', 'push', null],
      o: function (ctx) { return (ctx.md.reg === 3 || ctx.md.reg === 5) ? ['Efar'] : ['Ev']; }
    });

    /* ---- two byte map ---- */
    add(MAP2, 0x00, { grp: ['sldt', 'str', 'lldt', 'ltr', 'verr', 'verw', null, null], o: ['Ew'] });
    add(MAP2, 0x01, {
      grp: ['sgdt', 'sidt', 'lgdt', 'lidt', 'smsw', null, 'lmsw', 'invlpg'],
      o: function (ctx) { return (ctx.md.reg === 4 || ctx.md.reg === 6) ? ['Ew'] : ['M']; }
    });
    add(MAP2, 0x02, { m: 'lar', o: ['Gv', 'Ev'] });
    add(MAP2, 0x03, { m: 'lsl', o: ['Gv', 'Ev'] });
    add(MAP2, 0x06, { m: 'clts', o: [] });
    add(MAP2, 0x08, { m: 'invd', o: [] });
    add(MAP2, 0x09, { m: 'wbinvd', o: [] });
    add(MAP2, 0x0B, { m: 'ud2', o: [] });
    add(MAP2, 0x20, { m: 'mov', o: ['R32', 'Cd'] });
    add(MAP2, 0x21, { m: 'mov', o: ['R32', 'Dd'] });
    add(MAP2, 0x22, { m: 'mov', o: ['Cd', 'R32'] });
    add(MAP2, 0x23, { m: 'mov', o: ['Dd', 'R32'] });
    for (i = 0; i < 16; i++) add(MAP2, 0x80 + i, { m: JCC[i], o: ['Jz'] });
    for (i = 0; i < 16; i++) add(MAP2, 0x90 + i, { m: SETCC[i], o: ['Eb'] });
    add(MAP2, 0xA0, { m: 'push', o: ['S4'] });
    add(MAP2, 0xA1, { m: 'pop', o: ['S4'] });
    add(MAP2, 0xA2, { m: 'cpuid', o: [] });
    add(MAP2, 0xA3, { m: 'bt', o: ['Ev', 'Gv'] });
    add(MAP2, 0xA4, { m: 'shld', o: ['Ev', 'Gv', 'Ib'] });
    add(MAP2, 0xA5, { m: 'shld', o: ['Ev', 'Gv', 'CL'] });
    add(MAP2, 0xA8, { m: 'push', o: ['S5'] });
    add(MAP2, 0xA9, { m: 'pop', o: ['S5'] });
    add(MAP2, 0xAA, { m: 'rsm', o: [] });
    add(MAP2, 0xAB, { m: 'bts', o: ['Ev', 'Gv'] });
    add(MAP2, 0xAC, { m: 'shrd', o: ['Ev', 'Gv', 'Ib'] });
    add(MAP2, 0xAD, { m: 'shrd', o: ['Ev', 'Gv', 'CL'] });
    add(MAP2, 0xAF, { m: 'imul', o: ['Gv', 'Ev'] });
    add(MAP2, 0xB0, { m: 'cmpxchg', o: ['Eb', 'Gb'] });
    add(MAP2, 0xB1, { m: 'cmpxchg', o: ['Ev', 'Gv'] });
    add(MAP2, 0xB2, { m: 'lss', o: ['Gv', 'M'] });
    add(MAP2, 0xB3, { m: 'btr', o: ['Ev', 'Gv'] });
    add(MAP2, 0xB4, { m: 'lfs', o: ['Gv', 'M'] });
    add(MAP2, 0xB5, { m: 'lgs', o: ['Gv', 'M'] });
    add(MAP2, 0xB6, { m: 'movzx', o: ['Gv', 'Eb'] });
    add(MAP2, 0xB7, { m: 'movzx', o: ['Gv', 'Ew'] });
    add(MAP2, 0xBA, { grp: [null, null, null, null, 'bt', 'bts', 'btr', 'btc'], o: ['Ev', 'Ib'] });
    add(MAP2, 0xBB, { m: 'btc', o: ['Ev', 'Gv'] });
    add(MAP2, 0xBC, { m: 'bsf', o: ['Gv', 'Ev'] });
    add(MAP2, 0xBD, { m: 'bsr', o: ['Gv', 'Ev'] });
    add(MAP2, 0xBE, { m: 'movsx', o: ['Gv', 'Eb'] });
    add(MAP2, 0xBF, { m: 'movsx', o: ['Gv', 'Ew'] });
    add(MAP2, 0xC0, { m: 'xadd', o: ['Eb', 'Gb'] });
    add(MAP2, 0xC1, { m: 'xadd', o: ['Ev', 'Gv'] });
    for (i = 0; i < 8; i++) add(MAP2, 0xC8 + i, { m: 'bswap', o: ['Rd'], plus: true });
  })();


  /* ---------------------------------------------------------------- FPU */

  var FPU_MEM = {
    0xD8: [['fadd', 32], ['fmul', 32], ['fcom', 32], ['fcomp', 32], ['fsub', 32], ['fsubr', 32], ['fdiv', 32], ['fdivr', 32]],
    0xD9: [['fld', 32], null, ['fst', 32], ['fstp', 32], ['fldenv', 0], ['fldcw', 16], ['fnstenv', 0], ['fnstcw', 16]],
    0xDA: [['fiadd', 32], ['fimul', 32], ['ficom', 32], ['ficomp', 32], ['fisub', 32], ['fisubr', 32], ['fidiv', 32], ['fidivr', 32]],
    0xDB: [['fild', 32], null, ['fist', 32], ['fistp', 32], null, ['fld', 80], null, ['fstp', 80]],
    0xDC: [['fadd', 64], ['fmul', 64], ['fcom', 64], ['fcomp', 64], ['fsub', 64], ['fsubr', 64], ['fdiv', 64], ['fdivr', 64]],
    0xDD: [['fld', 64], null, ['fst', 64], ['fstp', 64], ['frstor', 0], null, ['fnsave', 0], ['fnstsw', 16]],
    0xDE: [['fiadd', 16], ['fimul', 16], ['ficom', 16], ['ficomp', 16], ['fisub', 16], ['fisubr', 16], ['fidiv', 16], ['fidivr', 16]],
    0xDF: [['fild', 16], null, ['fist', 16], ['fistp', 16], ['fbld', 80], null, ['fbstp', 80], ['fistp', 64]]
  };

  var D9REG = [];
  (function () {
    var i;
    for (i = 0; i < 8; i++) D9REG[0x00 + i] = 'fld';
    for (i = 0; i < 8; i++) D9REG[0x08 + i] = 'fxch';
    D9REG[0x10] = 'fnop';
    D9REG[0x20] = 'fchs'; D9REG[0x21] = 'fabs'; D9REG[0x24] = 'ftst'; D9REG[0x25] = 'fxam';
    D9REG[0x28] = 'fld1'; D9REG[0x29] = 'fldl2t'; D9REG[0x2A] = 'fldl2e'; D9REG[0x2B] = 'fldpi';
    D9REG[0x2C] = 'fldlg2'; D9REG[0x2D] = 'fldln2'; D9REG[0x2E] = 'fldz';
    D9REG[0x30] = 'f2xm1'; D9REG[0x31] = 'fyl2x'; D9REG[0x32] = 'fptan'; D9REG[0x33] = 'fpatan';
    D9REG[0x34] = 'fxtract'; D9REG[0x35] = 'fprem1'; D9REG[0x36] = 'fdecstp'; D9REG[0x37] = 'fincstp';
    D9REG[0x38] = 'fprem'; D9REG[0x39] = 'fyl2xp1'; D9REG[0x3A] = 'fsqrt'; D9REG[0x3B] = 'fsincos';
    D9REG[0x3C] = 'frndint'; D9REG[0x3D] = 'fscale'; D9REG[0x3E] = 'fsin'; D9REG[0x3F] = 'fcos';
  })();

  var FPU_ARITH = ['fadd', 'fmul', 'fcom', 'fcomp', 'fsub', 'fsubr', 'fdiv', 'fdivr'];

  function one(m, a) { return { mnemonic: m, operands: a, text: m + ' ' + a }; }
  function nil(m) { return { mnemonic: m, operands: '', text: m }; }
  function two(m, a, b) { return { mnemonic: m, operands: a + ', ' + b, text: m + ' ' + a + ', ' + b }; }

  function decodeFPU(ctx) {
    var b = readU8(ctx), mod = b >> 6, reg = (b >> 3) & 7, rm = b & 7, key = b & 0x3F;
    var st = 'st(' + rm + ')', m, md, e, kw, mt;
    if (mod !== 3) {
      e = FPU_MEM[ctx.op][reg];
      if (!e) return null;
      md = { mod: mod, reg: reg, rm: rm, mem: readMem(ctx, mod, rm) };
      ctx.md = md;
      ctx.sawMem = true;
      kw = e[1] ? sizeKeyword(e[1]) : '';
      mt = (kw ? kw + ' ' : '') + memText(ctx, md.mem, ctx.seg);
      return one(e[0], mt);
    }
    switch (ctx.op) {
      case 0xD8:
        m = FPU_ARITH[reg];
        if (reg === 2 || reg === 3) return one(m, st);
        return two(m, 'st(0)', st);
      case 0xDC:
        return two(FPU_ARITH[reg], st, 'st(0)');
      case 0xD9:
        m = D9REG[key];
        if (!m) return null;
        if (key < 0x10) return one(m, st);
        return nil(m);
      case 0xDB:
        if (key === 0x22) return nil('fnclex');
        if (key === 0x23) return nil('fninit');
        return null;
      case 0xDD:
        if (key < 0x08) return one('ffree', st);
        if (key >= 0x10 && key < 0x18) return one('fst', st);
        if (key >= 0x18 && key < 0x20) return one('fstp', st);
        return null;
      case 0xDE:
        if (key === 0x19) return nil('fcompp');
        if (key < 0x08) return two('faddp', st, 'st(0)');
        if (key < 0x10) return two('fmulp', st, 'st(0)');
        if (key >= 0x20 && key < 0x28) return two('fsubrp', st, 'st(0)');
        if (key >= 0x28 && key < 0x30) return two('fsubp', st, 'st(0)');
        if (key >= 0x30 && key < 0x38) return two('fdivrp', st, 'st(0)');
        if (key >= 0x38) return two('fdivp', st, 'st(0)');
        return null;
      case 0xDF:
        if (key === 0x20) return nil('fnstsw ax');
        return null;
      default:
        return null;
    }
  }

  /* ---------------------------------------------------------------- driver */

  function DecodeError() {}

  function decodeInstruction(ctx) {
    var buf = ctx.buf, b, d, res, prefix, len;

    for (;;) {
      if (ctx.pos >= buf.length) return null;
      b = buf[ctx.pos];
      if (b === 0x66) ctx.p66 = true;
      else if (b === 0x67) ctx.p67 = true;
      else if (b === 0xF0) ctx.lock = true;
      else if (b === 0xF2) ctx.rep = 0xF2;
      else if (b === 0xF3) ctx.rep = 0xF3;
      else if (b === 0x26) ctx.seg = 0;
      else if (b === 0x2E) ctx.seg = 1;
      else if (b === 0x36) ctx.seg = 2;
      else if (b === 0x3E) ctx.seg = 3;
      else if (b === 0x64) ctx.seg = 4;
      else if (b === 0x65) ctx.seg = 5;
      else break;
      ctx.pos++;
      if (ctx.pos - ctx.start > 12) return null;
    }

    ctx.osize = ctx.p66 ? (ctx.bits === 16 ? 32 : 16) : ctx.bits;
    ctx.asize = ctx.p67 ? (ctx.bits === 16 ? 32 : 16) : ctx.bits;

    ctx.op = buf[ctx.pos++];
    if (ctx.op === 0x0F) {
      if (ctx.pos >= buf.length) return null;
      ctx.op2 = buf[ctx.pos++];
      d = MAP2[ctx.op2];
      ctx.opLow = ctx.op2 & 7;
    } else {
      d = MAP1[ctx.op];
      ctx.opLow = ctx.op & 7;
    }
    if (!d) return null;
    ctx.d = d;

    res = d.fn ? d.fn(ctx) : decodeGeneric(ctx);
    if (!res) return null;

    prefix = '';
    if (ctx.lock) prefix += 'lock ';
    if (ctx.rep === 0xF3) prefix += 'rep ';
    else if (ctx.rep === 0xF2) prefix += 'repne ';
    if (ctx.seg >= 0 && !ctx.sawMem) prefix += SEGN[ctx.seg] + ' ';

    len = ctx.pos - ctx.start;
    return {
      addr: (ctx.origin + ctx.start) >>> 0,
      bytes: new Uint8Array(buf.subarray(ctx.start, ctx.pos)),
      length: len,
      text: prefix + res.text,
      mnemonic: res.mnemonic,
      operands: res.operands
    };
  }

  function decodeAt(buf, start, bits, origin) {
    var ctx = {
      buf: buf, pos: start, start: start, bits: bits, origin: origin,
      p66: false, p67: false, lock: false, rep: 0, seg: -1,
      osize: bits, asize: bits, op: 0, op2: -1, opLow: 0,
      sawMem: false, md: null, d: null
    };
    try {
      return decodeInstruction(ctx);
    } catch (e) {
      if (e instanceof DecodeError) return null;
      throw e;
    }
  }

  function unknownInstr(buf, pos, origin) {
    return {
      addr: (origin + pos) >>> 0,
      bytes: new Uint8Array([buf[pos]]),
      length: 1,
      text: 'db ' + byteHex(buf[pos]),
      mnemonic: 'db',
      operands: byteHex(buf[pos])
    };
  }

  function run(buf, opts, limit) {
    var instrs = [], pos = 0, ins, count;
    count = typeof limit === 'number' && limit > 0 ? limit : 0;
    while (pos < buf.length && (!count || instrs.length < count)) {
      ins = decodeAt(buf, pos, opts.bits, opts.origin) || unknownInstr(buf, pos, opts.origin);
      instrs.push(ins);
      pos += ins.length;
    }
    return { instrs: instrs, length: pos };
  }

  function disassemble(bytes, options) {
    var opts = options || {};
    var count = typeof opts.count === 'number' ? opts.count : 1;
    return run(toBytes(bytes), {
      bits: opts.bits === 32 ? 32 : 16,
      origin: typeof opts.origin === 'number' ? (opts.origin >>> 0) : 0
    }, count > 0 ? count : 0);
  }

  function range(bytes, options) {
    var opts = options || {};
    return run(toBytes(bytes), {
      bits: opts.bits === 32 ? 32 : 16,
      origin: typeof opts.origin === 'number' ? (opts.origin >>> 0) : 0
    }, typeof opts.maxInstrs === 'number' ? opts.maxInstrs : (typeof opts.count === 'number' ? opts.count : 0));
  }

  return { Disassembler: { disassemble: disassemble, range: range } };
});