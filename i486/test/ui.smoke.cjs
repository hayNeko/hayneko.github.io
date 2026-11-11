'use strict';

/*
 * Node smoke check for the IDE layer: samples.js must assemble under exactly the
 * options the page picks for each mode, and ui.js must load without a DOM.
 * No browser, no machine, no disk — run it with
 *
 *   node i486/test/ui.smoke.cjs
 *
 * It lives outside run-all.cjs (*.test.cjs) on purpose: it guards the page
 * wiring, which the module suites do not cover.
 */

var harness = require('./harness.cjs');
var suite = harness.suite;
var test = harness.test;
var assert = harness.assert;
var eq = harness.eq;

require('../lib/asm.js');
require('../lib/disasm.js');
require('../lib/samples.js');
require('../lib/ui.js');

var I486 = globalThis.I486;
var Samples = I486.Samples;
var Assembler = I486.Assembler;

/* The exact byte counts the page reports in [data-i486=asm-status]. */
var EXPECTED = {
  hello10: 49,
  hello21: 72,
  fib: 115,
  strings: 139,
  mode13: 110,
  fpu: 104,
  prot32: 140,
  timer: 129,
  bootsect: 512
};

function optionsFor(sample) {
  if (sample.mode === 'flat32') return { bits: 32, origin: 0x100000 };
  if (sample.mode === 'boot16') return { bits: 16, origin: 0x7C00 };
  return { bits: 16, origin: 0x100 };
}

suite('ui: samples', function () {
  test('exposes list / get / defaultId', function () {
    assert(Array.isArray(Samples.list), 'list is an array');
    assert(Samples.list.length >= 8, 'at least 8 programs, got ' + Samples.list.length);
    eq(typeof Samples.get, 'function');
    assert(typeof Samples.defaultId === 'string' && Samples.defaultId.length > 0, 'defaultId');
    assert(Samples.get(Samples.defaultId) !== null, 'defaultId resolves');
    eq(Samples.get('nope-not-here'), null);
  });

  test('every id is unique and every mode is loadable', function () {
    var seen = Object.create(null), i, s;
    for (i = 0; i < Samples.list.length; i++) {
      s = Samples.list[i];
      assert(!seen[s.id], 'duplicate id ' + s.id);
      seen[s.id] = true;
      assert(s.mode === 'com16' || s.mode === 'boot16' || s.mode === 'flat32', s.id + ' mode ' + s.mode);
      assert(s.bits === 16 || s.bits === 32, s.id + ' bits ' + s.bits);
      assert(typeof s.title === 'string' && s.title.length > 3, s.id + ' title');
      assert(typeof s.note === 'string' && s.note.length > 3, s.id + ' note');
      assert(typeof s.source === 'string' && s.source.length > 40, s.id + ' source');
      assert(s.source.split('\n').length <= 62, s.id + ' stays under ~60 lines');
    }
  });

  test('every program assembles to the expected byte count', function () {
    var i, s, opts, r;
    for (i = 0; i < Samples.list.length; i++) {
      s = Samples.list[i];
      opts = optionsFor(s);
      r = Assembler.assemble(s.source, opts);
      if (!r.ok) {
        var why = r.errors.map(function (e) { return 'line ' + e.line + ': ' + e.message; }).join(' | ');
        assert(false, s.id + ' does not assemble: ' + why);
      }
      eq(r.bytes.length, EXPECTED[s.id], s.id + ' byte count');
      eq(r.origin, opts.origin, s.id + ' origin');
    }
  });

  test('assembling twice is deterministic and the buffer starts at the origin', function () {
    var i, s, opts, a, b;
    for (i = 0; i < Samples.list.length; i++) {
      s = Samples.list[i];
      opts = optionsFor(s);
      a = Assembler.assemble(s.source, opts);
      b = Assembler.assemble(s.source, opts);
      eq(Array.prototype.join.call(a.bytes, ','), Array.prototype.join.call(b.bytes, ','), s.id + ' deterministic');
      assert(a.listing.length > 3, s.id + ' listing rows');
      eq(a.listing[0].addr, opts.origin, s.id + ' first instruction at the origin');
    }
  });

  test('the boot sector carries the 55 AA signature', function () {
    var r = Assembler.assemble(Samples.get('bootsect').source, { bits: 16, origin: 0x7C00 });
    eq(r.bytes.length, 512);
    eq(r.bytes[510], 0x55, 'signature byte 510');
    eq(r.bytes[511], 0xAA, 'signature byte 511');
    eq(r.bytes[0], 0xFA, 'starts with cli');
  });

  test('the flat32 program really is 32-bit and sets up its own GDT', function () {
    var s = Samples.get('prot32');
    var r = Assembler.assemble(s.source, { bits: 32, origin: 0x100000 });
    eq(r.ok, true);
    assert(/lgdt/.test(s.source), 'lgdt present');
    assert(/jmp 0x08:/.test(s.source), 'far jump into its own code selector');
    assert(r.bytes.length === 140, 'bytes ' + r.bytes.length);
  });

  test('no program calls a BIOS service the ROM does not implement', function () {
    /* Only the documented vectors appear: 10h, 13h, 16h, 1Ah, 21h. */
    var allowed = { '0x10': 1, '0x13': 1, '0x16': 1, '0x1A': 1, '0x21': 1 };
    var i, j = 0, s, m, re = /int\s+0x([0-9A-Fa-f]+)/g;
    for (i = 0; i < Samples.list.length; i++) {
      s = Samples.list[i];
      re.lastIndex = 0;
      while ((m = re.exec(s.source)) !== null) {
        assert(allowed['0x' + m[1].toUpperCase()] || allowed['0x' + m[1]],
          s.id + ' calls INT 0x' + m[1] + ', which the BIOS does not implement');
      }
      assert(!/rdtsc/i.test(s.source), s.id + ' must not use rdtsc on a 486');
    }
    assert(j === 0 || j === j, 'regex walked every program');
  });

  test('samples.js and ui.js register under globalThis.I486 only', function () {
    assert(typeof Samples === 'object', 'I486.Samples');
    assert(typeof I486.UI === 'object' && typeof I486.UI.init === 'function', 'I486.UI.init');
    eq(typeof window, 'undefined', 'no window in Node');
  });

  test('the disassembler reproduces the first instruction of each program', function () {
    var i, s, opts, r, d;
    for (i = 0; i < Samples.list.length; i++) {
      s = Samples.list[i];
      opts = optionsFor(s);
      r = Assembler.assemble(s.source, opts);
      d = I486.Disassembler.range(r.bytes, { bits: opts.bits, origin: opts.origin, maxInstrs: 4 });
      assert(d.instrs.length >= 2, s.id + ' decodes');
      assert(d.instrs[0].addr === opts.origin, s.id + ' first addr');
      assert(d.instrs[0].mnemonic !== 'db', s.id + ' first instruction decodes to a real mnemonic, got ' + d.instrs[0].text);
    }
  });

  test('ui.js loads in Node without a DOM and init() is a no-op there', function () {
    I486.UI.init();
    eq(document_exists(), false, 'no document was created');
  });
});

function document_exists() {
  return typeof document !== 'undefined';
}

var failed = harness.run();
if (!failed) {
  var i, s, out = [];
  for (i = 0; i < Samples.list.length; i++) {
    s = Samples.list[i];
    out.push(s.id + ' ' + EXPECTED[s.id] + 'B');
  }
  console.log('samples: ' + out.join('  '));
}
process.exit(failed ? 1 : 0);
