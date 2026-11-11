/* i486/lib/highlight.js — NASM-style tokenizer for the i486 mini IDE.
   I486.Highlight.html(source) -> escaped HTML, one <span class="code-line"> per line.
   Regex-scanning only: no eval, no DOM, O(n), safe on 2000-line sources. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) {
    if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var LINE_CLASS = 'code-line';

  var MNEMONIC_WORDS = (
    'aaa aad aam aas adc add and arpl bound bsf bsr bswap bt btc btr bts ' +
    'call cbw cdq clc cld cli clts cmc cmp cmps cmpsb cmpsd cmpsw cmpxchg cmpxchg8b cpuid cwd cwde ' +
    'daa das dec div enter hlt idiv imul in inc int int1 int3 into invd invlpg iret iretd ' +
    'jcxz jecxz jmp lahf lar lea leave les lfs lgs lidt lldt lmsw lods lodsb lodsd lodsw ' +
    'loop loope loopne loopnz loopz lsl lss ltr mov movs movsb movsd movsw movsx movzx mul ' +
    'neg nop not or out outs outsb outsd outsw pop popa popad popf popfd push pusha pushad pushf pushfd ' +
    'rcl rcr rep repe repne repnz repz ret retf retn rol ror sahf sal sar sbb scas scasb scasd scasw ' +
    'sgdt shl shld shr shrd sidt sldt smsw stc std sti stos stosb stosd stosw str sub test ud2 ' +
    'verr verw wait wbinvd xadd xchg xlat xlatb xor rdtsc ' +
    'ja jae jb jbe jc je jg jge jl jle jna jnae jnb jnbe jnc jne jng jnge jnl jnle ' +
    'jno jnp jns jnz jo jp jpe jpo js jz ' +
    'seta setae setb setbe setc sete setg setge setl setle setna setnae setnb setnbe ' +
    'setnc setne setng setnge setnl setnle setno setnp setns setnz seto setp setpe setpo sets setz ' +
    'f2xm1 fabs fadd faddp fbld fbstp fchs fclex fcom fcomp fcompp fcos fdecstp fdiv fdivp ' +
    'fdivr fdivrp ffree fiadd ficom ficomp fidiv fidivr fild fimul fincstp finit fist fistp ' +
    'fisub fisubr fld fld1 fldcw fldenv fldl2e fldl2t fldlg2 fldln2 fldpi fldz fmul fmulp ' +
    'fnclex fninit fnop fnsave fnstcw fnstenv fnstsw fpatan fprem fprem1 fptan frndint frstor ' +
    'fsave fscale fsin fsincos fsqrt fst fstcw fstenv fstp fstsw fsub fsubp fsubr fsubrp ' +
    'ftst fucom fucomp fucompp fwait fxam fxch fxtract fyl2x fyl2xp1'
  ).split(' ');

  var DIRECTIVE_WORDS = 'bits org equ section db dw dd dq times resb resw resd %define'.split(' ');
  var PREFIX_WORDS = 'rep repne repe repz repnz lock'.split(' ');
  var REGISTER_WORDS = (
    'eax ecx edx ebx esp ebp esi edi eip eflags ip flags ' +
    'ax cx dx bx sp bp si di ' +
    'al ah cl ch dl dh bl bh ' +
    'cs ds es fs gs ss ' +
    'cr0 cr2 cr3 cr4 dr0 dr1 dr2 dr3 dr6 dr7 tr3 tr4 tr5 tr6 tr7'
  ).split(' ');

  function wordSet(words) {
    var set = new Set();
    for (var i = 0; i < words.length; i++) set.add(words[i].toUpperCase());
    return set;
  }

  var MNEMONICS = wordSet(MNEMONIC_WORDS);
  var DIRECTIVES = wordSet(DIRECTIVE_WORDS);
  var PREFIXES = wordSet(PREFIX_WORDS);
  var REGISTERS = wordSet(REGISTER_WORDS);

  var TOKEN_RE = /(;[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(\$\$?|0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9][0-9a-fA-F]*[hH]\b|[0-9]+)|([A-Za-z_.$?@][A-Za-z0-9_.$?@]*[ \t]*:)|(%[A-Za-z_][A-Za-z0-9_]*)|(\.[A-Za-z_][A-Za-z0-9_.$?@]*)|([A-Za-z_$?@][A-Za-z0-9_$?@]*)|([\[\](){},:+*/%<>-])/g;

  var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  function esc(text) {
    return text.replace(/[&<>"]/g, function (ch) {
      return ENTITIES[ch];
    });
  }

  function span(cls, text) {
    return '<span class="' + cls + '">' + text + '</span>';
  }

  function token(match) {
    var comment = match[1];
    if (comment !== undefined) return span('t-com', esc(comment));

    var str = match[2];
    if (str !== undefined) return span('t-str', esc(str));

    var num = match[3];
    if (num !== undefined) return span('t-num', esc(num));

    var labelDef = match[4];
    if (labelDef !== undefined) {
      var colon = labelDef.indexOf(':');
      var name = labelDef.slice(0, colon).replace(/[ \t]+$/, '');
      var gap = labelDef.slice(name.length, colon);
      var cls = REGISTERS.has(name.toUpperCase()) ? 't-reg' : 't-lab';
      return span(cls, esc(name)) + esc(gap) + span('t-punct', ':');
    }

    var directive = match[5];
    if (directive !== undefined) {
      return DIRECTIVES.has(directive.toUpperCase()) ? span('t-dir', esc(directive)) : esc(directive);
    }

    var local = match[6];
    if (local !== undefined) return span('t-lab', esc(local));

    var word = match[7];
    if (word !== undefined) {
      var upper = word.toUpperCase();
      if (DIRECTIVES.has(upper)) return span('t-dir', esc(word));
      if (PREFIXES.has(upper)) return span('t-pfx', esc(word));
      if (REGISTERS.has(upper)) return span('t-reg', esc(word));
      if (MNEMONICS.has(upper)) return span('t-mnem', esc(word));
      return esc(word);
    }

    return span('t-punct', esc(match[8]));
  }

  function highlightLine(line) {
    var out = '';
    var last = 0;
    var match;
    TOKEN_RE.lastIndex = 0;
    while ((match = TOKEN_RE.exec(line)) !== null) {
      if (match[0].length === 0) {
        TOKEN_RE.lastIndex++;
        continue;
      }
      if (match.index > last) out += esc(line.slice(last, match.index));
      out += token(match);
      last = match.index + match[0].length;
    }
    if (last < line.length) out += esc(line.slice(last));
    return out;
  }

  function html(source) {
    var text = source == null ? '' : String(source);
    if (text.indexOf('\r') !== -1) text = text.replace(/\r\n?/g, '\n');
    var lines = text.split('\n');
    var out = '';
    for (var i = 0; i < lines.length; i++) {
      out += '<span class="' + LINE_CLASS + '">' + highlightLine(lines[i]) + '</span>';
    }
    return out;
  }

  return { Highlight: { html: html, LINE_CLASS: LINE_CLASS } };
});
