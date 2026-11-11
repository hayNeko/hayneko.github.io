(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * i486 assembler: NASM-style Intel syntax for the 16/32-bit x86 subset of a 486DX.
   * Instruction sizes are resolved by iterating over the whole program until nothing
   * changes, so forward references, short-jump promotion and times-counted data all
   * converge before bytes are emitted.
   *
   *   bits 16 | bits 32       default operand and address size, from this line on
   *   org expr                sets the origin and the address of the following code
   *   NAME equ expr           numeric constant (re-evaluated every pass)
   *   %define NAME text       textual constant, expanded where the name is used
   *   name:   .local:         global label; local label scoped to the previous global label
   *   $$                      current line address, origin
   *
   *   db/dw/dd/dq item, ...   item = number | expression | 'string' | "string"
   *   times N <directive>     repeat a data directive or an instruction
   *   resb/resw/resd N        reserve N bytes/words/dwords, emitting zero bytes
   *
   * Prefixes may start the line: lock, rep, repe/repz, repne/repnz, and a segment
   * override for string instructions: es: cs: ss: ds: fs: gs:.
   *
   * Operands are registers, immediates or memory of the form
   * [base + index*scale + displacement] with an optional byte/word/dword/qword/tword
   * size keyword (with or without ptr), a segment override inside the brackets
   * ([es:di]) or outside (es:[di]), far pointers (jmp 0xF000:0xFFF0), jump size hints
   * (jmp short target / jmp near target) and FPU registers st(0)..st(7).
   *
   * Encoding policy (NASM compatible): of every encoding that matches the operands the
   * shortest one wins. That yields the accumulator short forms, group 1 sign-extended
   * imm8 (83 /r), mov reg,imm as B0+r/B8+r, xchg eax,reg as 90+r, push imm as 6A,
   * imul r,r/m,imm8 as 6B and inc/dec reg as 40+r/48+r. mov of a pure absolute address
   * to or from AL/eAX uses the A0-A3 moffs forms. A jump without a size hint takes the
   * shortest form that reaches its target; a jump explicitly marked short that is out of
   * range is reported as an error and never silently moved. mov to/from a segment,
   * control or debug register never emits an operand-size prefix because the size is
   * inherent in the opcode.
   *
   * A memory operand without a size keyword takes the operand size implied by the other
   * operand and otherwise the current bits default (NASM reports an error instead).
   *
   * Errors never escape: assemble() always returns, with errors[] describing every
   * problem found in the final pass.
   */

  function owns(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function mkreg(names) {
    var o = Object.create(null), i;
    for (i = 0; i < names.length; i++) o[names[i]] = i;
    return o;
  }

  var REG8 = mkreg(['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh']);
  var REG16 = mkreg(['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di']);
  var REG32 = mkreg(['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi']);
  var SEGREG = mkreg(['es', 'cs', 'ss', 'ds', 'fs', 'gs']);
  var REG_NAME8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
  var REG_NAME16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
  var REG_NAME32 = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
  var SEG_NAME = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];
  var SEG_PREFIX = [0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65];

  var PREFIX_WORDS = {
    lock: 0xF0, rep: 0xF3, repe: 0xF3, repz: 0xF3, repne: 0xF2, repnz: 0xF2
  };

  var MAX_OUTPUT = 1 << 22;

  function AsmError(line, message) {
    this.line = line >>> 0;
    this.message = message;
  }

  function raise(line, message) {
    throw new AsmError(line, message);
  }

  function errText(e) {
    if (e instanceof AsmError) return e.message;
    if (e && e.message) return e.message;
    return String(e);
  }

  function regLookup(name) {
    if (owns(REG8, name)) return { size: 8, num: REG8[name], name: name };
    if (owns(REG16, name)) return { size: 16, num: REG16[name], name: name };
    if (owns(REG32, name)) return { size: 32, num: REG32[name], name: name };
    return null;
  }

  function regName(size, num) {
    if (size === 8) return REG_NAME8[num];
    if (size === 16) return REG_NAME16[num];
    return REG_NAME32[num];
  }

  function isIdentStart(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' ||
           ch === '.' || ch === '@' || ch === '?';
  }

  function isIdentChar(ch) {
    return isIdentStart(ch) || (ch >= '0' && ch <= '9') || ch === '#' || ch === '$';
  }

  /* ---------------------------------------------------------------- expressions */

  function numberValue(text) {
    var lower = text.toLowerCase(), body = lower, base = 10, i, v = 0, ch, d;
    if (body.length > 2 && body.charAt(0) === '0' && body.charAt(1) === 'x') {
      base = 16; body = body.slice(2);
    } else if (body.length > 2 && body.charAt(0) === '0' && body.charAt(1) === 'b' &&
               /^[01]+$/.test(body.slice(2))) {
      base = 2; body = body.slice(2);
    } else if (body.length > 2 && body.charAt(0) === '0' && body.charAt(1) === 'o') {
      base = 8; body = body.slice(2);
    } else {
      var last = body.charAt(body.length - 1), head = body.slice(0, -1);
      if (last === 'h' && head.length && /^[0-9a-f]+$/.test(head)) {
        base = 16; body = head;
      } else if (last === 'b' && head.length && /^[01]+$/.test(head)) {
        base = 2; body = head;
      } else if ((last === 'o' || last === 'q') && head.length && /^[0-7]+$/.test(head)) {
        base = 8; body = head;
      } else if (!/^[0-9]+$/.test(body)) {
        return null;
      }
    }
    if (!body.length) return null;
    for (i = 0; i < body.length; i++) {
      ch = body.charAt(i);
      if (ch >= '0' && ch <= '9') d = ch.charCodeAt(0) - 48;
      else if (ch >= 'a' && ch <= 'f') d = ch.charCodeAt(0) - 87;
      else return null;
      if (d >= base) return null;
      v = v * base + d;
      if (v > 0xFFFFFFFF) return null;
    }
    return v >>> 0;
  }

  var ESCAPES = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, '\'': 39, '"': 34, b: 8, f: 12, v: 11 };

  function charValue(text, line) {
    var s = text, i = 0, v = 0, count = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '\\') {
        var nxt = s.charAt(i + 1);
        if (nxt === 'x' || nxt === 'X') {
          var hex = s.slice(i + 2, i + 4);
          if (!/^[0-9a-fA-F]{1,2}$/.test(hex)) raise(line, 'bad hex escape in character constant');
          v = (v * 256) + parseInt(hex, 16);
          i += 2 + hex.length;
        } else if (owns(ESCAPES, nxt)) {
          v = (v * 256) + ESCAPES[nxt];
          i += 2;
        } else {
          raise(line, 'unknown escape in character constant: \\' + nxt);
        }
      } else {
        v = (v * 256) + (ch.charCodeAt(0) & 0xFF);
        i++;
      }
      count++;
    }
    if (!count) raise(line, 'empty character constant');
    if (count > 4) raise(line, 'character constant too long');
    return v >>> 0;
  }

  function lexExpr(text, line) {
    var toks = [], i = 0, n = text.length, ch, j, s;
    while (i < n) {
      ch = text.charAt(i);
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '$') {
        if (text.charAt(i + 1) === '$') { toks.push({ t: 'origin' }); i += 2; }
        else { toks.push({ t: 'here' }); i++; }
        continue;
      }
      if (ch >= '0' && ch <= '9') {
        j = i;
        while (j < n && /[0-9a-zA-Z_]/.test(text.charAt(j))) j++;
        s = text.slice(i, j);
        var val = numberValue(s);
        if (val === null) raise(line, 'bad number: ' + s);
        toks.push({ t: 'num', v: val });
        i = j;
        continue;
      }
      if (isIdentStart(ch)) {
        j = i;
        while (j < n && isIdentChar(text.charAt(j))) j++;
        toks.push({ t: 'sym', v: text.slice(i, j).toLowerCase(), raw: text.slice(i, j) });
        i = j;
        continue;
      }
      if (ch === '\'' || ch === '"') {
        j = i + 1;
        var buf = '';
        while (j < n && text.charAt(j) !== ch) {
          if (text.charAt(j) === '\\') { buf += text.charAt(j); j++; if (j < n) { buf += text.charAt(j); j++; } }
          else { buf += text.charAt(j); j++; }
        }
        if (j >= n) raise(line, 'unterminated character constant');
        toks.push({ t: 'num', v: charValue(buf, line) });
        i = j + 1;
        continue;
      }
      var two = text.substr(i, 2);
      if (two === '<<' || two === '>>' || two === '<=' || two === '>=' ||
          two === '==' || two === '!=' || two === '&&' || two === '||') {
        toks.push({ t: 'op', v: two });
        i += 2;
        continue;
      }
      if ('+-*/%()~!&|^<>'.indexOf(ch) >= 0) {
        toks.push({ t: 'op', v: ch });
        i++;
        continue;
      }
      raise(line, 'unexpected character in expression: ' + ch);
    }
    return toks;
  }

  var BIN_PREC = Object.create(null);
  BIN_PREC['||'] = 1; BIN_PREC['&&'] = 2; BIN_PREC['|'] = 3; BIN_PREC['^'] = 4;
  BIN_PREC['&'] = 5; BIN_PREC['=='] = 6; BIN_PREC['!='] = 6;
  BIN_PREC['<'] = 7; BIN_PREC['>'] = 7; BIN_PREC['<='] = 7; BIN_PREC['>='] = 7;
  BIN_PREC['<<'] = 8; BIN_PREC['>>'] = 8;
  BIN_PREC['+'] = 9; BIN_PREC['-'] = 9;
  BIN_PREC['*'] = 10; BIN_PREC['/'] = 10; BIN_PREC['%'] = 10;

  function parseExpr(text, line) {
    var toks = lexExpr(text, line), pos = 0;

    function peek() { return pos < toks.length ? toks[pos] : null; }
    function next() { return toks[pos++]; }

    function parseUnary() {
      var t = peek();
      if (!t) raise(line, 'expression expected');
      if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!')) {
        next();
        return { op: t.v === '+' ? 'u+' : (t.v === '-' ? 'u-' : t.v), a: parseUnary() };
      }
      if (t.t === 'op' && t.v === '(') {
        next();
        var inner = parseBinary(0);
        var close = peek();
        if (!close || close.t !== 'op' || close.v !== ')') raise(line, 'missing ) in expression');
        next();
        return inner;
      }
      if (t.t === 'num') { next(); return { num: t.v }; }
      if (t.t === 'sym') { next(); return { sym: t.v }; }
      if (t.t === 'here') { next(); return { here: true }; }
      if (t.t === 'origin') { next(); return { origin: true }; }
      raise(line, 'unexpected token in expression: ' + (t.v === undefined ? t.t : t.v));
    }

    function parseBinary(minPrec) {
      var left = parseUnary();
      for (;;) {
        var t = peek();
        if (!t || t.t !== 'op' || !owns(BIN_PREC, t.v)) return left;
        var prec = BIN_PREC[t.v];
        if (prec < minPrec) return left;
        next();
        var right = parseBinary(prec + 1);
        left = { op: t.v, a: left, b: right };
      }
    }

    var ast = parseBinary(0);
    if (pos !== toks.length) raise(line, 'trailing junk in expression');
    return ast;
  }

  function UNKNOWN() { return { known: false, value: 0 }; }

  function evalExpr(ast, ctx, depth) {
    if (!ast) return UNKNOWN();
    depth = depth || 0;
    if (depth > 24) raise(ctx.line, 'expression nesting too deep');
    if (ast.num !== undefined) return { known: true, value: ast.num >>> 0 };
    if (ast.here) return { known: true, value: ctx.curAddr >>> 0 };
    if (ast.origin) return { known: true, value: ctx.origin >>> 0 };
    if (ast.sym) {
      var nm = ast.sym;
      if (nm.charAt(0) === '.') {
        if (!ctx.globalLabel) raise(ctx.line, 'local label used outside a global label: ' + nm);
        nm = ctx.globalLabel.toLowerCase() + nm;
      }
      return resolveSymbol(nm, ctx, depth);
    }
    var a = evalExpr(ast.a, ctx, depth + 1);
    if (ast.op === 'u-') return a.known ? { known: true, value: (-a.value) >>> 0 } : UNKNOWN();
    if (ast.op === 'u+') return a;
    if (ast.op === '~') return a.known ? { known: true, value: (~a.value) >>> 0 } : UNKNOWN();
    if (ast.op === '!') return a.known ? { known: true, value: a.value ? 0 : 1 } : UNKNOWN();
    var b = evalExpr(ast.b, ctx, depth + 1);
    if (!a.known || !b.known) return UNKNOWN();
    var x = a.value, y = b.value, r;
    switch (ast.op) {
      case '+': r = (x + y) >>> 0; break;
      case '-': r = (x - y) >>> 0; break;
      case '*': r = Math.imul(x, y) >>> 0; break;
      case '/': if (!y) raise(ctx.line, 'division by zero in expression'); r = (x / y) >>> 0; break;
      case '%': if (!y) raise(ctx.line, 'division by zero in expression'); r = (x % y) >>> 0; break;
      case '<<': r = (x << (y & 31)) >>> 0; break;
      case '>>': r = (x >>> (y & 31)) >>> 0; break;
      case '&': r = (x & y) >>> 0; break;
      case '|': r = (x | y) >>> 0; break;
      case '^': r = (x ^ y) >>> 0; break;
      case '==': r = x === y ? 1 : 0; break;
      case '!=': r = x !== y ? 1 : 0; break;
      case '<': r = x < y ? 1 : 0; break;
      case '>': r = x > y ? 1 : 0; break;
      case '<=': r = x <= y ? 1 : 0; break;
      case '>=': r = x >= y ? 1 : 0; break;
      case '&&': r = (x && y) ? 1 : 0; break;
      case '||': r = (x || y) ? 1 : 0; break;
      default: raise(ctx.line, 'unsupported operator: ' + ast.op);
    }
    return { known: true, value: r >>> 0 };
  }

  function resolveSymbol(name, ctx, depth) {
    if (ctx.symbols.has(name)) return { known: true, value: ctx.symbols.get(name) };
    if (ctx.lower && ctx.lower.has(name)) return { known: true, value: ctx.lower.get(name) };
    if (ctx.defines.has(name)) {
      var d = ctx.defines.get(name);
      return { known: true, value: d >>> 0 };
    }
    if (ctx.redefine && owns(ctx.redefine, name)) {
      if (depth > 12) raise(ctx.line, 'recursive %define: ' + name);
      return evalExpr(ctx.redefine[name], ctx, depth + 1);
    }
    if (ctx.missing && ctx.missing.indexOf(name) < 0 && ctx.missing.length < 8) ctx.missing.push(name);
    return UNKNOWN();
  }

  function evalValue(ast, ctx) {
    var r = evalExpr(ast, ctx);
    if (!r.known) return null;
    var v = r.value >>> 0;
    return v > 0x7FFFFFFF ? v - 0x100000000 : v;
  }


  /* ---------------------------------------------------------------- line parsing */

  function stripComment(line) {
    var quote = 0, i, ch;
    for (i = 0; i < line.length; i++) {
      ch = line.charAt(i);
      if (quote) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote) quote = 0;
        continue;
      }
      if (ch === '\'' || ch === '"') { quote = ch; continue; }
      if (ch === ';') return line.slice(0, i);
    }
    return line;
  }

  function splitTop(text) {
    var out = [], depth = 0, quote = 0, cur = '', i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (quote) {
        cur += ch;
        if (ch === '\\') { cur += text.charAt(++i); }
        else if (ch === quote) quote = 0;
        continue;
      }
      if (ch === '\'' || ch === '"') { quote = ch; cur += ch; continue; }
      if (ch === '[' || ch === '(') { depth++; cur += ch; continue; }
      if (ch === ']' || ch === ')') { depth--; cur += ch; continue; }
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim() !== '' || out.length) out.push(cur.trim());
    if (out.length === 1 && out[0] === '') out = [];
    return out;
  }

  function splitTerms(text) {
    var out = [], cur = '', sign = 1, depth = 0, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0 && (ch === '+' || ch === '-')) {
        if (cur.trim() === '') {
          if (ch === '-') sign = -sign;
          continue;
        }
        out.push({ sign: sign, text: cur });
        cur = '';
        sign = (ch === '-') ? -1 : 1;
        continue;
      }
      cur += ch;
    }
    if (cur.trim() !== '') out.push({ sign: sign, text: cur });
    return out;
  }

  var SIZE_WORDS = {
    byte: 8, word: 16, dword: 32, qword: 64, tword: 80, tbyte: 80, oword: 128
  };

  function stripSizeWords(text) {
    var size = 0, hint = '', rest = text, m, w;
    for (;;) {
      m = /^(byte|word|dword|qword|tword|tbyte|oword|near|far|short)\s+/i.exec(rest);
      if (!m) break;
      w = m[1].toLowerCase();
      if (w === 'near' || w === 'far' || w === 'short') hint = w;
      else size = SIZE_WORDS[w];
      rest = rest.slice(m[0].length);
    }
    m = /^ptr\s+/i.exec(rest);
    if (m) rest = rest.slice(m[0].length);
    return { size: size, hint: hint, text: rest };
  }

  function stringBytes(text, line) {
    if (!text.length) return [];
    var quote = text.charAt(0), out = [], i = 1;
    if (quote !== '\'' && quote !== '"') raise(line, 'not a string constant');
    while (i < text.length) {
      var ch = text.charAt(i);
      if (ch === quote) {
        if (i + 1 < text.length) raise(line, 'trailing junk after string constant');
        return out;
      }
      if (ch === '\\') {
        var nxt = text.charAt(i + 1);
        if (nxt === 'x' || nxt === 'X') {
          var hex = text.slice(i + 2, i + 4);
          if (!/^[0-9a-fA-F]{1,2}$/.test(hex)) raise(line, 'bad hex escape in string');
          out.push(parseInt(hex, 16));
          i += 2 + hex.length;
        } else if (owns(ESCAPES, nxt)) {
          out.push(ESCAPES[nxt]);
          i += 2;
        } else {
          raise(line, 'unknown escape in string: \\' + nxt);
        }
        continue;
      }
      out.push(ch.charCodeAt(0) & 0xFF);
      i++;
    }
    raise(line, 'unterminated string constant');
  }

  function parseMemOperand(core, size, seg, line) {
    var inner = core.slice(1, -1), m, terms, base = null, index = null, scale = 1, disp = null, i;

    m = /^(es|cs|ss|ds|fs|gs)\s*:\s*([\s\S]*)$/i.exec(inner);
    if (m) { seg = SEGREG[m[1].toLowerCase()]; inner = m[2]; }

    terms = splitTerms(inner);
    for (i = 0; i < terms.length; i++) {
      var t = terms[i].text.trim(), sign = terms[i].sign, r = null, mm;
      if (!t) continue;
      mm = /^([A-Za-z][A-Za-z0-9]*)\s*\*\s*([0-9A-Za-z]+)$/.exec(t);
      if (mm) {
        r = regLookup(mm[1].toLowerCase());
        if (!r) raise(line, 'not a register: ' + mm[1]);
        var sv = numberValue(mm[2]);
        if (sv === null) raise(line, 'bad scale: ' + mm[2]);
        if (index) raise(line, 'too many index registers in address');
        if (sv !== 1 && sv !== 2 && sv !== 4 && sv !== 8) raise(line, 'invalid scale factor: ' + sv);
        index = r;
        scale = sv;
        continue;
      }
      mm = /^([0-9]+)\s*\*\s*([A-Za-z][A-Za-z0-9]*)$/.exec(t);
      if (mm) {
        r = regLookup(mm[2].toLowerCase());
        if (!r) raise(line, 'not a register: ' + mm[2]);
        var sv2 = numberValue(mm[1]);
        if (sv2 !== 1 && sv2 !== 2 && sv2 !== 4 && sv2 !== 8) raise(line, 'invalid scale factor: ' + sv2);
        if (index) raise(line, 'too many index registers in address');
        index = r;
        scale = sv2;
        continue;
      }
      r = regLookup(t.toLowerCase());
      if (r) {
        if (!base) { base = r; continue; }
        if (!index) { index = r; scale = scale === 1 ? 1 : scale; continue; }
        raise(line, 'too many registers in address: ' + inner);
      }
      var part = parseExpr(sign < 0 ? '-' + t : t, line);
      disp = disp ? { op: '+', a: disp, b: part } : part;
    }
    if (base && index && base.size !== index.size) {
      raise(line, 'cannot mix 16-bit and 32-bit registers in an address');
    }
    if (!base && index && index.size === 16) {
      base = index; index = null;
      if (scale !== 1) raise(line, 'scale is not allowed with 16-bit addressing');
    }
    return { t: 'mem', size: size || 0, seg: seg, base: base, index: index, scale: scale, disp: ast0(disp) };
  }

  function ast0(a) { return a; }

  function parseOperand(text, line) {
    var kw = stripSizeWords(text.trim());
    var core = kw.text.trim(), m, r;
    if (!core) raise(line, 'empty operand');

    var seg = null;
    m = /^(es|cs|ss|ds|fs|gs)\s*:\s*([\s\S]+)$/i.exec(core);
    if (m) {
      seg = SEGREG[m[1].toLowerCase()];
      core = m[2].trim();
      if (core.charAt(0) === '[') {
        var mem1 = parseMemOperand(core, kw.size, seg, line);
        return finishMem(mem1, kw, line);
      }
      return { t: 'mem', size: kw.size, seg: seg, base: null, index: null, scale: 1, disp: parseExpr(core, line) };
    }

    if (core.charAt(0) === '[') {
      if (core.charAt(core.length - 1) !== ']') raise(line, 'missing ] in memory operand');
      var mem2 = parseMemOperand(core, kw.size, null, line);
      return finishMem(mem2, kw, line);
    }

    if (core.charAt(core.length - 1) === ']') raise(line, 'missing [ in memory operand');

    m = /^st\s*\(\s*([0-7])\s*\)$/i.exec(core);
    if (m) return { t: 'st', num: parseInt(m[1], 10), hint: kw.hint };
    m = /^st([0-7])$/i.exec(core);
    if (m) return { t: 'st', num: parseInt(m[1], 10), hint: kw.hint };
    if (/^st$/i.test(core)) return { t: 'st', num: 0, hint: kw.hint };

    m = /^(cr|dr)([0-7])$/i.exec(core);
    if (m) return { t: m[1].toLowerCase() === 'cr' ? 'cr' : 'dr', num: parseInt(m[2], 10), hint: kw.hint };

    r = regLookup(core.toLowerCase());
    if (r) return { t: 'reg', size: r.size, num: r.num, name: r.name, hint: kw.hint };

    if (owns(SEGREG, core.toLowerCase())) {
      return { t: 'sreg', num: SEGREG[core.toLowerCase()], name: core.toLowerCase(), hint: kw.hint };
    }

    var colon = topColon(core);
    if (colon > 0) {
      return {
        t: 'far',
        seg: parseExpr(core.slice(0, colon), line),
        off: parseExpr(core.slice(colon + 1), line),
        hint: kw.hint || 'far'
      };
    }

    return { t: 'imm', ast: parseExpr(core, line), size: kw.size || 0, hint: kw.hint || '' };
  }

  function finishMem(mem, kw, line) {
    if (kw.hint === 'short') raise(line, 'short is not a memory size');
    mem.hint = kw.hint || '';
    return mem;
  }

  function topColon(text) {
    var depth = 0, quote = 0, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (quote) { if (ch === quote) quote = 0; continue; }
      if (ch === '\'' || ch === '"') { quote = ch; continue; }
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === ':' && depth === 0) return i;
    }
    return -1;
  }

  var DATA_UNIT = { db: 1, dw: 2, dd: 4, dq: 8, dt: 10 };
  var RES_UNIT = { resb: 1, resw: 2, resd: 4 };

  function parseDataItems(text, line) {
    var parts = splitTop(text), items = [], i;
    if (!parts.length) raise(line, 'data directive needs at least one value');
    for (i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) raise(line, 'empty value in data directive');
      if (p.charAt(0) === '\'' || p.charAt(0) === '"') {
        items.push({ t: 'str', bytes: stringBytes(p, line) });
      } else {
        items.push({ t: 'num', ast: parseExpr(p, line) });
      }
    }
    return items;
  }

  function isPrefixWord(w) {
    return owns(PREFIX_WORDS, w);
  }

  function parseStatements(text, lineNo, state) {
    var out = [], rest = text, m, dm, dd;
    if (rest.charAt(0) === '%') {
      dm = /^%([A-Za-z]+)\s*([\s\S]*)$/.exec(rest);
      if (!dm) raise(lineNo, 'bad preprocessor directive: ' + rest);
      if (dm[1].toLowerCase() !== 'define') {
        raise(lineNo, 'unsupported preprocessor directive: %' + dm[1]);
      }
      dd = /^([A-Za-z_][A-Za-z0-9_.$]*)\s+([\s\S]+)$/.exec(dm[2].trim());
      if (!dd) raise(lineNo, '%define needs a name and a value');
      state.defines.set(dd[1].toLowerCase(), { ast: parseExpr(dd[2], lineNo) });
      return { stmts: out, bits: state.bits, global: state.global };
    }
    for (;;) {
      m = /^([A-Za-z_.@?][A-Za-z0-9_.@?$#]*)\s*:/.exec(rest);
      if (!m) break;
      var name = m[1];
      var lower = name.toLowerCase();
      if (owns(SEGREG, lower) || isPrefixWord(lower) || owns(SIZE_WORDS, lower)) break;
      if (name.charAt(0) === '.') {
        if (!state.global) raise(lineNo, 'local label without a preceding global label');
        name = state.global + name;
      } else {
        state.global = name;
      }
      out.push({ kind: 'label', name: name, line: lineNo, text: rest });
      rest = rest.slice(m[0].length).trim();
      if (!rest) return { stmts: out, bits: state.bits, global: state.global };
    }

    var prefixes = { lock: false, rep: null, seg: null };
    if (state.pending) {
      prefixes = { lock: state.pending.lock, rep: state.pending.rep, seg: state.pending.seg };
      state.pending = null;
    }

    for (;;) {
      m = /^(es|cs|ss|ds|fs|gs)\s*:\s*/i.exec(rest);
      if (m && rest.length > m[0].length) {
        prefixes.seg = SEGREG[m[1].toLowerCase()];
        rest = rest.slice(m[0].length);
        continue;
      }
      m = /^(es|cs|ss|ds|fs|gs)\s+/i.exec(rest);
      if (m && rest.length > m[0].length) {
        prefixes.seg = SEGREG[m[1].toLowerCase()];
        rest = rest.slice(m[0].length);
        continue;
      }
      m = /^([A-Za-z][A-Za-z0-9]*)(?:\s+|$)([\s\S]*)$/.exec(rest);
      if (!m) break;
      var w = m[1].toLowerCase();
      if (isPrefixWord(w)) {
        if (w === 'lock') prefixes.lock = true;
        else prefixes.rep = PREFIX_WORDS[w];
        rest = m[2].trim();
        if (!rest) {
          state.pending = { lock: prefixes.lock, rep: prefixes.rep, seg: prefixes.seg };
          return { stmts: out, bits: state.bits, global: state.global };
        }
        continue;
      }
      break;
    }

    if (state.pending) bad(state);
    function bad() { state.pending = null; }

    m = /^([A-Za-z][A-Za-z0-9]*)\s*([\s\S]*)$/.exec(rest);
    if (!m) raise(lineNo, 'cannot parse: ' + rest);
    var word = m[1].toLowerCase(), args = m[2].trim(), stmt;

    if (word === 'equ') raise(lineNo, 'equ needs a name on the left');

    var em = /^([A-Za-z_.@?][A-Za-z0-9_.@?$#]*)\s+equ\s+([\s\S]+)$/i.exec(rest);
    if (em) {
      out.push({ kind: 'equ', name: em[1], expr: parseExpr(em[2], lineNo), line: lineNo, text: rest });
      return { stmts: out, bits: state.bits, global: state.global };
    }

    if (word === 'bits') {
      var bv = evalConst(parseExpr(args, lineNo), lineNo);
      if (bv !== 16 && bv !== 32) raise(lineNo, 'bits must be 16 or 32');
      return {
        stmts: out.concat([{ kind: 'bits', line: lineNo, text: rest, value: bv }]),
        bits: bv,
        global: state.global
      };
    }
    if (word === 'org') {
      out.push({ kind: 'org', expr: parseExpr(args, lineNo), line: lineNo, text: rest });
      return { stmts: out, bits: state.bits, global: state.global };
    }
    if (owns(DATA_UNIT, word)) {
      out.push({ kind: 'data', unit: DATA_UNIT[word], items: parseDataItems(args, lineNo), line: lineNo, text: rest, count: null });
      return { stmts: out, bits: state.bits, global: state.global };
    }
    if (owns(RES_UNIT, word)) {
      out.push({ kind: 'res', unit: RES_UNIT[word], count: parseExpr(args, lineNo), line: lineNo, text: rest });
      return { stmts: out, bits: state.bits, global: state.global };
    }
    if (word === 'times') {
      var split = splitTimes(args, lineNo);
      var inner = parseStatements(split.rest, lineNo, { bits: state.bits, global: state.global, defines: state.defines });
      if (inner.stmts.length !== 1 || inner.stmts[0].kind === 'label') {
        raise(lineNo, 'times needs exactly one directive or instruction');
      }
      inner.stmts[0].count = parseExpr(split.count, lineNo);
      inner.stmts[0].text = rest;
      inner.stmts[0].line = lineNo;
      return { stmts: out.concat(inner.stmts), bits: inner.bits, global: inner.global };
    }

    stmt = {
      kind: 'insn',
      mnemonic: word,
      operands: args ? splitTop(args).map(function (o) { return parseOperand(o, lineNo); }) : [],
      line: lineNo,
      text: rest,
      prefix: prefixes
    };
    out.push(stmt);
    return { stmts: out, bits: state.bits, global: state.global };
  }

  function splitTimes(args, line) {
    var m = /^([\s\S]*?)\s+([A-Za-z][A-Za-z0-9]*)\s*([\s\S]*)$/.exec(args);
    if (!m) raise(line, 'times needs a count and an instruction');
    var w = m[2].toLowerCase();
    if (!owns(DATA_UNIT, w) && !owns(RES_UNIT, w) && !INSTRUCTIONS[w]) {
      raise(line, 'times: unsupported target ' + m[2]);
    }
    return { count: m[1], rest: m[2] + (m[3] ? ' ' + m[3] : '') };
  }

  function evalConst(ast, line) {
    var v = evalValue(ast, { symbols: new Map(), defines: new Map(), redefine: Object.create(null), curAddr: 0, origin: 0, line: line });
    if (v === null) raise(line, 'not a constant expression');
    return v;
  }


  /* ---------------------------------------------------------------- encoding core */

  function fitsS8(v) { return v >= -128 && v <= 127; }
  function fitsU8(v) { return v >= 0 && v <= 255; }
  function fitsS16(v) { return v >= -32768 && v <= 32767; }
  function fitsU16(v) { return v >= 0 && v <= 65535; }

  function pushLE(out, value, nbytes) {
    var i;
    for (i = 0; i < nbytes; i++) out.push(i < 4 ? ((value >>> (i * 8)) & 0xFF) : 0);
  }

  function addrSizeOf(op, st) {
    if (!op || op.t !== 'mem') return 0;
    if (op.base) return op.base.size;
    if (op.index) return op.index.size;
    return st.bits === 16 ? 16 : 32;
  }

  function code16(mem) {
    var b = mem.base ? mem.base.num : -1, i = mem.index ? mem.index.num : -1;
    if (mem.base && mem.base.size !== 16) return -1;
    if (mem.index && mem.index.size !== 16) return -1;
    if (b >= 0 && i >= 0) {
      if ((b === 3 && i === 6) || (b === 6 && i === 3)) return 0;
      if ((b === 3 && i === 7) || (b === 7 && i === 3)) return 1;
      if ((b === 5 && i === 6) || (b === 6 && i === 5)) return 2;
      if ((b === 5 && i === 7) || (b === 7 && i === 5)) return 3;
      return -1;
    }
    if (b >= 0) {
      if (b === 3) return 7;
      if (b === 5) return 6;
      if (b === 6) return 4;
      if (b === 7) return 5;
      return -1;
    }
    if (i >= 0) {
      if (i === 6) return 4;
      if (i === 7) return 5;
      return -1;
    }
    return 6;
  }

  function memText(mem) {
    if (!mem.base && !mem.index) return '[absolute]';
    var s = '[';
    if (mem.base) s += regName(mem.base.size, mem.base.num);
    if (mem.index) {
      if (mem.base) s += '+';
      s += regName(mem.index.size, mem.index.num) + '*' + mem.scale;
    }
    return s + ']';
  }

  function evalOperand(op, ctx) {
    if (!op || op.t !== 'imm') return { known: false, value: 0 };
    return evalExpr(op.ast, ctx);
  }

  function signedOf(v) {
    v = v >>> 0;
    return v > 0x7FFFFFFF ? v - 0x100000000 : v;
  }

  function encodeMem(out, mem, regField, st, ctx) {
    var addrSize = addrSizeOf(mem, st);
    var d = mem.disp ? evalExpr(mem.disp, ctx) : { known: true, value: 0 };
    var disp = d.value >>> 0, sdisp = signedOf(disp), code, sib, ss, bn;
    if (addrSize === 16) {
      code = code16(mem);
      if (code < 0) raise(ctx.line, 'invalid 16-bit addressing mode ' + memText(mem));
      if (!mem.base && !mem.index) {
        out.push(0x06 | (regField << 3));
        pushLE(out, disp & 0xFFFF, 2);
      } else if (sdisp === 0 && code !== 6) {
        out.push((regField << 3) | code);
      } else if (fitsS8(sdisp)) {
        out.push(0x40 | (regField << 3) | code);
        out.push(sdisp & 0xFF);
      } else {
        out.push(0x80 | (regField << 3) | code);
        pushLE(out, disp & 0xFFFF, 2);
      }
      return d.known;
    }
    if (!mem.base && !mem.index) {
      out.push(0x05 | (regField << 3));
      pushLE(out, disp, 4);
      return d.known;
    }
    if (mem.index) {
      if (mem.index.num === 4) raise(ctx.line, 'esp cannot be used as an index register');
      ss = mem.scale === 1 ? 0 : mem.scale === 2 ? 1 : mem.scale === 4 ? 2 : 3;
      sib = (ss << 6) | (mem.index.num << 3);
      if (mem.base) {
        bn = mem.base.num;
        if (sdisp === 0 && bn !== 5) { out.push((regField << 3) | 4); out.push(sib | bn); }
        else if (fitsS8(sdisp)) { out.push(0x40 | (regField << 3) | 4); out.push(sib | bn); out.push(sdisp & 0xFF); }
        else { out.push(0x80 | (regField << 3) | 4); out.push(sib | bn); pushLE(out, disp, 4); }
      } else {
        out.push((regField << 3) | 4);
        out.push(sib | 5);
        pushLE(out, disp, 4);
      }
      return d.known;
    }
    bn = mem.base.num;
    if (bn === 4) {
      if (sdisp === 0) { out.push((regField << 3) | 4); out.push(0x24); }
      else if (fitsS8(sdisp)) { out.push(0x40 | (regField << 3) | 4); out.push(0x24); out.push(sdisp & 0xFF); }
      else { out.push(0x80 | (regField << 3) | 4); out.push(0x24); pushLE(out, disp, 4); }
      return d.known;
    }
    if (sdisp === 0 && bn !== 5) { out.push((regField << 3) | bn); }
    else if (fitsS8(sdisp)) { out.push(0x40 | (regField << 3) | bn); out.push(sdisp & 0xFF); }
    else { out.push(0x80 | (regField << 3) | bn); pushLE(out, disp, 4); }
    return d.known;
  }

  function isVarSpec(spec) {
    return spec === 'Gv' || spec === 'Ev' || spec === 'Rv' || spec === 'Iv' ||
           spec === 'Jz' || spec === 'Efar' || spec === 'eAX';
  }

  function checkSpec(spec, op, size, ctx, rule, regSize, loose) {
    var v, hint = op.hint || '';
    if (rule && rule.needsize && op.t === 'mem' && !op.size && (spec === 'Eb' || spec === 'Ew')) return false;
    if (op.t === 'mem' && !op.size) {
      if (spec === 'Eb' && !loose && regSize !== 8) return false;
      if (spec === 'Ew' && !loose && regSize !== 16) return false;
      if (spec === 'Ed' && !loose && regSize !== 32) return false;
    }
    switch (spec) {
      case 'Eb': return hint !== 'far' && (op.t === 'reg' ? op.size === 8 : (op.t === 'mem' && (!op.size || op.size === 8)));
      case 'Ew': return hint !== 'far' && (op.t === 'reg' ? op.size === 16 : (op.t === 'mem' && (!op.size || op.size === 16)));
      case 'Ed': return hint !== 'far' && (op.t === 'reg' ? op.size === 32 : (op.t === 'mem' && (!op.size || op.size === 32)));
      case 'Ev': return hint !== 'far' && (op.t === 'reg' ? op.size === size : (op.t === 'mem' && (!op.size || op.size === size)));
      case 'Efar': return op.t === 'mem' && (!op.size || op.size === size);
      case 'Gb': return op.t === 'reg' && op.size === 8;
      case 'Gw': return op.t === 'reg' && op.size === 16;
      case 'Gd': return op.t === 'reg' && op.size === 32;
      case 'Gv': return op.t === 'reg' && op.size === size;
      case 'R8': return op.t === 'reg' && op.size === 8;
      case 'R16': return op.t === 'reg' && op.size === 16;
      case 'R32': return op.t === 'reg' && op.size === 32;
      case 'Rv': return op.t === 'reg' && op.size === size;
      case 'M': return op.t === 'mem' && hint !== 'far';
      case 'Mem8': return op.t === 'mem' && op.size === 8;
      case 'Mem16': return op.t === 'mem' && op.size === 16;
      case 'Mem32': return op.t === 'mem' && op.size === 32;
      case 'Mem64': return op.t === 'mem' && op.size === 64;
      case 'Mem80': return op.t === 'mem' && op.size === 80;
      case 'Mem48': return op.t === 'mem';
      case 'AL': return op.t === 'reg' && op.size === 8 && op.num === 0;
      case 'CL': return op.t === 'reg' && op.size === 8 && op.num === 1;
      case 'DL': return op.t === 'reg' && op.size === 8 && op.num === 2;
      case 'AX': return op.t === 'reg' && op.size === 16 && op.num === 0;
      case 'EAX': return op.t === 'reg' && op.size === 32 && op.num === 0;
      case 'DX': return op.t === 'reg' && op.size === 16 && op.num === 2;
      case 'eAX': return op.t === 'reg' && op.num === 0 && op.size === size && (op.size === 16 || op.size === 32);
      case 'S0': return op.t === 'sreg' && op.num === 0;
      case 'S1': return op.t === 'sreg' && op.num === 1;
      case 'S2': return op.t === 'sreg' && op.num === 2;
      case 'S3': return op.t === 'sreg' && op.num === 3;
      case 'S4': return op.t === 'sreg' && op.num === 4;
      case 'S5': return op.t === 'sreg' && op.num === 5;
      case 'Sw': return op.t === 'sreg';
      case 'Cd': return op.t === 'cr';
      case 'Dd': return op.t === 'dr';
      case 'st': return op.t === 'st';
      case 'st0': return op.t === 'st' && op.num === 0;
      case 'st1': return op.t === 'st' && op.num === 1;
      case 'sti': return op.t === 'st';
      case 'Ap': return op.t === 'far';
      case 'Ob': return op.t === 'mem' && !op.base && !op.index && (!op.size || op.size === 8);
      case 'Ov': return op.t === 'mem' && !op.base && !op.index && (!op.size || op.size === size);
      case 'Ib': {
        v = evalOperand(op, ctx);
        return op.t === 'imm' && (!v.known || fitsU8(v.value) || fitsS8(signedOf(v.value)));
      }
      case 'Ibs': {
        v = evalOperand(op, ctx);
        return op.t === 'imm' && (!v.known || fitsS8(signedOf(v.value)));
      }
      case 'Iw': {
        v = evalOperand(op, ctx);
        return op.t === 'imm' && (!v.known || fitsU16(v.value) || fitsS16(signedOf(v.value)));
      }
      case 'Iv': return op.t === 'imm' && (!evalOperand(op, ctx).known || size === 32 || fitsU16(evalOperand(op, ctx).value) || fitsS16(signedOf(evalOperand(op, ctx).value)));
      case 'Jb': return op.t === 'imm' && hint !== 'near' && hint !== 'far';
      case 'Jz': return op.t === 'imm' && hint !== 'short' && hint !== 'far';
      case '1': {
        v = evalOperand(op, ctx);
        return op.t === 'imm' && v.known && (v.value >>> 0) === 1;
      }
      case '0': {
        v = evalOperand(op, ctx);
        return op.t === 'imm' && v.known && (v.value >>> 0) === 0;
      }
      default: return false;
    }
  }

  function matchRule(rule, st, ctx, loose) {
    var specs = rule.o, ops = st.operands, size = 0, regSize = 0, i, sp, op;
    if (specs.length !== ops.length) return 0;
    for (i = 0; i < ops.length; i++) {
      if (ops[i].t === 'reg') { regSize = ops[i].size; break; }
      if (ops[i].t === 'sreg') { regSize = 16; break; }
      if (ops[i].t === 'cr' || ops[i].t === 'dr') { regSize = 32; break; }
    }
    for (i = 0; i < specs.length; i++) {
      sp = specs[i];
      op = ops[i];
      if (!isVarSpec(sp)) continue;
      if (op.t === 'reg') {
        if (op.size === 8) continue;
        if (size && size !== op.size) return 0;
        size = op.size;
      } else if (op.t === 'mem' && op.size && op.size !== 8) {
        if (size && size !== op.size) return 0;
        size = op.size;
      }
    }
    if (!size) size = st.bits === 16 ? 16 : 32;
    for (i = 0; i < specs.length; i++) {
      if (!checkSpec(specs[i], ops[i], size, ctx, rule, regSize, loose)) return 0;
    }
    return size;
  }

  function regFieldValue(op, ctx) {
    if (op.t === 'reg') return op.num;
    if (op.t === 'sreg') return op.num;
    if (op.t === 'cr' || op.t === 'dr') return op.num;
    raise(ctx.line, 'operand cannot be encoded in the reg field');
  }

  function isRmSpec(spec) {
    if (spec === 'sti') return true;
    if (spec === 'EAX') return false;
    var c = spec.charAt(0);
    return c === 'E' || c === 'M' || c === 'R';
  }

  function specIndex(specs, sel) {
    var i;
    if (sel === undefined || sel === null) return -1;
    if (typeof sel === 'number') return sel;
    for (i = 0; i < specs.length; i++) {
      if (specs[i].charAt(0) === sel) return i;
      if (sel === 'st' && specs[i] === 'sti') return i;
    }
    return -1;
  }

  function buildInstruction(rule, st, ctx, size) {
    var specs = rule.o, ops = st.operands, out = [], unknown = false;
    var plusIdx = specIndex(specs, rule.plus);
    var regIdx = -1, rmIdx = -1, i, j, op, sp, c;

    if (rule.selfrm !== undefined) {
      rmIdx = rule.selfrm;
      regIdx = rule.selfrm;
    } else {
      for (i = 0; i < specs.length; i++) {
        if (i === plusIdx) continue;
        c = specs[i].charAt(0);
        if (specs[i] === 'Cd' || specs[i] === 'Dd') { if (regIdx < 0) regIdx = i; }
        else if (c === 'G' || c === 'S') { if (regIdx < 0) regIdx = i; }
        else if (isRmSpec(specs[i])) { if (rmIdx < 0) rmIdx = i; }
      }
    }

    var effSize = rule.osize === undefined ? size : (rule.osize === 'v' ? st.bits : rule.osize);
    var addrSize = 0;
    if (rmIdx >= 0 && ops[rmIdx].t === 'mem') addrSize = addrSizeOf(ops[rmIdx], st);
    if (!addrSize) {
      for (i = 0; i < ops.length; i++) {
        if (ops[i].t === 'mem') { addrSize = addrSizeOf(ops[i], st); break; }
      }
    }

    if (st.prefix.lock) out.push(0xF0);
    if (st.prefix.rep) out.push(st.prefix.rep);
    var seg = st.prefix.seg;
    if (seg === null || seg === undefined) {
      for (i = 0; i < ops.length; i++) {
        if (ops[i].t === 'mem' && ops[i].seg !== null && ops[i].seg !== undefined) { seg = ops[i].seg; break; }
      }
    }
    if (seg !== null && seg !== undefined) out.push(SEG_PREFIX[seg]);
    if (!rule.noprefix && (effSize === 16 || effSize === 32) && effSize !== st.bits) out.push(0x66);
    if (addrSize && addrSize !== st.bits) out.push(0x67);

    for (i = 0; i < rule.op.length; i++) out.push(rule.op[i]);
    if (plusIdx >= 0) out[out.length - 1] += regFieldValue(ops[plusIdx], ctx);

    var regField = 0;
    if (rule.grp !== undefined) regField = rule.grp;
    else if (regIdx >= 0) regField = regFieldValue(ops[regIdx], ctx);

    if (rmIdx >= 0) {
      op = ops[rmIdx];
      if (op.t === 'mem') {
        if (!encodeMem(out, op, regField, st, ctx)) unknown = true;
      } else if (op.t === 'reg' || op.t === 'st') {
        out.push(0xC0 | (regField << 3) | op.num);
      } else {
        raise(ctx.line, 'operand cannot be encoded in the rm field');
      }
    }

    for (i = 0; i < specs.length; i++) {
      sp = specs[i];
      op = ops[i];
      if (sp === 'Ap') {
        var o1 = evalExpr(op.off, ctx), s1 = evalExpr(op.seg, ctx);
        if (!o1.known || !s1.known) unknown = true;
        pushLE(out, o1.value, effSize === 16 ? 2 : 4);
        pushLE(out, s1.value & 0xFFFF, 2);
        continue;
      }
      if (sp === 'Jb') {
        var tgt = evalOperand(op, ctx);
        if (!tgt.known) { unknown = true; out.push(0); continue; }
        var rel = (tgt.value >>> 0) - ((st.addr + out.length + 1) >>> 0);
        if (!fitsS8(signedOf(rel))) {
          raise(ctx.line, 'short jump out of range by ' + (Math.abs(signedOf(rel)) - 128) + ' bytes');
        }
        out.push(rel & 0xFF);
        continue;
      }
      if (sp === 'Jz') {
        var tgt2 = evalOperand(op, ctx);
        var n = effSize === 16 ? 2 : 4;
        if (!tgt2.known) { unknown = true; pushLE(out, 0, n); continue; }
        var rel2 = signedOf((tgt2.value >>> 0) - ((st.addr + out.length + n) >>> 0));
        if (effSize === 16 && !fitsS16(rel2)) raise(ctx.line, 'near jump out of range');
        pushLE(out, rel2, n);
        continue;
      }
      if (sp === 'Ob' || sp === 'Ov') {
        var dv = op.disp ? evalExpr(op.disp, ctx) : { known: true, value: 0 };
        if (!dv.known) unknown = true;
        pushLE(out, dv.value, addrSize === 16 ? 2 : 4);
        continue;
      }
      if (sp.charAt(0) !== 'I') continue;
      var v = evalOperand(op, ctx);
      if (!v.known) unknown = true;
      var val = v.value >>> 0, nb;
      if (sp === 'Ib' || sp === 'Ibs') nb = 1;
      else if (sp === 'Iw') nb = 2;
      else if (sp === 'Id') nb = 4;
      else nb = effSize === 16 ? 2 : 4;
      if (sp === 'Ibs') {
        if (v.known && !fitsS8(signedOf(val))) raise(ctx.line, 'immediate does not fit in a signed byte');
      } else if (sp === 'Ib') {
        if (v.known && !fitsU8(val) && !fitsS8(signedOf(val))) raise(ctx.line, 'immediate does not fit in a byte');
      } else if (sp === 'Iw') {
        if (v.known && !fitsU16(val) && !fitsS16(signedOf(val))) raise(ctx.line, 'immediate does not fit in a word');
      } else if (nb === 2) {
        if (v.known && !fitsU16(val) && !fitsS16(signedOf(val))) raise(ctx.line, 'immediate does not fit in 16 bits');
      }
      pushLE(out, val, nb);
    }

    return { bytes: out, unknown: unknown };
  }

  function encodeInstruction(st, ctx) {
    var rules = INSTRUCTIONS[st.mnemonic], i, size, best = null, cand, total, firstErr = null, pass;
    if (!rules) {
      if (REJECTED[st.mnemonic]) raise(st.line, REJECTED[st.mnemonic]);
      raise(st.line, 'unknown instruction: ' + st.mnemonic);
    }
    for (pass = 0; pass < 2 && !best; pass++) {
      for (i = 0; i < rules.length; i++) {
        size = matchRule(rules[i], st, ctx, pass === 1);
        if (!size) continue;
        try {
          cand = buildInstruction(rules[i], st, ctx, size);
        } catch (e) {
          if (e instanceof AsmError) { if (!firstErr) firstErr = e; continue; }
          throw e;
        }
        if (!best || cand.bytes.length < best.bytes.length) best = cand;
      }
    }
    if (!best) {
      if (firstErr) throw firstErr;
      var why = '';
      if (st.operands.length) {
        why = ' with operands (' + st.operands.map(operandText).join(', ') + ')';
      }
      raise(st.line, 'invalid combination of operands for ' + st.mnemonic + why);
    }
    total = best.bytes;
    if (st.count) {
      var c = evalExpr(st.count, ctx), n = 1;
      if (!c.known) best.unknown = true;
      else n = c.value >>> 0;
      if (n > MAX_OUTPUT) raise(st.line, 'times count too large: ' + n);
      var all = [];
      for (i = 0; i < n; i++) Array.prototype.push.apply(all, total);
      return { bytes: all, unknown: best.unknown };
    }
    return best;
  }

  function operandText(op) {
    if (!op) return '';
    if (op.t === 'reg') return op.name;
    if (op.t === 'sreg') return op.name;
    if (op.t === 'cr') return 'cr' + op.num;
    if (op.t === 'dr') return 'dr' + op.num;
    if (op.t === 'st') return 'st(' + op.num + ')';
    if (op.t === 'mem') return 'memory';
    if (op.t === 'far') return 'far pointer';
    return 'immediate';
  }

  function encodeData(st, ctx) {
    var out = [], unknown = false, i, k, n = 1;
    if (st.count) {
      var c = evalExpr(st.count, ctx);
      if (!c.known) unknown = true;
      else n = c.value >>> 0;
      if (n > MAX_OUTPUT) raise(st.line, 'times count too large: ' + n);
    }
    for (k = 0; k < n; k++) {
      for (i = 0; i < st.items.length; i++) {
        var it = st.items[i];
        if (it.t === 'str') {
          if (st.unit !== 1) raise(st.line, 'string constants are only allowed in db');
          Array.prototype.push.apply(out, it.bytes);
          continue;
        }
        var v = evalExpr(it.ast, ctx);
        if (!v.known) { unknown = true; pushLE(out, 0, st.unit); continue; }
        pushLE(out, v.value, st.unit);
      }
      if (out.length > MAX_OUTPUT) raise(st.line, 'data too large');
    }
    return { bytes: out, unknown: unknown };
  }

  function encodeRes(st, ctx) {
    var c = evalExpr(st.count, ctx), n;
    if (!c.known) raise(st.line, 'reservation size is not a constant');
    n = c.value >>> 0;
    if (n * st.unit > MAX_OUTPUT) raise(st.line, 'reservation too large');
    var out = [];
    for (var i = 0; i < n * st.unit; i++) out.push(0);
    return { bytes: out, unknown: false };
  }


  /* ---------------------------------------------------------------- instruction table */

  var INSTRUCTIONS = Object.create(null);
  var REJECTED = Object.create(null);

  function def(mnemonic, rule) {
    if (!INSTRUCTIONS[mnemonic]) INSTRUCTIONS[mnemonic] = [];
    INSTRUCTIONS[mnemonic].push(rule);
  }

  var CC_CODES = [
    ['o', 0], ['no', 1], ['b', 2], ['ae', 3], ['e', 4], ['ne', 5], ['be', 6], ['a', 7],
    ['s', 8], ['ns', 9], ['p', 10], ['np', 11], ['l', 12], ['ge', 13], ['le', 14], ['g', 15]
  ];
  var CC_ALIAS = {
    c: 2, nae: 2, nc: 3, nb: 3, z: 4, nz: 5, na: 6, nbe: 7,
    pe: 10, po: 11, nge: 12, nl: 12, ng: 14, nle: 15
  };

  REJECTED.rdtsc = 'rdtsc is a Pentium instruction; a 486DX has no time stamp counter';
  REJECTED.rdmsr = 'rdmsr is a Pentium instruction and is not available on a 486DX';
  REJECTED.wrmsr = 'wrmsr is a Pentium instruction and is not available on a 486DX';
  REJECTED.rdpmc = 'rdpmc is a Pentium instruction and is not available on a 486DX';
  REJECTED.cmpxchg8b = 'cmpxchg8b is a Pentium instruction and is not available on a 486DX';
  REJECTED.fxsave = 'fxsave is a Pentium III instruction and is not available on a 486DX';
  REJECTED.fxrstor = 'fxrstor is a Pentium III instruction and is not available on a 486DX';
  REJECTED.sysenter = 'sysenter is a Pentium II instruction and is not available on a 486DX';
  REJECTED.sysexit = 'sysexit is a Pentium II instruction and is not available on a 486DX';
  REJECTED.salc = 'salc is an undocumented opcode and is not supported';
  REJECTED.icebp = 'icebp is an undocumented opcode and is not supported';
  REJECTED.movbe = 'movbe is not a 486 instruction';

  (function buildTables() {
    var i, m, n, b;

    var ARITH = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
    for (i = 0; i < 8; i++) {
      m = ARITH[i];
      b = i * 8;
      def(m, { o: ['Eb', 'Gb'], op: [b], osize: 8 });
      def(m, { o: ['Ev', 'Gv'], op: [b + 1] });
      def(m, { o: ['Gb', 'Eb'], op: [b + 2], osize: 8 });
      def(m, { o: ['Gv', 'Ev'], op: [b + 3] });
      def(m, { o: ['AL', 'Ib'], op: [b + 4], osize: 8 });
      def(m, { o: ['Ev', 'Ibs'], op: [0x83], grp: i });
      def(m, { o: ['eAX', 'Iv'], op: [b + 5] });
      def(m, { o: ['Eb', 'Ib'], op: [0x80], grp: i, osize: 8 });
      def(m, { o: ['Ev', 'Iv'], op: [0x81], grp: i });
    }

    def('test', { o: ['Eb', 'Gb'], op: [0x84], osize: 8 });
    def('test', { o: ['Ev', 'Gv'], op: [0x85] });
    def('test', { o: ['AL', 'Ib'], op: [0xA8], osize: 8 });
    def('test', { o: ['eAX', 'Iv'], op: [0xA9] });
    def('test', { o: ['Eb', 'Ib'], op: [0xF6], grp: 0, osize: 8 });
    def('test', { o: ['Ev', 'Iv'], op: [0xF7], grp: 0 });

    def('xchg', { o: ['Eb', 'Gb'], op: [0x86], osize: 8 });
    def('xchg', { o: ['Ev', 'Gv'], op: [0x87] });
    def('xchg', { o: ['eAX', 'Rv'], op: [0x90], plus: 1 });
    def('xchg', { o: ['Rv', 'eAX'], op: [0x90], plus: 0 });

    def('mov', { o: ['Eb', 'Gb'], op: [0x88], osize: 8 });
    def('mov', { o: ['Ev', 'Gv'], op: [0x89] });
    def('mov', { o: ['Gb', 'Eb'], op: [0x8A], osize: 8 });
    def('mov', { o: ['Gv', 'Ev'], op: [0x8B] });
    def('mov', { o: ['Eb', 'Ib'], op: [0xC6], grp: 0, osize: 8 });
    def('mov', { o: ['Ev', 'Iv'], op: [0xC7], grp: 0 });
    def('mov', { o: ['R8', 'Ib'], op: [0xB0], plus: 0, osize: 8 });
    def('mov', { o: ['R16', 'Iw'], op: [0xB8], plus: 0, osize: 16 });
    def('mov', { o: ['R32', 'Iv'], op: [0xB8], plus: 0, osize: 32 });
    def('mov', { o: ['Sw', 'Ew'], op: [0x8E], osize: 16, noprefix: true });
    def('mov', { o: ['Ew', 'Sw'], op: [0x8C], osize: 16, noprefix: true });
    def('mov', { o: ['AL', 'Ob'], op: [0xA0], osize: 8 });
    def('mov', { o: ['eAX', 'Ov'], op: [0xA1] });
    def('mov', { o: ['Ob', 'AL'], op: [0xA2], osize: 8 });
    def('mov', { o: ['Ov', 'eAX'], op: [0xA3] });
    def('mov', { o: ['R32', 'Cd'], op: [0x0F, 0x20], osize: 32, noprefix: true });
    def('mov', { o: ['R32', 'Dd'], op: [0x0F, 0x21], osize: 32, noprefix: true });
    def('mov', { o: ['Cd', 'R32'], op: [0x0F, 0x22], osize: 32, noprefix: true });
    def('mov', { o: ['Dd', 'R32'], op: [0x0F, 0x23], osize: 32, noprefix: true });

    def('movzx', { o: ['Gv', 'Eb'], op: [0x0F, 0xB6], needsize: true });
    def('movzx', { o: ['Gv', 'Ew'], op: [0x0F, 0xB7], needsize: true });
    def('movsx', { o: ['Gv', 'Eb'], op: [0x0F, 0xBE], needsize: true });
    def('movsx', { o: ['Gv', 'Ew'], op: [0x0F, 0xBF], needsize: true });

    def('lea', { o: ['Gv', 'M'], op: [0x8D] });
    def('les', { o: ['Gv', 'M'], op: [0xC4] });
    def('lds', { o: ['Gv', 'M'], op: [0xC5] });
    def('lss', { o: ['Gv', 'M'], op: [0x0F, 0xB2] });
    def('lfs', { o: ['Gv', 'M'], op: [0x0F, 0xB4] });
    def('lgs', { o: ['Gv', 'M'], op: [0x0F, 0xB5] });

    def('push', { o: ['R16'], op: [0x50], plus: 0, osize: 16 });
    def('push', { o: ['R32'], op: [0x50], plus: 0, osize: 32 });
    def('push', { o: ['Ibs'], op: [0x6A] });
    def('push', { o: ['Iv'], op: [0x68] });
    def('push', { o: ['Ew'], op: [0xFF], grp: 6, osize: 16 });
    def('push', { o: ['Ev'], op: [0xFF], grp: 6 });
    def('push', { o: ['S0'], op: [0x06], osize: 0 });
    def('push', { o: ['S1'], op: [0x0E], osize: 0 });
    def('push', { o: ['S2'], op: [0x16], osize: 0 });
    def('push', { o: ['S3'], op: [0x1E], osize: 0 });
    def('push', { o: ['S4'], op: [0x0F, 0xA0], osize: 0 });
    def('push', { o: ['S5'], op: [0x0F, 0xA8], osize: 0 });
    def('pop', { o: ['R16'], op: [0x58], plus: 0, osize: 16 });
    def('pop', { o: ['R32'], op: [0x58], plus: 0, osize: 32 });
    def('pop', { o: ['Ew'], op: [0x8F], grp: 0, osize: 16 });
    def('pop', { o: ['Ev'], op: [0x8F], grp: 0 });
    def('pop', { o: ['S0'], op: [0x07], osize: 0 });
    def('pop', { o: ['S2'], op: [0x17], osize: 0 });
    def('pop', { o: ['S3'], op: [0x1F], osize: 0 });
    def('pop', { o: ['S4'], op: [0x0F, 0xA1], osize: 0 });
    def('pop', { o: ['S5'], op: [0x0F, 0xA9], osize: 0 });

    def('inc', { o: ['R16'], op: [0x40], plus: 0, osize: 16 });
    def('inc', { o: ['R32'], op: [0x40], plus: 0, osize: 32 });
    def('inc', { o: ['Eb'], op: [0xFE], grp: 0, osize: 8 });
    def('inc', { o: ['Ev'], op: [0xFF], grp: 0 });
    def('dec', { o: ['R16'], op: [0x48], plus: 0, osize: 16 });
    def('dec', { o: ['R32'], op: [0x48], plus: 0, osize: 32 });
    def('dec', { o: ['Eb'], op: [0xFE], grp: 1, osize: 8 });
    def('dec', { o: ['Ev'], op: [0xFF], grp: 1 });

    var GROUP3 = [['not', 2], ['neg', 3], ['mul', 4], ['imul', 5], ['div', 6], ['idiv', 7]];
    for (i = 0; i < GROUP3.length; i++) {
      def(GROUP3[i][0], { o: ['Eb'], op: [0xF6], grp: GROUP3[i][1], osize: 8 });
      def(GROUP3[i][0], { o: ['Ev'], op: [0xF7], grp: GROUP3[i][1] });
    }

    def('imul', { o: ['Gv', 'Ev'], op: [0x0F, 0xAF] });
    def('imul', { o: ['Gv', 'Ev', 'Ibs'], op: [0x6B] });
    def('imul', { o: ['Gv', 'Ev', 'Iv'], op: [0x69] });
    def('imul', { o: ['Gv', 'Ibs'], op: [0x6B], selfrm: 0 });
    def('imul', { o: ['Gv', 'Iv'], op: [0x69], selfrm: 0 });

    var SHIFTS = [['rol', 0], ['ror', 1], ['rcl', 2], ['rcr', 3], ['shl', 4], ['sal', 4], ['shr', 5], ['sar', 7]];
    for (i = 0; i < SHIFTS.length; i++) {
      m = SHIFTS[i][0];
      n = SHIFTS[i][1];
      def(m, { o: ['Eb', '1'], op: [0xD0], grp: n, osize: 8 });
      def(m, { o: ['Ev', '1'], op: [0xD1], grp: n });
      def(m, { o: ['Eb', 'CL'], op: [0xD2], grp: n, osize: 8 });
      def(m, { o: ['Ev', 'CL'], op: [0xD3], grp: n });
      def(m, { o: ['Eb', 'Ib'], op: [0xC0], grp: n, osize: 8 });
      def(m, { o: ['Ev', 'Ib'], op: [0xC1], grp: n });
    }

    def('shld', { o: ['Ev', 'Gv', 'Ib'], op: [0x0F, 0xA4] });
    def('shld', { o: ['Ev', 'Gv', 'CL'], op: [0x0F, 0xA5] });
    def('shrd', { o: ['Ev', 'Gv', 'Ib'], op: [0x0F, 0xAC] });
    def('shrd', { o: ['Ev', 'Gv', 'CL'], op: [0x0F, 0xAD] });

    def('jmp', { o: ['Jb'], op: [0xEB], osize: 'v' });
    def('jmp', { o: ['Jz'], op: [0xE9], osize: 'v' });
    def('jmp', { o: ['Ap'], op: [0xEA], osize: 'v' });
    def('jmp', { o: ['Ev'], op: [0xFF], grp: 4 });
    def('jmp', { o: ['Efar'], op: [0xFF], grp: 5 });
    def('call', { o: ['Jz'], op: [0xE8], osize: 'v' });
    def('call', { o: ['Ap'], op: [0x9A], osize: 'v' });
    def('call', { o: ['Ev'], op: [0xFF], grp: 2 });
    def('call', { o: ['Efar'], op: [0xFF], grp: 3 });
    def('loop', { o: ['Jb'], op: [0xE2], osize: 0 });
    def('loope', { o: ['Jb'], op: [0xE1], osize: 0 });
    def('loopz', { o: ['Jb'], op: [0xE1], osize: 0 });
    def('loopne', { o: ['Jb'], op: [0xE0], osize: 0 });
    def('loopnz', { o: ['Jb'], op: [0xE0], osize: 0 });
    def('jcxz', { o: ['Jb'], op: [0xE3], osize: 16 });
    def('jecxz', { o: ['Jb'], op: [0xE3], osize: 32 });

    for (i = 0; i < CC_CODES.length; i++) {
      m = 'j' + CC_CODES[i][0];
      n = CC_CODES[i][1];
      def(m, { o: ['Jb'], op: [0x70 + n], osize: 'v' });
      def(m, { o: ['Jz'], op: [0x0F, 0x80 + n], osize: 'v' });
      def('set' + CC_CODES[i][0], { o: ['Eb'], op: [0x0F, 0x90 + n], osize: 8 });
      REJECTED['cmov' + CC_CODES[i][0]] =
        'cmov' + CC_CODES[i][0] + ' needs a Pentium Pro; a 486DX has no conditional moves';
    }
    for (m in CC_ALIAS) {
      if (!owns(CC_ALIAS, m)) continue;
      n = CC_ALIAS[m];
      def('j' + m, { o: ['Jb'], op: [0x70 + n], osize: 'v' });
      def('j' + m, { o: ['Jz'], op: [0x0F, 0x80 + n], osize: 'v' });
      def('set' + m, { o: ['Eb'], op: [0x0F, 0x90 + n], osize: 8 });
      REJECTED['cmov' + m] = 'cmov' + m + ' needs a Pentium Pro; a 486DX has no conditional moves';
    }

    var STROPS = [
      ['movsb', 0xA4, 8], ['movsw', 0xA5, 16], ['movsd', 0xA5, 32],
      ['cmpsb', 0xA6, 8], ['cmpsw', 0xA7, 16], ['cmpsd', 0xA7, 32],
      ['stosb', 0xAA, 8], ['stosw', 0xAB, 16], ['stosd', 0xAB, 32],
      ['lodsb', 0xAC, 8], ['lodsw', 0xAD, 16], ['lodsd', 0xAD, 32],
      ['scasb', 0xAE, 8], ['scasw', 0xAF, 16], ['scasd', 0xAF, 32],
      ['insb', 0x6C, 8], ['insw', 0x6D, 16], ['insd', 0x6D, 32],
      ['outsb', 0x6E, 8], ['outsw', 0x6F, 16], ['outsd', 0x6F, 32]
    ];
    for (i = 0; i < STROPS.length; i++) {
      def(STROPS[i][0], { o: [], op: [STROPS[i][1]], osize: STROPS[i][2] });
    }

    def('in', { o: ['AL', 'Ib'], op: [0xE4], osize: 8 });
    def('in', { o: ['AX', 'Ib'], op: [0xE5], osize: 16 });
    def('in', { o: ['EAX', 'Ib'], op: [0xE5], osize: 32 });
    def('in', { o: ['AL', 'DX'], op: [0xEC], osize: 8 });
    def('in', { o: ['AX', 'DX'], op: [0xED], osize: 16 });
    def('in', { o: ['EAX', 'DX'], op: [0xED], osize: 32 });
    def('out', { o: ['Ib', 'AL'], op: [0xE6], osize: 8 });
    def('out', { o: ['Ib', 'AX'], op: [0xE7], osize: 16 });
    def('out', { o: ['Ib', 'EAX'], op: [0xE7], osize: 32 });
    def('out', { o: ['DX', 'AL'], op: [0xEE], osize: 8 });
    def('out', { o: ['DX', 'AX'], op: [0xEF], osize: 16 });
    def('out', { o: ['DX', 'EAX'], op: [0xEF], osize: 32 });

    def('int', { o: ['Ib'], op: [0xCD], osize: 0 });
    def('int3', { o: [], op: [0xCC], osize: 0 });
    def('into', { o: [], op: [0xCE], osize: 0 });
    def('iret', { o: [], op: [0xCF], osize: 'v' });
    def('iretw', { o: [], op: [0xCF], osize: 16 });
    def('iretd', { o: [], op: [0xCF], osize: 32 });
    def('ret', { o: [], op: [0xC3], osize: 'v' });
    def('retn', { o: [], op: [0xC3], osize: 'v' });
    def('ret', { o: ['Iw'], op: [0xC2], osize: 'v' });
    def('retn', { o: ['Iw'], op: [0xC2], osize: 'v' });
    def('retf', { o: [], op: [0xCB], osize: 'v' });
    def('retf', { o: ['Iw'], op: [0xCA], osize: 'v' });
    def('enter', { o: ['Iw', 'Ib'], op: [0xC8], osize: 'v' });
    def('leave', { o: [], op: [0xC9], osize: 'v' });
    def('bound', { o: ['Gv', 'M'], op: [0x62] });
    def('arpl', { o: ['Ew', 'Gw'], op: [0x63], osize: 16, noprefix: true });

    def('nop', { o: [], op: [0x90], osize: 0 });
    def('hlt', { o: [], op: [0xF4], osize: 0 });
    def('wait', { o: [], op: [0x9B], osize: 0 });
    def('fwait', { o: [], op: [0x9B], osize: 0 });
    def('clc', { o: [], op: [0xF8], osize: 0 });
    def('stc', { o: [], op: [0xF9], osize: 0 });
    def('cmc', { o: [], op: [0xF5], osize: 0 });
    def('cli', { o: [], op: [0xFA], osize: 0 });
    def('sti', { o: [], op: [0xFB], osize: 0 });
    def('cld', { o: [], op: [0xFC], osize: 0 });
    def('std', { o: [], op: [0xFD], osize: 0 });
    def('sahf', { o: [], op: [0x9E], osize: 0 });
    def('lahf', { o: [], op: [0x9F], osize: 0 });
    def('cbw', { o: [], op: [0x98], osize: 16 });
    def('cwde', { o: [], op: [0x98], osize: 32 });
    def('cwd', { o: [], op: [0x99], osize: 16 });
    def('cdq', { o: [], op: [0x99], osize: 32 });
    def('xlat', { o: [], op: [0xD7], osize: 0 });
    def('xlatb', { o: [], op: [0xD7], osize: 0 });
    def('pushf', { o: [], op: [0x9C], osize: 16 });
    def('pushfw', { o: [], op: [0x9C], osize: 16 });
    def('pushfd', { o: [], op: [0x9C], osize: 32 });
    def('popf', { o: [], op: [0x9D], osize: 16 });
    def('popfw', { o: [], op: [0x9D], osize: 16 });
    def('popfd', { o: [], op: [0x9D], osize: 32 });
    def('pusha', { o: [], op: [0x60], osize: 16 });
    def('pushad', { o: [], op: [0x60], osize: 32 });
    def('popa', { o: [], op: [0x61], osize: 16 });
    def('popad', { o: [], op: [0x61], osize: 32 });
    def('daa', { o: [], op: [0x27], osize: 0 });
    def('das', { o: [], op: [0x2F], osize: 0 });
    def('aaa', { o: [], op: [0x37], osize: 0 });
    def('aas', { o: [], op: [0x3F], osize: 0 });
    def('aam', { o: [], op: [0xD4, 0x0A], osize: 0 });
    def('aam', { o: ['Ib'], op: [0xD4], osize: 0 });
    def('aad', { o: [], op: [0xD5, 0x0A], osize: 0 });
    def('aad', { o: ['Ib'], op: [0xD5], osize: 0 });

    def('sldt', { o: ['Ew'], op: [0x0F, 0x00], grp: 0, osize: 16, noprefix: true });
    def('str', { o: ['Ew'], op: [0x0F, 0x00], grp: 1, osize: 16, noprefix: true });
    def('lldt', { o: ['Ew'], op: [0x0F, 0x00], grp: 2, osize: 16, noprefix: true });
    def('ltr', { o: ['Ew'], op: [0x0F, 0x00], grp: 3, osize: 16, noprefix: true });
    def('verr', { o: ['Ew'], op: [0x0F, 0x00], grp: 4, osize: 16, noprefix: true });
    def('verw', { o: ['Ew'], op: [0x0F, 0x00], grp: 5, osize: 16, noprefix: true });
    def('sgdt', { o: ['M'], op: [0x0F, 0x01], grp: 0, osize: 0 });
    def('sidt', { o: ['M'], op: [0x0F, 0x01], grp: 1, osize: 0 });
    def('lgdt', { o: ['M'], op: [0x0F, 0x01], grp: 2, osize: 0 });
    def('lidt', { o: ['M'], op: [0x0F, 0x01], grp: 3, osize: 0 });
    def('smsw', { o: ['Ew'], op: [0x0F, 0x01], grp: 4, osize: 16, noprefix: true });
    def('lmsw', { o: ['Ew'], op: [0x0F, 0x01], grp: 6, osize: 16, noprefix: true });
    def('invlpg', { o: ['M'], op: [0x0F, 0x01], grp: 7, osize: 0 });
    def('lar', { o: ['Gv', 'Ev'], op: [0x0F, 0x02] });
    def('lsl', { o: ['Gv', 'Ev'], op: [0x0F, 0x03] });
    def('clts', { o: [], op: [0x0F, 0x06], osize: 0 });
    def('invd', { o: [], op: [0x0F, 0x08], osize: 0 });
    def('wbinvd', { o: [], op: [0x0F, 0x09], osize: 0 });
    def('ud2', { o: [], op: [0x0F, 0x0B], osize: 0 });
    def('rsm', { o: [], op: [0x0F, 0xAA], osize: 0 });
    def('cpuid', { o: [], op: [0x0F, 0xA2], osize: 0 });

    var BT = [['bt', 4, 0xA3], ['bts', 5, 0xAB], ['btr', 6, 0xB3], ['btc', 7, 0xBB]];
    for (i = 0; i < BT.length; i++) {
      def(BT[i][0], { o: ['Ev', 'Gv'], op: [0x0F, BT[i][2]] });
      def(BT[i][0], { o: ['Ev', 'Ib'], op: [0x0F, 0xBA], grp: BT[i][1] });
    }
    def('bsf', { o: ['Gv', 'Ev'], op: [0x0F, 0xBC] });
    def('bsr', { o: ['Gv', 'Ev'], op: [0x0F, 0xBD] });
    def('bswap', { o: ['R32'], op: [0x0F, 0xC8], plus: 0, osize: 32, noprefix: true });
    def('xadd', { o: ['Eb', 'Gb'], op: [0x0F, 0xC0], osize: 8 });
    def('xadd', { o: ['Ev', 'Gv'], op: [0x0F, 0xC1] });
    def('cmpxchg', { o: ['Eb', 'Gb'], op: [0x0F, 0xB0], osize: 8 });
    def('cmpxchg', { o: ['Ev', 'Gv'], op: [0x0F, 0xB1] });

    var FPU_MEM = [
      ['fld', 0xD9, 0, 'Mem32'], ['fld', 0xDD, 0, 'Mem64'], ['fld', 0xDB, 5, 'Mem80'],
      ['fst', 0xD9, 2, 'Mem32'], ['fst', 0xDD, 2, 'Mem64'],
      ['fstp', 0xD9, 3, 'Mem32'], ['fstp', 0xDD, 3, 'Mem64'], ['fstp', 0xDB, 7, 'Mem80'],
      ['fild', 0xDF, 0, 'Mem16'], ['fild', 0xDB, 0, 'Mem32'], ['fild', 0xDF, 5, 'Mem64'],
      ['fist', 0xDF, 2, 'Mem16'], ['fist', 0xDB, 2, 'Mem32'],
      ['fistp', 0xDF, 3, 'Mem16'], ['fistp', 0xDB, 3, 'Mem32'], ['fistp', 0xDF, 7, 'Mem64'],
      ['fadd', 0xD8, 0, 'Mem32'], ['fadd', 0xDC, 0, 'Mem64'],
      ['fmul', 0xD8, 1, 'Mem32'], ['fmul', 0xDC, 1, 'Mem64'],
      ['fcom', 0xD8, 2, 'Mem32'], ['fcom', 0xDC, 2, 'Mem64'],
      ['fcomp', 0xD8, 3, 'Mem32'], ['fcomp', 0xDC, 3, 'Mem64'],
      ['fsub', 0xD8, 4, 'Mem32'], ['fsub', 0xDC, 4, 'Mem64'],
      ['fsubr', 0xD8, 5, 'Mem32'], ['fsubr', 0xDC, 5, 'Mem64'],
      ['fdiv', 0xD8, 6, 'Mem32'], ['fdiv', 0xDC, 6, 'Mem64'],
      ['fdivr', 0xD8, 7, 'Mem32'], ['fdivr', 0xDC, 7, 'Mem64'],
      ['fiadd', 0xDE, 0, 'Mem16'], ['fiadd', 0xDA, 0, 'Mem32'],
      ['fimul', 0xDE, 1, 'Mem16'], ['fimul', 0xDA, 1, 'Mem32'],
      ['ficom', 0xDE, 2, 'Mem16'], ['ficom', 0xDA, 2, 'Mem32'],
      ['ficomp', 0xDE, 3, 'Mem16'], ['ficomp', 0xDA, 3, 'Mem32'],
      ['fisub', 0xDE, 4, 'Mem16'], ['fisub', 0xDA, 4, 'Mem32'],
      ['fisubr', 0xDE, 5, 'Mem16'], ['fisubr', 0xDA, 5, 'Mem32'],
      ['fidiv', 0xDE, 6, 'Mem16'], ['fidiv', 0xDA, 6, 'Mem32'],
      ['fidivr', 0xDE, 7, 'Mem16'], ['fidivr', 0xDA, 7, 'Mem32'],
      ['fldcw', 0xD9, 5, 'Mem16'], ['fnstcw', 0xD9, 7, 'Mem16'],
      ['fnstsw', 0xDD, 7, 'Mem16'],
      ['fnsave', 0xDD, 6, 'M'], ['frstor', 0xDD, 4, 'M'],
      ['fnstenv', 0xD9, 6, 'M'], ['fldenv', 0xD9, 4, 'M'],
      ['fbld', 0xDF, 4, 'Mem80'], ['fbstp', 0xDF, 6, 'Mem80']
    ];
    for (i = 0; i < FPU_MEM.length; i++) {
      def(FPU_MEM[i][0], { o: [FPU_MEM[i][3]], op: [FPU_MEM[i][1]], grp: FPU_MEM[i][2], osize: 0 });
    }
    def('fstcw', { o: ['Mem16'], op: [0x9B, 0xD9], grp: 7, osize: 0 });
    def('fstsw', { o: ['Mem16'], op: [0x9B, 0xDD], grp: 7, osize: 0 });

    var FPU_ST = [
      ['fld', 0xD9, 0], ['fxch', 0xD9, 1], ['fst', 0xDD, 2], ['fstp', 0xDD, 3],
      ['ffree', 0xDD, 0], ['fucom', 0xDD, 4], ['fucomp', 0xDD, 5]
    ];
    for (i = 0; i < FPU_ST.length; i++) {
      def(FPU_ST[i][0], { o: ['sti'], op: [FPU_ST[i][1]], grp: FPU_ST[i][2], osize: 0 });
    }

    def('fadd', { o: ['st0', 'sti'], op: [0xD8], grp: 0, osize: 0 });
    def('fadd', { o: ['sti', 'st0'], op: [0xDC], grp: 0, osize: 0 });
    def('faddp', { o: ['sti', 'st0'], op: [0xDE], grp: 0, osize: 0 });
    def('faddp', { o: [], op: [0xDE, 0xC1], osize: 0 });
    def('fmul', { o: ['st0', 'sti'], op: [0xD8], grp: 1, osize: 0 });
    def('fmul', { o: ['sti', 'st0'], op: [0xDC], grp: 1, osize: 0 });
    def('fmulp', { o: ['sti', 'st0'], op: [0xDE], grp: 1, osize: 0 });
    def('fmulp', { o: [], op: [0xDE, 0xC9], osize: 0 });
    def('fsub', { o: ['st0', 'sti'], op: [0xD8], grp: 4, osize: 0 });
    def('fsub', { o: ['sti', 'st0'], op: [0xDC], grp: 5, osize: 0 });
    def('fsubp', { o: ['sti', 'st0'], op: [0xDE], grp: 5, osize: 0 });
    def('fsubp', { o: [], op: [0xDE, 0xE9], osize: 0 });
    def('fsubr', { o: ['st0', 'sti'], op: [0xD8], grp: 5, osize: 0 });
    def('fsubr', { o: ['sti', 'st0'], op: [0xDC], grp: 4, osize: 0 });
    def('fsubrp', { o: ['sti', 'st0'], op: [0xDE], grp: 4, osize: 0 });
    def('fsubrp', { o: [], op: [0xDE, 0xE1], osize: 0 });
    def('fdiv', { o: ['st0', 'sti'], op: [0xD8], grp: 6, osize: 0 });
    def('fdiv', { o: ['sti', 'st0'], op: [0xDC], grp: 7, osize: 0 });
    def('fdivp', { o: ['sti', 'st0'], op: [0xDE], grp: 7, osize: 0 });
    def('fdivp', { o: [], op: [0xDE, 0xF9], osize: 0 });
    def('fdivr', { o: ['st0', 'sti'], op: [0xD8], grp: 7, osize: 0 });
    def('fdivr', { o: ['sti', 'st0'], op: [0xDC], grp: 6, osize: 0 });
    def('fdivrp', { o: ['sti', 'st0'], op: [0xDE], grp: 6, osize: 0 });
    def('fdivrp', { o: [], op: [0xDE, 0xF1], osize: 0 });
    def('fcom', { o: ['sti'], op: [0xD8], grp: 2, osize: 0 });
    def('fcom', { o: [], op: [0xD8, 0xD1], osize: 0 });
    def('fcomp', { o: ['sti'], op: [0xD8], grp: 3, osize: 0 });
    def('fcomp', { o: [], op: [0xD8, 0xD9], osize: 0 });
    def('fcompp', { o: [], op: [0xDE, 0xD9], osize: 0 });

    var FPU_NIL = [
      ['fnop', 0xD9, 0xD0], ['fchs', 0xD9, 0xE0], ['fabs', 0xD9, 0xE1], ['ftst', 0xD9, 0xE4],
      ['fxam', 0xD9, 0xE5], ['fld1', 0xD9, 0xE8], ['fldl2t', 0xD9, 0xE9], ['fldl2e', 0xD9, 0xEA],
      ['fldpi', 0xD9, 0xEB], ['fldlg2', 0xD9, 0xEC], ['fldln2', 0xD9, 0xED], ['fldz', 0xD9, 0xEE],
      ['f2xm1', 0xD9, 0xF0], ['fyl2x', 0xD9, 0xF1], ['fptan', 0xD9, 0xF2], ['fpatan', 0xD9, 0xF3],
      ['fxtract', 0xD9, 0xF4], ['fprem1', 0xD9, 0xF5], ['fdecstp', 0xD9, 0xF6],
      ['fincstp', 0xD9, 0xF7], ['fprem', 0xD9, 0xF8], ['fyl2xp1', 0xD9, 0xF9],
      ['fsqrt', 0xD9, 0xFA], ['fsincos', 0xD9, 0xFB], ['frndint', 0xD9, 0xFC],
      ['fscale', 0xD9, 0xFD], ['fsin', 0xD9, 0xFE], ['fcos', 0xD9, 0xFF],
      ['fnclex', 0xDB, 0xE2], ['fninit', 0xDB, 0xE3]
    ];
    for (i = 0; i < FPU_NIL.length; i++) {
      def(FPU_NIL[i][0], { o: [], op: [FPU_NIL[i][1], FPU_NIL[i][2]], osize: 0 });
    }
    def('fclex', { o: [], op: [0x9B, 0xDB, 0xE2], osize: 0 });
    def('finit', { o: [], op: [0x9B, 0xDB, 0xE3], osize: 0 });
    def('fnstsw', { o: ['AX'], op: [0xDF, 0xE0], osize: 0, noprefix: true });
    def('fstsw', { o: ['AX'], op: [0x9B, 0xDF, 0xE0], osize: 0, noprefix: true });
  })();


  /* ---------------------------------------------------------------- assembly driver */

  function pushError(errors, line, message) {
    errors.push({ line: line >>> 0, col: 0, message: message });
  }

  function hexBytes(bytes) {
    var out = [], i, s;
    for (i = 0; i < bytes.length; i++) {
      s = bytes[i].toString(16).toUpperCase();
      out.push(s.length < 2 ? '0' + s : s);
    }
    return out.join(' ');
  }

  function parseProgram(source, opts, errors) {
    var lines = String(source === null || source === undefined ? '' : source).split(/\r\n|\r|\n/);
    var stmts = [];
    var defines = new Map();
    var state = { bits: opts.bits === 16 ? 16 : 32, global: '', defines: defines, pending: null };
    var i, j, t, res;
    for (i = 0; i < lines.length; i++) {
      t = stripComment(lines[i]).trim();
      if (!t) continue;
      try {
        res = parseStatements(t, i + 1, state);
        for (j = 0; j < res.stmts.length; j++) {
          res.stmts[j].bits = state.bits;
          res.stmts[j].global = res.global;
        }
        state.bits = res.bits;
        state.global = res.global;
        Array.prototype.push.apply(stmts, res.stmts);
      } catch (e) {
        errors.push({ line: (e instanceof AsmError) ? e.line : i + 1, col: 0, message: errText(e) });
      }
    }
    return { stmts: stmts, defines: defines };
  }

  function makeContext(program, opts) {
    var defines = new Map(), redefine = Object.create(null), k, v;
    if (opts.defines) {
      for (k in opts.defines) {
        if (!Object.prototype.hasOwnProperty.call(opts.defines, k)) continue;
        v = opts.defines[k];
        if (typeof v === 'number') defines.set(String(k).toLowerCase(), v >>> 0);
        else redefine[String(k).toLowerCase()] = parseExpr(String(v), 0);
      }
    }
    program.defines.forEach(function (entry, name) {
      redefine[name] = entry.ast;
    });
    return {
      symbols: new Map(),
      lower: new Map(),
      defines: defines,
      redefine: redefine,
      globalLabel: '',
      curAddr: 0,
      origin: typeof opts.origin === 'number' ? (opts.origin >>> 0) : 0,
      baseOrigin: typeof opts.origin === 'number' ? (opts.origin >>> 0) : 0,
      line: 0,
      missing: null
    };
  }

  function defineSymbol(st, value, ctx, defined, final, errors) {
    var name = st.name, lower = name.toLowerCase();
    if (defined.indexOf(lower) >= 0) {
      if (final) pushError(errors, st.line, 'symbol redefined: ' + name);
      return;
    }
    defined.push(lower);
    ctx.symbols.set(name, value >>> 0);
    ctx.lower.set(lower, value >>> 0);
  }

  function sameSizes(a, b) {
    var i;
    if (!a || !b || a.length !== b.length) return false;
    for (i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function runPass(program, ctx, final, errors) {
    var addr = ctx.baseOrigin, i, st, enc, sizes = [], unknown = 0, defined = [], out = [], listing = [];
    ctx.origin = ctx.baseOrigin;
    ctx.curAddr = addr;
    for (i = 0; i < program.stmts.length; i++) {
      st = program.stmts[i];
      st.addr = addr;
      ctx.curAddr = addr;
      ctx.line = st.line;
      ctx.globalLabel = st.global || '';
      ctx.missing = [];
      enc = null;
      try {
        if (st.kind === 'label') {
          defineSymbol(st, addr, ctx, defined, final, errors);
        } else if (st.kind === 'equ') {
          var ev = evalExpr(st.expr, ctx);
          if (!ev.known) {
            unknown++;
            if (final) pushError(errors, st.line, 'symbol not defined: ' + (ctx.missing[0] || st.name));
          } else {
            defineSymbol(st, ev.value, ctx, defined, final, errors);
          }
        } else if (st.kind === 'org') {
          var ov = evalExpr(st.expr, ctx);
          if (!ov.known) {
            unknown++;
            if (final) pushError(errors, st.line, 'org needs a constant address');
          } else {
            ctx.origin = ov.value >>> 0;
            addr = ctx.origin;
            st.addr = addr;
            ctx.curAddr = addr;
          }
        } else if (st.kind === 'bits') {
          enc = null;
        } else if (st.kind === 'insn') {
          enc = encodeInstruction(st, ctx);
        } else if (st.kind === 'data') {
          enc = encodeData(st, ctx);
        } else if (st.kind === 'res') {
          enc = encodeRes(st, ctx);
        }
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        unknown++;
        if (final) pushError(errors, st.line, e.message);
        enc = { bytes: [], unknown: false, failed: true };
      }
      if (enc) {
        if (enc.unknown && !enc.failed) {
          unknown++;
          if (final) pushError(errors, st.line, 'symbol not defined: ' + (ctx.missing[0] || '(expression)'));
        }
        sizes.push(enc.bytes.length);
        addr += enc.bytes.length;
        if (final) {
          out.push(enc.bytes);
          listing.push({ line: st.line, addr: st.addr, bytes: hexBytes(enc.bytes), text: st.text });
        }
      }
    }
    return { sizes: sizes, unknown: unknown, output: out, listing: listing, end: addr };
  }

  function assemble(source, opts) {
    opts = opts || {};
    var errors = [];
    var result = {
      ok: false,
      bytes: new Uint8Array(0),
      origin: typeof opts.origin === 'number' ? (opts.origin >>> 0) : 0,
      symbols: new Map(),
      errors: errors,
      listing: []
    };
    var program, ctx, info = null, prev = null, pass, converged = false, all, off, i, total;
    try {
      program = parseProgram(source, opts, errors);
      ctx = makeContext(program, opts);
      if (errors.length) {
        result.symbols = ctx.symbols;
        return result;
      }
      result.symbols = ctx.symbols;
      for (pass = 0; pass < 12; pass++) {
        info = runPass(program, ctx, false, null);
        if (prev && info.unknown === 0 && sameSizes(prev, info.sizes)) { converged = true; break; }
        prev = info.sizes;
      }
      info = runPass(program, ctx, true, errors);
      if (!converged && info.unknown === 0 && errors.length === 0) {
        pushError(errors, 0, 'instruction layout did not converge (jump sizes keep changing)');
      }
      total = 0;
      for (i = 0; i < info.output.length; i++) total += info.output[i].length;
      all = new Uint8Array(total);
      off = 0;
      for (i = 0; i < info.output.length; i++) {
        all.set(info.output[i], off);
        off += info.output[i].length;
      }
      result.bytes = all;
      result.listing = info.listing;
      result.origin = ctx.origin >>> 0;
    } catch (e) {
      pushError(errors, (e instanceof AsmError) ? e.line : 0, errText(e));
    }
    result.ok = errors.length === 0;
    return result;
  }

  return { Assembler: { assemble: assemble } };
});