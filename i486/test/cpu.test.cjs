'use strict';

/*
 * i486/test/cpu.test.cjs -- I486.CPU test suite.
 *
 * Raw machine code only: the assembler module is written in parallel and this
 * suite must not depend on it.  Every byte sequence below is hand derived from
 * the Intel encodings (ModR/M + SIB, prefix and immediate sizes).
 */

var path = require('path');
var harness = require(path.join(__dirname, 'harness.cjs'));
var CPU = require(path.join(__dirname, '..', 'lib', 'cpu.js')).CPU;

var suite = harness.suite;
var test = harness.test;
var eq = harness.eq;
var assert = harness.assert;

var MEM = 1 << 20;
var MM = 0xFFFFF;

/* ------------------------------------------------------------------ bus -- */

function Machine() {
  var self = this;
  var ram = this.ram = new Uint8Array(MEM);
  this.ports = {};
  this.ioLog = [];
  var io = {
    in8: function (p) { self.ioLog.push('in8:' + p); return self.ports[p] === undefined ? 0xFF : self.ports[p] & 0xFF; },
    out8: function (p, v) { self.ioLog.push('out8:' + p + ':' + (v & 0xFF)); self.ports[p] = v & 0xFF; },
    in16: function (p) { self.ioLog.push('in16:' + p); return self.ports[p] === undefined ? 0xFFFF : self.ports[p] & 0xFFFF; },
    out16: function (p, v) { self.ioLog.push('out16:' + p + ':' + (v & 0xFFFF)); self.ports[p] = v & 0xFFFF; },
    in32: function (p) { self.ioLog.push('in32:' + p); return self.ports[p] === undefined ? 0xFFFFFFFF : self.ports[p] >>> 0; },
    out32: function (p, v) { self.ioLog.push('out32:' + p + ':' + (v >>> 0)); self.ports[p] = v >>> 0; }
  };
  this.bus = {
    ram: ram,
    read8: function (pa) { return ram[pa & MM]; },
    read16: function (pa) { return ram[pa & MM] | (ram[(pa + 1) & MM] << 8); },
    read32: function (pa) {
      return (ram[pa & MM] | (ram[(pa + 1) & MM] << 8) | (ram[(pa + 2) & MM] << 16) | (ram[(pa + 3) & MM] << 24)) >>> 0;
    },
    write8: function (pa, v) { ram[pa & MM] = v & 0xFF; },
    write16: function (pa, v) { ram[pa & MM] = v & 0xFF; ram[(pa + 1) & MM] = (v >> 8) & 0xFF; },
    write32: function (pa, v) {
      ram[pa & MM] = v & 0xFF; ram[(pa + 1) & MM] = (v >>> 8) & 0xFF;
      ram[(pa + 2) & MM] = (v >>> 16) & 0xFF; ram[(pa + 3) & MM] = (v >>> 24) & 0xFF;
    },
    io: io
  };
  this.cpu = new CPU(this.bus);
}

Machine.prototype.load = function (code, at) {
  for (var i = 0; i < code.length; i++) this.ram[(at + i) & MM] = code[i] & 0xFF;
  return this;
};
Machine.prototype.w8 = function (a, v) { this.ram[a & MM] = v & 0xFF; };
Machine.prototype.w16 = function (a, v) { this.ram[a & MM] = v & 0xFF; this.ram[(a + 1) & MM] = (v >> 8) & 0xFF; };
Machine.prototype.w32 = function (a, v) {
  this.ram[a & MM] = v & 0xFF; this.ram[(a + 1) & MM] = (v >>> 8) & 0xFF;
  this.ram[(a + 2) & MM] = (v >>> 16) & 0xFF; this.ram[(a + 3) & MM] = (v >>> 24) & 0xFF;
};
Machine.prototype.r8 = function (a) { return this.ram[a & MM]; };
Machine.prototype.r16 = function (a) { return this.ram[a & MM] | (this.ram[(a + 1) & MM] << 8); };
Machine.prototype.r32 = function (a) {
  return (this.ram[a & MM] | (this.ram[(a + 1) & MM] << 8) | (this.ram[(a + 2) & MM] << 16) | (this.ram[(a + 3) & MM] << 24)) >>> 0;
};
Machine.prototype.wstr = function (a, s) {
  for (var i = 0; i < s.length; i++) this.ram[(a + i) & MM] = s.charCodeAt(i);
  return this;
};
Machine.prototype.readStr = function (a, n) {
  var s = '';
  for (var i = 0; i < n; i++) s += String.fromCharCode(this.ram[(a + i) & MM]);
  return s;
};

/* Real-mode 16-bit setup: flat segments at base 0, code at 0x100. */
Machine.prototype.reset16 = function () {
  var c = this.cpu;
  c.reset();
  c.setSeg('cs', 0); c.setSeg('ds', 0); c.setSeg('es', 0); c.setSeg('ss', 0);
  c.setReg('eip', 0x100);
  c.setReg('esp', 0xFF00);
  return this;
};

/* Reset, load the byte sequence at 0x100 and execute exactly one instruction. */
Machine.prototype.exec = function (code) {
  this.reset16();
  this.load(code, 0x100);
  this.cpu.step();
  return this.cpu.eip - 0x100;
};

Machine.prototype.execAt = function (code, at) {
  this.reset16();
  this.load(code, at);
  this.cpu.setReg('eip', at);
  this.cpu.step();
  return this.cpu.eip - at;
};

Machine.prototype.steps = function (code, n) {
  this.reset16();
  this.load(code, 0x100);
  this.cpu.run(n);
  return this;
};

/* Flags in a fixed order for table driven checks. */
var FLAGORDER = ['cf', 'pf', 'af', 'zf', 'sf', 'of'];
function fstr(cpu) {
  var s = '', i, v;
  for (i = 0; i < 6; i++) {
    v = cpu.getFlag(FLAGORDER[i]);
    s += v ? '1' : '0';
  }
  return s;
}

/* 32-bit flat protected mode with a GDT at 0x800 and code at 0x1000. */
Machine.prototype.protFlat = function (gdtSelCode, gdtSelData) {
  var c = this.cpu;
  this.w32(0x800, 0x00000000); this.w32(0x804, 0x00000000);
  this.w32(0x808, 0x0000FFFF); this.w32(0x80C, 0x00CF9A00);
  this.w32(0x810, 0x0000FFFF); this.w32(0x814, 0x00CF9200);
  this.w32(0x818, 0x0000FFFF); this.w32(0x81C, 0x00CFF200);
  c.reset();
  c.gdtr.base = 0x800; c.gdtr.limit = 0x1F;
  c.setCR(0, 0x00000013);
  c.setSeg('cs', gdtSelCode || 0x08);
  c.setSeg('ds', gdtSelData || 0x10);
  c.setSeg('es', gdtSelData || 0x10);
  c.setSeg('ss', gdtSelData || 0x10);
  c.setSeg('fs', gdtSelData || 0x10);
  c.setSeg('gs', gdtSelData || 0x10);
  c.setReg('eip', 0x1000);
  c.setReg('esp', 0x8000);
  return this;
};

/* ------------------------------------------------------------------ CPU -- */

suite('cpu reset and registers', function () {
  test('RESET state matches the i486DX', function () {
    var m = new Machine();
    var c = m.cpu;
    c.reset();
    eq(c.eip, 0xFFF0, 'eip');
    eq(c.cr0 >>> 0, 0x60000010, 'cr0');
    eq(c.cr2, 0, 'cr2');
    eq(c.cr3, 0, 'cr3');
    eq(c.cs.sel, 0xF000, 'cs selector');
    eq(c.cs.base >>> 0, 0xFFFF0000, 'cs base');
    eq(c.cs.limit, 0xFFFF, 'cs limit');
    eq(c.cs.big, false, 'cs big');
    eq(c.eax >>> 0, 0, 'eax');
    eq(c.edx >>> 0, 0x404, 'edx family/model');
    eq(c.eflags >>> 0, 2, 'eflags');
    eq(c.idtr.base, 0, 'idtr base');
    eq(c.idtr.limit, 0x3FF, 'idtr limit');
    eq(c.getDR(7), 0x400, 'dr7');
    eq(c.halted, false, 'halted');
    eq(c.tripleFault, false, 'triple fault');
  });

  test('register accessors round trip', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('eax', 0x12345678);
    eq(c.getReg('ax'), 0x5678, 'ax low half');
    eq(c.getReg('ah'), 0x56, 'ah');
    eq(c.getReg('al'), 0x78, 'al');
    eq(c.eax >>> 0, 0x12345678, 'eax accessor');
    c.setReg('al', 0xAA);
    eq(c.eax >>> 0, 0x123456AA, 'al write');
    c.setReg('ah', 0xBB);
    eq(c.eax >>> 0, 0x1234BBAA, 'ah write');
    c.setReg('esp', 0xCAFEBABE);
    eq(c.getReg('sp'), 0xBABE, 'sp');
    eq(c.esp >>> 0, 0xCAFEBABE, 'esp accessor');
    c.setReg('eflags', 0x246);
    eq(c.getFlag('zf'), 1, 'zf set');
    eq(c.getFlag('pf'), 1, 'pf set');
    eq(c.getFlag('cf'), 0, 'cf clear');
  });

  test('segment registers and flags', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setSeg('ds', 0x1234);
    eq(c.ds.sel, 0x1234, 'ds sel');
    eq(c.ds.base >>> 0, 0x12340, 'ds base');
    eq(c.getSeg('ds').limit, 0xFFFF, 'ds limit');
    c.setFlag('if', 1);
    eq(c.getFlag('if'), 1, 'if');
    c.setFlag('iopl', 3);
    eq(c.getFlag('iopl'), 3, 'iopl');
    c.setFlag('df', 1);
    eq(c.getFlag('df'), 1, 'df');
    c.setFlag('df', 0);
    eq(c.getFlag('df'), 0, 'df cleared');
  });
});

/* --------------------------------------------------------------- ALU ops -- */

suite('cpu arithmetic flags', function () {
  test('ADD/OR/ADC/SBB/AND/SUB/XOR/CMP 8-bit flag table', function () {
    /* [opcode, a, b, carryIn, result, cf, pf, af, zf, sf, of] */
    var table = [
      [0x00, 0x00, 0x00, 0, 0x00, 0, 1, 0, 1, 0, 0],
      [0x00, 0x01, 0x01, 0, 0x02, 0, 0, 0, 0, 0, 0],
      [0x00, 0x7F, 0x01, 0, 0x80, 0, 0, 1, 0, 1, 1],
      [0x00, 0xFF, 0x01, 0, 0x00, 1, 1, 1, 1, 0, 0],
      [0x00, 0x80, 0x80, 0, 0x00, 1, 1, 0, 1, 0, 1],
      [0x00, 0x50, 0x50, 0, 0xA0, 0, 1, 0, 0, 1, 1],
      [0x08, 0x00, 0x00, 0, 0x00, 0, 1, 0, 1, 0, 0],
      [0x08, 0x80, 0x00, 0, 0x80, 0, 0, 0, 0, 1, 0],
      [0x10, 0xFF, 0x00, 1, 0x00, 1, 1, 1, 1, 0, 0],
      [0x10, 0x7F, 0x00, 1, 0x80, 0, 0, 1, 0, 1, 1],
      [0x18, 0x00, 0x00, 0, 0x00, 0, 1, 0, 1, 0, 0],
      [0x18, 0x00, 0x00, 1, 0xFF, 1, 1, 1, 0, 1, 0],
      [0x18, 0x01, 0x00, 1, 0x00, 0, 1, 0, 1, 0, 0],
      [0x20, 0xF0, 0x0F, 0, 0x00, 0, 1, 0, 1, 0, 0],
      [0x20, 0xFF, 0xFF, 0, 0xFF, 0, 1, 0, 0, 1, 0],
      [0x28, 0x00, 0x01, 0, 0xFF, 1, 1, 1, 0, 1, 0],
      [0x28, 0x80, 0x01, 0, 0x7F, 0, 0, 1, 0, 0, 1],
      [0x28, 0x7F, 0xFF, 0, 0x80, 1, 0, 0, 0, 1, 1],
      [0x28, 0x00, 0x00, 0, 0x00, 0, 1, 0, 1, 0, 0],
      [0x28, 0x10, 0x01, 0, 0x0F, 0, 1, 1, 0, 0, 0],
      [0x30, 0xFF, 0x0F, 0, 0xF0, 0, 1, 0, 0, 1, 0],
      [0x38, 0x10, 0x10, 0, 0x10, 0, 1, 0, 1, 0, 0]
    ];
    var m = new Machine();
    var c = m.cpu;
    var i, t, al;
    for (i = 0; i < table.length; i++) {
      t = table[i];
      m.reset16();
      c.setReg('al', t[1]);
      c.setReg('bl', t[2]);
      c.setFlag('cf', t[3]);
      c.setFlag('pf', 0); c.setFlag('af', 0); c.setFlag('zf', 0); c.setFlag('sf', 0); c.setFlag('of', 0);
      m.load([t[0], 0xD8], 0x100);      /* op al, bl */
      c.setReg('eip', 0x100);
      c.step();
      al = c.getReg('al');
      eq(al, t[4], 'result opcode 0x' + t[0].toString(16) + ' a=' + t[1] + ' b=' + t[2]);
      eq(fstr(c), t.slice(5).join(''), 'flags opcode 0x' + t[0].toString(16) + ' a=' + t[1] + ' b=' + t[2]);
    }
  });

  test('32-bit add/sub wrap and carry', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('eax', 0xFFFFFFFF);
    m.load([0x66, 0x05, 0x01, 0x00, 0x00, 0x00], 0x100);   /* add eax, 1 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0, 'eax wrapped');
    eq(fstr(c), '111100', 'cf pf af zf set, sf of clear');

    m.reset16();
    c.setReg('eax', 0x80000000);
    m.load([0x66, 0x2D, 0x01, 0x00, 0x00, 0x00], 0x100);   /* sub eax, 1 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0x7FFFFFFF, 'eax');
    eq(c.getFlag('of'), 1, 'signed overflow');
    eq(c.getFlag('cf'), 0, 'no borrow');
  });

  test('16-bit add sets AF and OF', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('ax', 0x7FFF);
    m.load([0x05, 0x01, 0x00], 0x100);    /* add ax, 1 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x8000, 'ax');
    eq(c.getFlag('of'), 1, 'of');
    eq(c.getFlag('sf'), 1, 'sf');
    eq(c.getFlag('cf'), 0, 'cf');
  });

  test('INC and DEC preserve CF', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('al', 0xFF);
    c.setFlag('cf', 1);
    m.load([0xFE, 0xC0], 0x100);   /* inc al */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0x00, 'inc wraps');
    eq(c.getFlag('cf'), 1, 'cf untouched by INC');
    eq(c.getFlag('zf'), 1, 'zf');

    m.reset16();
    c.setReg('al', 0x00);
    c.setFlag('cf', 1);
    m.load([0xFE, 0xC8], 0x100);   /* dec al */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0xFF, 'dec wraps');
    eq(c.getFlag('cf'), 1, 'cf untouched by DEC');
    eq(c.getFlag('sf'), 1, 'sf');
    eq(c.getFlag('af'), 1, 'af');

    m.reset16();
    c.setReg('ax', 0x0000);
    c.setFlag('cf', 0);
    m.load([0x48], 0x100);         /* dec ax (register form) */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0xFFFF, 'dec ax');
    eq(c.getFlag('cf'), 0, 'cf still clear');
  });

  test('NEG flags', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('al', 0x00);
    m.load([0xF6, 0xD8], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0x00, 'neg 0');
    eq(c.getFlag('cf'), 0, 'neg 0 clears cf');

    m.reset16();
    c.setReg('al', 0x01);
    m.load([0xF6, 0xD8], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0xFF, 'neg 1');
    eq(c.getFlag('cf'), 1, 'neg sets cf');
    eq(fstr(c), '111010', 'neg 1 flags');

    m.reset16();
    c.setReg('al', 0x80);
    m.load([0xF6, 0xD8], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0x80, 'neg 0x80');
    eq(c.getFlag('of'), 1, 'neg 0x80 overflow');
  });

  test('NOT does not touch flags', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('al', 0x0F);
    c.setFlag('cf', 1); c.setFlag('zf', 1);
    m.load([0xF6, 0xD0], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0xF0, 'not');
    eq(c.getFlag('cf'), 1, 'cf kept');
    eq(c.getFlag('zf'), 1, 'zf kept');
  });

  test('TEST and CMP only set flags', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('ax', 0x1234);
    m.load([0xA9, 0x34, 0x12], 0x100);     /* test ax, 0x1234 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x1234, 'test keeps operand');
    eq(c.getFlag('zf'), 0, 'zf clear');
    eq(c.getFlag('cf'), 0, 'cf clear');
    eq(c.getFlag('of'), 0, 'of clear');

    m.reset16();
    c.setReg('ax', 0x1234);
    m.load([0x3D, 0x34, 0x12], 0x100);     /* cmp ax, 0x1234 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x1234, 'cmp keeps operand');
    eq(c.getFlag('zf'), 1, 'equal');
  });

  test('DAA/DAS/AAA/AAS bcd helpers', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('al', 0x3C);         /* 36 + 6 -> 42 bcd */
    c.setFlag('af', 0);
    c.setFlag('cf', 0);
    m.load([0x27], 0x100);        /* daa */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0x42, 'daa 0x3C -> 0x42');
    eq(c.getFlag('af'), 1, 'daa sets af');

    m.reset16();
    c.setReg('al', 0x42);
    c.setFlag('af', 1);
    c.setFlag('cf', 0);
    m.load([0x2F], 0x100);        /* das */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0x3C, 'das 0x42 -> 0x3C');

    m.reset16();
    c.setReg('ax', 0x000F);
    c.setFlag('af', 0);
    m.load([0x37], 0x100);        /* aaa */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0x05, 'aaa al');
    eq(c.getReg('ah'), 0x01, 'aaa ah');
    eq(c.getFlag('cf'), 1, 'aaa cf');
  });

  test('AAM and AAD', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('ax', 0x0063);       /* 99 */
    m.load([0xD4, 0x0A], 0x100);  /* aam */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ah'), 9, 'aam high');
    eq(c.getReg('al'), 9, 'aam low');

    m.reset16();
    c.setReg('ax', 0x0909);
    m.load([0xD5, 0x0A], 0x100);  /* aad */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x0063, 'aad result');
  });

  test('CBW CWDE CWD CDQ', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('al', 0x80);
    m.load([0x98], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0xFF80, 'cbw');

    m.reset16();
    c.setReg('ax', 0x8000);
    m.load([0x66, 0x98], 0x100);   /* cwde */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0xFFFF8000, 'cwde');

    m.reset16();
    c.setReg('ax', 0x8000);
    m.load([0x99], 0x100);         /* cwd */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('dx'), 0xFFFF, 'cwd');

    m.reset16();
    c.setReg('eax', 0x80000000);
    m.load([0x66, 0x99], 0x100);   /* cdq */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.edx >>> 0, 0xFFFFFFFF, 'cdq');
  });
});


/* --------------------------------------------------------------- shifts -- */

suite('cpu shifts and rotates', function () {
  var m = new Machine();
  var c = m.cpu;

  function shift(code, al, cf, cl) {
    m.reset16();
    c.setReg('al', al);
    c.setReg('cl', cl === undefined ? 0 : cl);
    c.setFlag('cf', cf || 0);
    m.load(code, 0x100);
    c.setReg('eip', 0x100);
    c.step();
    return c.getReg('al');
  }

  test('SHL', function () {
    eq(shift([0xD0, 0xE0], 0x81, 0), 0x02, 'shl al,1 value');
    eq(c.getFlag('cf'), 1, 'shl cf');
    eq(c.getFlag('of'), 1, 'shl of for count 1');
    eq(c.getFlag('pf'), 0, 'shl pf');
    eq(shift([0xD0, 0xE0], 0x40, 0), 0x80, 'shl al,1 to sign bit');
    eq(c.getFlag('of'), 1, 'shl of 0x40');
    eq(c.getFlag('sf'), 1, 'shl sf');
    eq(shift([0xC0, 0xE0, 0x04], 0x8F, 0), 0xF0, 'shl al,4');
    eq(c.getFlag('cf'), 0, 'shl al,4 cf from bit 4');
  });

  test('SHR and SAR', function () {
    eq(shift([0xD0, 0xE8], 0x81, 0), 0x40, 'shr al,1');
    eq(c.getFlag('cf'), 1, 'shr cf');
    eq(c.getFlag('of'), 1, 'shr of is the original msb');
    eq(shift([0xD0, 0xE8], 0x01, 0), 0x00, 'shr al,1 to zero');
    eq(c.getFlag('cf'), 1, 'shr cf low bit');
    eq(c.getFlag('of'), 0, 'shr of clear for small original');
    eq(c.getFlag('zf'), 1, 'shr zf');
    eq(shift([0xD0, 0xF8], 0x81, 0), 0xC0, 'sar al,1 keeps sign');
    eq(c.getFlag('cf'), 1, 'sar cf');
    eq(c.getFlag('of'), 0, 'sar of always 0');
    eq(c.getFlag('sf'), 1, 'sar sf');
    eq(shift([0xD0, 0xF8], 0x41, 0), 0x20, 'sar al,1 positive');
  });

  test('ROL and ROR', function () {
    eq(shift([0xD0, 0xC0], 0x80, 0), 0x01, 'rol al,1');
    eq(c.getFlag('cf'), 1, 'rol cf');
    eq(c.getFlag('of'), 1, 'rol of');
    eq(shift([0xD0, 0xC0], 0x40, 0), 0x80, 'rol al,1 from 0x40');
    eq(c.getFlag('of'), 1, 'rol of 0x40');
    eq(shift([0xD0, 0xC8], 0x01, 0), 0x80, 'ror al,1');
    eq(c.getFlag('cf'), 1, 'ror cf');
    eq(c.getFlag('of'), 1, 'ror of differ');
    eq(shift([0xD0, 0xC8], 0x02, 0), 0x01, 'ror al,1 from 0x02');
    eq(c.getFlag('of'), 0, 'ror of equal');
  });

  test('RCL and RCR through carry', function () {
    eq(shift([0xD0, 0xD0], 0x80, 0), 0x00, 'rcl al,1 with cf 0');
    eq(c.getFlag('cf'), 1, 'rcl cf out');
    eq(shift([0xD0, 0xD0], 0x00, 1), 0x01, 'rcl al,1 with cf 1');
    eq(c.getFlag('cf'), 0, 'rcl cf in');
    eq(shift([0xD0, 0xD8], 0x01, 1), 0x80, 'rcr al,1 with cf 1');
    eq(c.getFlag('cf'), 1, 'rcr cf out');
    eq(shift([0xD0, 0xD8], 0x02, 0), 0x01, 'rcr al,1 with cf 0');
    eq(c.getFlag('cf'), 0, 'rcr cf in');
  });

  test('shift count is masked to 5 bits and 0 leaves flags alone', function () {
    m.reset16();
    c.setReg('eax', 0x12345678);
    c.setReg('cl', 32);
    c.setFlag('cf', 1); c.setFlag('zf', 0); c.setFlag('of', 1);
    m.load([0x66, 0xD3, 0xE0], 0x100);      /* shl eax, cl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0x12345678, 'count 0 does not shift');
    eq(c.getFlag('cf'), 1, 'count 0 leaves cf');
    eq(c.getFlag('of'), 1, 'count 0 leaves of');
    eq(c.getFlag('zf'), 0, 'count 0 leaves zf');

    eq(shift([0xD2, 0xE0], 0xFF, 0, 8), 0x00, 'shl al,8 shifts everything out');
    eq(c.getFlag('cf'), 1, 'shl al,8 cf is bit 0');
    eq(shift([0xD2, 0xE0], 0x01, 0, 9), 0x00, 'shl al,9 masks to 9 not 1');
  });

  test('SHLD and SHRD', function () {
    m.reset16();
    c.setReg('ax', 0x1234);
    c.setReg('bx', 0x5678);
    m.load([0x0F, 0xA4, 0xD8, 0x04], 0x100);   /* shld ax, bx, 4 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x2345, 'shld result');
    eq(c.getFlag('cf'), 1, 'shld cf');

    m.reset16();
    c.setReg('ax', 0x1234);
    c.setReg('bx', 0x5678);
    m.load([0x0F, 0xAC, 0xD8, 0x04], 0x100);   /* shrd ax, bx, 4 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x8123, 'shrd result');
    eq(c.getFlag('cf'), 0, 'shrd cf');

    m.reset16();
    c.setReg('ax', 0x8000);
    c.setReg('bx', 0x0001);
    c.setReg('cl', 1);
    m.load([0x0F, 0xAD, 0xD8], 0x100);         /* shrd ax, bx, cl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0xC000, 'shrd by cl');
    eq(c.getFlag('cf'), 0, 'shrd cf 0');
  });

  test('shift group 2 with memory operand', function () {
    m.reset16();
    m.w8(0x400, 0x10);
    m.load([0xD1, 0x26, 0x00, 0x04], 0x100);   /* shl word [0x400], 1 */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r16(0x400), 0x0020, 'shl memory');
    eq(c.getFlag('cf'), 0, 'cf');
  });
});

/* ----------------------------------------------------------- mul and div -- */

suite('cpu mul and div', function () {
  var m = new Machine();
  var c = m.cpu;

  test('MUL 8/16/32', function () {
    m.reset16();
    c.setReg('al', 5); c.setReg('bl', 3);
    m.load([0xF6, 0xE3], 0x100);      /* mul bl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 15, 'mul 8 result');
    eq(c.getFlag('cf'), 0, 'mul no overflow');
    eq(c.getFlag('of'), 0, 'mul of clear');

    m.reset16();
    c.setReg('al', 0x40); c.setReg('bl', 4);
    m.load([0xF6, 0xE3], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x0100, 'mul 8 wide');
    eq(c.getFlag('cf'), 1, 'mul overflow cf');
    eq(c.getFlag('of'), 1, 'mul overflow of');

    m.reset16();
    c.setReg('ax', 0x1000); c.setReg('bx', 0x0010);
    m.load([0xF7, 0xE3], 0x100);      /* mul bx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x0000, 'mul 16 low');
    eq(c.getReg('dx'), 0x0001, 'mul 16 high');

    m.reset16();
    c.setReg('eax', 0x10000);
    c.setReg('ebx', 0x10000);
    m.load([0x66, 0xF7, 0xE3], 0x100);   /* mul ebx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0, 'mul 32 low');
    eq(c.edx >>> 0, 1, 'mul 32 high');
  });

  test('IMUL one/two/three operand', function () {
    m.reset16();
    c.setReg('al', 0xFE); c.setReg('bl', 3);
    m.load([0xF6, 0xEB], 0x100);      /* imul bl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0xFFFA, 'imul -2*3');
    eq(c.getFlag('cf'), 0, 'imul fits');

    m.reset16();
    c.setReg('al', 0x7F); c.setReg('bl', 2);
    m.load([0xF6, 0xEB], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x00FE, 'imul 127*2');
    eq(c.getFlag('cf'), 1, 'imul overflow');

    m.reset16();
    c.setReg('cx', 0x0010);
    m.load([0x6B, 0xC1, 0xFD], 0x100);   /* imul ax, cx, -3 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0xFFD0, 'imul three operand');

    m.reset16();
    c.setReg('ax', 0x0100);
    c.setReg('bx', 0x0010);
    m.load([0x0F, 0xAF, 0xC3], 0x100);   /* imul ax, bx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x1000, 'imul two operand');

    m.reset16();
    c.setReg('eax', 0x00010000);
    c.setReg('ebx', 0x00010000);
    m.load([0x66, 0x0F, 0xAF, 0xC3], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0, 'imul 32 wrapped result (low only)');
  });

  test('DIV and IDIV with #DE', function () {
    m.reset16();
    m.w16(0 * 4, 0x0700); m.w16(2, 0);        /* #DE handler at 0:0x0700 */
    c.setReg('ax', 7); c.setReg('bl', 2);
    m.load([0xF6, 0xF3], 0x100);              /* div bl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 3, 'div quotient');
    eq(c.getReg('ah'), 1, 'div remainder');

    m.reset16();
    m.w16(0 * 4, 0x0700); m.w16(2, 0);
    c.setReg('ax', 0x0200); c.setReg('bl', 1);
    m.load([0xF6, 0xF3], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x0700, 'div overflow vectors to #DE');

    m.reset16();
    m.w16(0 * 4, 0x0700); m.w16(2, 0);
    c.setReg('ax', 0xFFF9); c.setReg('bl', 2);
    m.load([0xF6, 0xFB], 0x100);              /* idiv bl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0xFD, 'idiv quotient -3');
    eq(c.getReg('ah'), 0xFF, 'idiv remainder -1');

    m.reset16();
    m.w16(0 * 4, 0x0700); m.w16(2, 0);
    c.setReg('edx', 1); c.setReg('eax', 0);
    c.setReg('ebx', 2);
    m.load([0x66, 0xF7, 0xF3], 0x100);        /* div ebx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0x80000000, 'div 64/32 quotient');
    eq(c.edx >>> 0, 0, 'div 64/32 remainder');

    m.reset16();
    m.w16(0 * 4, 0x0700); m.w16(2, 0);
    c.setReg('edx', 0xFFFFFFFF); c.setReg('eax', 0xFFFFFFFF);
    c.setReg('ebx', 2);
    m.load([0x66, 0xF7, 0xFB], 0x100);        /* idiv ebx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0, 'idiv -1/2 quotient');
    eq(c.edx >>> 0, 0xFFFFFFFF, 'idiv -1/2 remainder');

    m.reset16();
    m.w16(0 * 4, 0x0700); m.w16(2, 0);
    c.setReg('ax', 1); c.setReg('bl', 0);
    m.load([0xF6, 0xF3], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x0700, 'divide by zero -> #DE');
    eq(c.lastException.vector, 0, 'lastException vector');
  });
});

/* --------------------------------------------------------------- lengths -- */

suite('cpu instruction lengths', function () {
  var m = new Machine();
  function len(code) { return m.exec(code); }

  test('immediate sizes', function () {
    eq(len([0xB8, 0x34, 0x12]), 3, 'mov ax, imm16');
    eq(len([0x66, 0xB8, 0x78, 0x56, 0x34, 0x12]), 6, 'mov eax, imm32');
    eq(len([0xB0, 0x42]), 2, 'mov al, imm8');
    eq(len([0x04, 0x01]), 2, 'add al, imm8');
    eq(len([0x05, 0x34, 0x12]), 3, 'add ax, imm16');
    eq(len([0x66, 0x05, 0x78, 0x56, 0x34, 0x12]), 6, 'add eax, imm32');
    eq(len([0x83, 0xC0, 0x05]), 3, 'add ax, imm8 sign extended');
    eq(len([0x81, 0xC0, 0x34, 0x12]), 4, 'add ax, imm16 group form');
    eq(len([0x66, 0x81, 0xC0, 0x78, 0x56, 0x34, 0x12]), 7, 'add eax, imm32 group form');
  });

  test('16-bit ModR/M addressing lengths', function () {
    eq(len([0x8B, 0x00]), 2, 'mov ax, [bx+si]');
    eq(len([0x8B, 0x46, 0x10]), 3, 'mov ax, [bp+0x10]');
    eq(len([0x8B, 0x86, 0x34, 0x12]), 4, 'mov ax, [bp+0x1234]');
    eq(len([0x8B, 0x06, 0x34, 0x12]), 4, 'mov ax, [0x1234]');
    eq(len([0xC7, 0x06, 0x00, 0x04, 0x01, 0x00]), 6, 'mov word [0x400], imm16');
    eq(len([0x66, 0xC7, 0x06, 0x00, 0x04, 0x01, 0x00, 0x00, 0x00]), 9, 'mov dword [0x400], imm32');
  });

  test('32-bit addressing and SIB lengths', function () {
    eq(len([0x67, 0x8B, 0x03]), 3, 'mov ax, [ebx] with 67');
    eq(len([0x67, 0x8B, 0x44, 0x8B, 0x10]), 5, 'mov ax, [ebx+ecx*4+0x10]');
    eq(len([0x67, 0x8B, 0x05, 0x00, 0x12, 0x00, 0x00]), 7, 'mov ax, [disp32]');
    eq(len([0x67, 0x66, 0x8B, 0x84, 0x88, 0x44, 0x03, 0x00, 0x00]), 9, 'mov eax, [eax+ecx*4+disp32]');
    eq(len([0x67, 0x8B, 0x45, 0x08]), 4, 'mov ax, [ebp+8]');
  });

  test('prefix lengths and redundant prefixes', function () {
    eq(len([0x26, 0x8B, 0x00]), 3, 'es: mov ax, [bx+si]');
    eq(len([0x66, 0x67, 0x26, 0x2E, 0x8B, 0x00]), 6, 'four prefixes');
    eq(len([0xF3, 0xA4]), 2, 'rep movsb');
    eq(len([0x0F, 0xA4, 0xD8, 0x04]), 4, 'shld ax, bx, 4');
    eq(len([0x0F, 0xBA, 0xE8, 0x04]), 4, 'bts ax, 4');
    eq(len([0x67, 0x8D, 0x87, 0x78, 0x56, 0x34, 0x12]), 7, 'lea ax, [edi+disp32]');
    eq(len([0x8D, 0x80, 0x00, 0x01]), 4, 'lea ax, [bx+si+0x100]');
    eq(len([0x0F, 0xB6, 0xC3]), 3, 'movzx ax, bl');
  });
});

/* ------------------------------------------------------------ addressing -- */

suite('cpu addressing modes', function () {
  test('16-bit effective addresses and default segments', function () {
    var m = new Machine();
    var c = m.cpu;
    function ea(code, phys, ssBase) {
      m.reset16();
      c.setSeg('ds', 0);
      if (ssBase) c.setSeg('ss', ssBase);
      c.setReg('bx', 0x200); c.setReg('si', 0x10); c.setReg('di', 0x20);
      c.setReg('bp', 0x300);
      m.w16(phys & 0xFFFF, 0xDEAD);
      m.w16(0x10000 + (phys & 0xFFFF), 0xBEEF);
      m.load(code, 0x100);
      c.setReg('eip', 0x100);
      c.step();
      return c.getReg('ax');
    }
    eq(ea([0x8B, 0x00], 0x210), 0xDEAD, '[bx+si] uses DS');
    eq(ea([0x8B, 0x01], 0x220), 0xDEAD, '[bx+di]');
    eq(ea([0x8B, 0x02], 0x310), 0xDEAD, '[bp+si] uses DS when SS base is 0');
    eq(ea([0x8B, 0x02], 0x310, 0x1000), 0xBEEF, '[bp+si] defaults to SS');
    eq(ea([0x8B, 0x04], 0x010), 0xDEAD, '[si]');
    eq(ea([0x8B, 0x05], 0x020), 0xDEAD, '[di]');
    eq(ea([0x8B, 0x06, 0x00, 0x04], 0x400), 0xDEAD, '[disp16]');
    eq(ea([0x8B, 0x07], 0x200), 0xDEAD, '[bx]');
    eq(ea([0x8B, 0x40, 0x08], 0x218), 0xDEAD, '[bx+si+disp8]');
    eq(ea([0x8B, 0x86, 0x00, 0x01], 0x400), 0xDEAD, '[bp+disp16]');
  });

  test('16-bit addressing wraps at 64K', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setReg('bx', 0xFFFF);
    c.setReg('si', 0x0002);
    m.w16(0x0001, 0x1234);
    m.load([0x8B, 0x00], 0x100);       /* mov ax, [bx+si] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x1234, 'bx+si wraps to 0x0001');
  });

  test('segment override wins over the default', function () {
    var m = new Machine();
    var c = m.cpu;
    m.reset16();
    c.setSeg('ds', 0x2000);
    c.setSeg('es', 0x3000);
    m.w16(0x0000, 0x1111);
    m.w16(0x20000, 0x2222);
    m.w16(0x30000, 0x3333);
    m.load([0x26, 0x8B, 0x06, 0x00, 0x00], 0x100);   /* mov ax, es:[0] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x3333, 'es override');
    m.load([0x8B, 0x06, 0x00, 0x00], 0x100);          /* mov ax, [0] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x2222, 'ds default');
  });

  test('32-bit SIB forms in flat protected mode', function () {
    var m = new Machine();
    var c = m.cpu;
    function ea32(code, phys) {
      m.protFlat();
      c.setReg('ebx', 0x1800); c.setReg('ecx', 4);
      c.setReg('esi', 0x100); c.setReg('esp', 0x8000);
      c.setReg('ebp', 0x2000);
      m.w32(phys, 0xCAFEBABE);
      m.load(code, 0x1000);
      c.setReg('eip', 0x1000);
      c.step();
      return c.eax >>> 0;
    }
    eq(ea32([0x8B, 0x03], 0x1800), 0xCAFEBABE, '[ebx]');
    eq(ea32([0x8B, 0x44, 0x8B, 0x10], 0x1820), 0xCAFEBABE, '[ebx+ecx*4+0x10]');
    eq(ea32([0x8B, 0x04, 0x74], 0x8200), 0xCAFEBABE, '[esp+esi*2]');
    eq(ea32([0x8B, 0x04, 0xB5, 0x00, 0x01, 0x00, 0x00], 0x0500), 0xCAFEBABE, '[esi*4+0x100]');
    eq(ea32([0x8B, 0x44, 0xF5, 0x10], 0x2810), 0xCAFEBABE, '[ebp+esi*8+0x10]');
    eq(ea32([0x8B, 0x05, 0x00, 0x30, 0x00, 0x00], 0x3000), 0xCAFEBABE, '[disp32]');
    eq(ea32([0x8B, 0x45, 0x08], 0x2008), 0xCAFEBABE, '[ebp+8]');
    eq(ea32([0x8B, 0x85, 0x00, 0x01, 0x00, 0x00], 0x2100), 0xCAFEBABE, '[ebp+0x100]');
  });
});

/* --------------------------------------------------------------- strings -- */

suite('cpu string operations', function () {
  var m = new Machine();
  var c = m.cpu;

  test('rep movsb forward and backward', function () {
    m.reset16();
    m.wstr(0x200, 'HELLO');
    c.setReg('si', 0x200); c.setReg('di', 0x300); c.setReg('cx', 5);
    c.setFlag('df', 0);
    m.load([0xF3, 0xA4], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(m.readStr(0x300, 5), 'HELLO', 'forward copy');
    eq(c.getReg('si'), 0x205, 'si advanced');
    eq(c.getReg('di'), 0x305, 'di advanced');
    eq(c.getReg('cx'), 0, 'cx exhausted');

    m.reset16();
    m.wstr(0x200, 'ABCDE');
    c.setReg('si', 0x204); c.setReg('di', 0x304); c.setReg('cx', 5);
    c.setFlag('df', 1);
    m.load([0xF3, 0xA4], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(m.readStr(0x300, 5), 'ABCDE', 'backward copy');
    eq(c.getReg('si'), 0x1FF, 'si decremented');
    eq(c.getReg('di'), 0x2FF, 'di decremented');
  });

  test('rep with cx=0 does nothing', function () {
    m.reset16();
    m.wstr(0x300, 'ZZZZ');
    c.setReg('si', 0x200); c.setReg('di', 0x300); c.setReg('cx', 0);
    m.load([0xF3, 0xA4], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(m.readStr(0x300, 4), 'ZZZZ', 'nothing copied');
    eq(c.eip, 0x102, 'instruction finished');
  });

  test('rep stosw and lodsb', function () {
    m.reset16();
    c.setReg('ax', 0x1234);
    c.setReg('di', 0x400); c.setReg('cx', 4);
    m.load([0xF3, 0xAB], 0x100);      /* rep stosw */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r16(0x400), 0x1234, 'stosw first');
    eq(m.r16(0x406), 0x1234, 'stosw last');
    eq(c.getReg('di'), 0x408, 'di advanced by 8');

    m.reset16();
    m.wstr(0x200, 'X');
    c.setReg('si', 0x200);
    m.load([0xAC], 0x100);            /* lodsb */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0x58, 'lodsb');
    eq(c.getReg('si'), 0x201, 'si advanced by 1');
  });

  test('repe cmpsb and repne scasb', function () {
    m.reset16();
    m.wstr(0x200, 'ABC');
    m.wstr(0x300, 'ABC');
    c.setReg('si', 0x200); c.setReg('di', 0x300); c.setReg('cx', 3);
    m.load([0xF3, 0xA6], 0x100);      /* repe cmpsb */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('zf'), 1, 'equal strings leave zf set');
    eq(c.getReg('cx'), 0, 'cx exhausted');

    m.reset16();
    m.wstr(0x200, 'ABX');
    m.wstr(0x300, 'AXC');
    c.setReg('si', 0x200); c.setReg('di', 0x300); c.setReg('cx', 3);
    m.load([0xF3, 0xA6], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('zf'), 0, 'mismatch clears zf');
    eq(c.getReg('cx'), 1, 'stopped after the mismatch');

    m.reset16();
    m.wstr(0x400, 'HELX');
    c.setReg('al', 0x58);             /* 'X' */
    c.setReg('di', 0x400); c.setReg('cx', 4);
    m.load([0xF2, 0xAE], 0x100);      /* repne scasb */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('di'), 0x404, 'scasb found at the fourth byte');
    eq(c.getReg('cx'), 0, 'cx exhausted');
    eq(c.getFlag('zf'), 1, 'match sets zf');
  });

  test('32-bit rep movsd', function () {
    m.protFlat();
    c.setReg('esi', 0x2000); c.setReg('edi', 0x3000); c.setReg('ecx', 2);
    m.w32(0x2000, 0x11223344); m.w32(0x2004, 0x55667788);
    m.load([0xF3, 0xA5], 0x1000);     /* rep movsd */
    c.setReg('eip', 0x1000);
    c.step();
    eq(m.r32(0x3000), 0x11223344, 'movsd first dword');
    eq(m.r32(0x3004), 0x55667788, 'movsd second dword');
    eq(c.getReg('esi'), 0x2008, 'esi advanced by 8');
    eq(c.getReg('ecx'), 0, 'ecx exhausted');
  });
});

/* --------------------------------------------------------- stack and int -- */

suite('cpu stack and interrupts', function () {
  var m = new Machine();
  var c = m.cpu;

  test('push/pop 16 and 32 bit', function () {
    m.reset16();
    c.setReg('ax', 0x1234);
    c.setReg('esp', 0xFF00);
    m.load([0x50], 0x100);            /* push ax */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('sp'), 0xFEFE, 'sp after push');
    eq(m.r16(0xFEFE), 0x1234, 'value on stack');

    m.reset16();
    c.setReg('esp', 0xFF00);
    m.load([0x68, 0x78, 0x56], 0x100);      /* push 0x5678 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('sp'), 0xFEFE, 'sp after 16-bit push imm16');
    eq(m.r16(0xFEFE), 0x5678, 'value pushed');

    m.reset16();
    c.setReg('eax', 0xDEADBEEF);
    c.setReg('esp', 0xFF00);
    m.load([0x66, 0x50], 0x100);      /* push eax */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('sp'), 0xFEFC, '32-bit push');
    eq(m.r32(0xFEFC), 0xDEADBEEF, 'dword on stack');

    m.reset16();
    c.setReg('esp', 0xFF00);
    c.setReg('bx', 0x4321);
    m.load([0x53, 0x58], 0x100);      /* push bx; pop ax */
    c.setReg('eip', 0x100);
    c.step();
    c.step();
    eq(c.getReg('ax'), 0x4321, 'pop returned the value');
    eq(c.getReg('sp'), 0xFF00, 'stack balanced');
  });

  test('PUSHA/POPA round trip', function () {
    m.reset16();
    c.setReg('ax', 0x1111); c.setReg('cx', 0x2222); c.setReg('dx', 0x3333);
    c.setReg('bx', 0x4444); c.setReg('sp', 0xFF00); c.setReg('bp', 0x6666);
    c.setReg('si', 0x7777); c.setReg('di', 0x8888);
    m.load([0x60], 0x100);            /* pusha */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('sp'), 0xFF00 - 16, 'pusha pushed 8 words');
    eq(m.r16(0xFF00 - 2), 0x1111, 'ax pushed first');
    eq(m.r16(0xFF00 - 10), 0xFF00, 'original sp pushed');
    eq(m.r16(0xFF00 - 16), 0x8888, 'di pushed last');
    c.setReg('ax', 0); c.setReg('bx', 0); c.setReg('si', 0); c.setReg('di', 0);
    m.load([0x61], 0x100);            /* popa */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x1111, 'popa ax');
    eq(c.getReg('bx'), 0x4444, 'popa bx');
    eq(c.getReg('si'), 0x7777, 'popa si');
    eq(c.getReg('di'), 0x8888, 'popa di');
    eq(c.getReg('sp'), 0xFF00, 'popa sp restored');
  });

  test('PUSHF/POPF and LAHF/SAHF', function () {
    m.reset16();
    c.setReg('esp', 0xFF00);
    c.setFlag('cf', 1); c.setFlag('zf', 1); c.setFlag('of', 0); c.setFlag('sf', 0);
    m.load([0x9C], 0x100);            /* pushf */
    c.setReg('eip', 0x100);
    c.step();
    var pushed = m.r16(0xFEFE);
    eq(pushed & 1, 1, 'pushf cf');
    eq((pushed >> 6) & 1, 1, 'pushf zf');
    eq((pushed >> 1) & 1, 1, 'pushf reserved bit 1 is always set');

    m.reset16();
    c.setReg('esp', 0xFF00);
    m.w16(0xFF00, 0x0055);            /* cf pf af set, zf sf of clear */
    c.setFlag('cf', 0); c.setFlag('zf', 1);
    m.load([0x9D], 0x100);            /* popf */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('cf'), 1, 'popf cf');
    eq(c.getFlag('zf'), 1, 'popf zf');
    eq(c.getFlag('af'), 1, 'popf af');

    m.reset16();
    c.setReg('ah', 0xD5);             /* sf zf af pf cf */
    m.load([0x9E], 0x100);            /* sahf */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('cf'), 1, 'sahf cf');
    eq(c.getFlag('pf'), 1, 'sahf pf');
    eq(c.getFlag('af'), 1, 'sahf af');
    eq(c.getFlag('zf'), 1, 'sahf zf');
    eq(c.getFlag('sf'), 1, 'sahf sf');
    m.load([0x9F], 0x100);            /* lahf */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ah') & 0xD5, 0xD5, 'lahf round trip');
  });

  test('ENTER and LEAVE', function () {
    m.reset16();
    c.setReg('esp', 0xFF00);
    c.setReg('bp', 0x1234);
    m.load([0xC8, 0x10, 0x00, 0x00], 0x100);   /* enter 0x10, 0 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('bp'), 0xFEFE, 'bp is the frame pointer');
    eq(c.getReg('sp'), 0xFEEE, 'space allocated');
    eq(m.r16(0xFEFE), 0x1234, 'old bp saved');
    m.load([0xC9], 0x100);            /* leave */
    c.setReg('eip', 0x100);
    c.setReg('sp', 0xFEEE);
    c.step();
    eq(c.getReg('bp'), 0x1234, 'leave restores bp');
    eq(c.getReg('sp'), 0xFF00, 'leave releases the frame');
  });

  test('CALL and RET', function () {
    m.reset16();
    m.load([0xE8, 0x03, 0x00, 0xF4, 0x90, 0x90, 0xC3], 0x100);   /* call 0x106; hlt; nop; nop; ret */
    c.run(1);
    eq(c.eip, 0x106, 'call target');
    eq(m.r16(c.getReg('sp')), 0x103, 'return address pushed');
    c.run(1);
    eq(c.eip, 0x103, 'ret returns');
    eq(c.getReg('sp'), 0xFF00, 'stack cleaned');
  });

  test('INT through the real-mode IVT and IRET', function () {
    m.reset16();
    m.w16(0x21 * 4, 0x0010);
    m.w16(0x21 * 4 + 2, 0x0500);
    m.w8(0x5010, 0xCF);               /* iret at 0x0500:0x0010 */
    c.setFlag('if', 1);
    c.setFlag('zf', 1);
    m.load([0xCD, 0x21, 0x90], 0x100);   /* int 0x21 */
    c.setReg('eip', 0x100);
    var spBefore = c.getReg('sp');
    c.step();
    eq(c.eip, 0x0010, 'handler ip');
    eq(c.getSeg('cs').sel, 0x0500, 'handler cs');
    eq(c.getFlag('if'), 0, 'interrupt clears IF');
    eq(m.r16(spBefore - 6), 0x0102, 'return ip pushed');
    eq(m.r16(spBefore - 4), 0x0000, 'return cs pushed');
    eq(m.r16(spBefore - 2) & 0x40, 0x40, 'flags pushed');
    c.step();                          /* iret */
    eq(c.eip, 0x0102, 'iret restores ip');
    eq(c.getSeg('cs').sel, 0x0000, 'iret restores cs');
    eq(c.getFlag('zf'), 1, 'iret restores flags');
  });

  test('INT3 and INTO', function () {
    m.reset16();
    m.w16(3 * 4, 0x0300); m.w16(3 * 4 + 2, 0);
    m.load([0xCC], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x0300, 'int3 vector');

    m.reset16();
    m.w16(4 * 4, 0x0400); m.w16(4 * 4 + 2, 0);
    c.setFlag('of', 1);
    m.load([0xCE], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x0400, 'into taken when of set');

    m.reset16();
    c.setFlag('of', 0);
    m.load([0xCE], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x101, 'into skipped when of clear');
  });

  test('HLT, serviceInterrupt and the interrupt shadow', function () {
    m.reset16();
    c.setFlag('if', 1);
    m.load([0xFB, 0xF4], 0x100);       /* sti; hlt */
    c.setReg('eip', 0x100);
    c.step();                           /* sti */
    eq(c.canInterrupt(), false, 'sti creates a one instruction shadow');
    eq(c.step(), 1, 'shadow step');
    eq(c.halted, true, 'hlt halted the cpu');
    eq(c.canInterrupt(), false, 'halted blocks canInterrupt');
    m.w16(0x20 * 4, 0x0300); m.w16(0x20 * 4 + 2, 0);
    eq(c.serviceInterrupt(0x20), true, 'hardware interrupt wakes hlt');
    eq(c.halted, false, 'hlt cleared');
    eq(c.eip, 0x0300, 'vector taken');
  });

  test('interrupt flag shadow expires after one instruction', function () {
    m.reset16();
    m.load([0xFB, 0x90, 0x90], 0x100);   /* sti; nop; nop */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('if'), 1, 'if set');
    eq(c.canInterrupt(), false, 'shadow active');
    c.step();
    eq(c.canInterrupt(), true, 'shadow expired');
  });

  test('segment register push/pop', function () {
    m.reset16();
    c.setSeg('es', 0x1234);
    c.setReg('esp', 0xFF00);
    m.load([0x06, 0x07], 0x100);      /* push es; pop es */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r16(0xFEFE), 0x1234, 'es selector pushed');
    c.setSeg('es', 0);
    c.step();
    eq(c.getSeg('es').sel, 0x1234, 'pop es restored');
    m.load([0x1E, 0x1F], 0x100);      /* push ds; pop ds */
    c.setReg('eip', 0x100);
    c.step();
    c.step();
    eq(c.getSeg('ds').sel, 0x0000, 'ds round trip');
  });
});


/* --------------------------------------------------------- protected mode -- */

/* GDT at 0x800, IDT at 0x900, TSS at 0x2000, ring-0 code at 0x1000. */
Machine.prototype.setupProt = function () {
  var gdt = [
    0x00000000, 0x00000000,   /* 0x00 null */
    0x0000FFFF, 0x00CF9A00,   /* 0x08 ring-0 code, base 0, limit 4G, D=1 */
    0x0000FFFF, 0x00CF9200,   /* 0x10 ring-0 data */
    0x0000FFFF, 0x00CFFA00,   /* 0x18 ring-3 code */
    0x0000FFFF, 0x00CFF200,   /* 0x20 ring-3 data */
    0x20000067, 0x00008900,   /* 0x28 32-bit TSS at 0x2000, limit 0x67 */
    0x0000FFFF, 0x00CF9A03,   /* 0x30 ring-0 code at base 0x30000 */
    0x0000000F, 0x00409200    /* 0x38 ring-0 data, limit 0x0F */
  ];
  var i;
  for (i = 0; i < gdt.length; i++) this.w32(0x800 + i * 4, gdt[i]);
  this.w32(0x2000, 0);            /* TSS link */
  this.w32(0x2004, 0x7000);       /* ESP0 */
  this.w32(0x2008, 0x0010);       /* SS0 */
  var c = this.cpu;
  c.reset();
  c.gdtr.base = 0x800; c.gdtr.limit = 0x3F;
  c.idtr.base = 0x900; c.idtr.limit = 0x7FF;
  return this;
};

Machine.prototype.setGate = function (vec, handler, sel, attr) {
  var at = 0x900 + vec * 8;
  this.w16(at, handler & 0xFFFF);
  this.w16(at + 2, sel);
  this.w8(at + 4, 0);
  this.w8(at + 5, attr);
  this.w16(at + 6, (handler >>> 16) & 0xFFFF);
  return this;
};

Machine.prototype.enterProt = function (csSel, eip) {
  var c = this.cpu;
  c.setCR(0, 0x00000013);
  c.setSeg('cs', csSel || 0x08);
  c.setSeg('ds', 0x10); c.setSeg('es', 0x10); c.setSeg('ss', 0x10);
  c.setSeg('fs', 0x10); c.setSeg('gs', 0x10);
  c.setReg('eip', eip === undefined ? 0x1000 : eip);
  c.setReg('esp', 0x8000);
  return this;
};

suite('cpu protected mode', function () {
  var m = new Machine();
  var c = m.cpu;

  test('LGDT and LIDT load the tables', function () {
    m.reset16();
    m.w16(0x400, 0x003F); m.w32(0x402, 0x00000800);
    m.load([0x0F, 0x01, 0x16, 0x00, 0x04], 0x100);   /* lgdt [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.gdtr.limit, 0x3F, 'lgdt limit');
    eq(c.gdtr.base, 0x800, 'lgdt base');

    m.w16(0x410, 0x07FF); m.w32(0x412, 0x00000900);
    m.load([0x0F, 0x01, 0x1E, 0x10, 0x04], 0x100);   /* lidt [0x410] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.idtr.limit, 0x7FF, 'lidt limit');
    eq(c.idtr.base, 0x900, 'lidt base');
  });

  test('SGDT and SMSW', function () {
    m.reset16();
    c.gdtr.base = 0x12345678; c.gdtr.limit = 0xABCD;
    m.load([0x0F, 0x01, 0x06, 0x00, 0x04], 0x100);   /* sgdt [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r16(0x400), 0xABCD, 'sgdt limit');
    eq(m.r16(0x402), 0x5678, 'sgdt base low');
    eq(m.r16(0x404), 0x1234, 'sgdt base high');
    m.load([0x0F, 0x01, 0xE0], 0x100);               /* smsw ax */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x0010, 'smsw returns cr0 low');
  });

  test('LTR and STR with the TSS descriptor', function () {
    m.setupProt();
    m.enterProt();
    c.setReg('ax', 0x28);
    m.load([0x0F, 0x00, 0xD8], 0x1000);              /* ltr ax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.tr.sel, 0x28, 'tr selector');
    eq(c.tr.base, 0x2000, 'tr base');
    m.load([0x0F, 0x00, 0xC0], 0x1000);              /* sldt ax is /0, str is /1 */
    m.load([0x0F, 0x00, 0xC8], 0x1000);              /* str ax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getReg('ax'), 0x28, 'str returns the tr selector');
  });

  test('segment limit violation raises #GP with error code 0', function () {
    m.setupProt();
    m.setGate(13, 0x0700, 0x08, 0x8F);               /* #GP trap gate */
    m.enterProt();
    c.setSeg('ds', 0x38);                            /* data segment, limit 0x0F */
    eq(c.ds.limit, 0x0F, 'loaded the small limit');
    m.load([0x66, 0x8B, 0x05, 0x00, 0x20, 0x00, 0x00], 0x1000);   /* mov ax, [0x2000] beyond the limit */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eip, 0x0700, '#GP handler entered');
    eq(c.lastException.vector, 13, 'lastException #GP');
    eq(c.lastException.errorCode, 0, 'error code 0');
    eq(m.r32(c.getReg('esp')), 0, 'error code pushed on the stack');
  });

  test('privilege check on int n with a ring-0 gate', function () {
    m.setupProt();
    m.setGate(13, 0x0700, 0x08, 0x8F);
    m.setGate(0x80, 0x0730, 0x08, 0xEE);             /* DPL 3 interrupt gate */
    m.setGate(0x81, 0x0740, 0x08, 0x8E);             /* DPL 0 interrupt gate */
    m.enterProt();
    c.setReg('ax', 0x28);
    m.load([0x0F, 0x00, 0xD8], 0x1000);              /* ltr ax */
    c.setReg('eip', 0x1000);
    c.step();
    /* build a ring-3 frame and iret to it */
    var esp = 0x8000;
    m.w32(esp - 4, 0x23);
    m.w32(esp - 8, 0x6000);
    m.w32(esp - 12, 0x0002);
    m.w32(esp - 16, 0x1B);
    m.w32(esp - 20, 0x0500);
    c.setReg('esp', esp - 20);
    m.load([0xCF], 0x1000);                           /* iret */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getSeg('cs').sel, 0x1B, 'iret to ring 3');
    eq(c.eip, 0x0500, 'ring-3 entry point');
    eq(c.getReg('esp'), 0x6000, 'ring-3 stack');
    m.load([0xCD, 0x81], 0x500);                      /* int 0x81: gate DPL 0 */
    c.setReg('eip', 0x500);
    c.step();
    eq(c.eip, 0x0700, '#GP raised for the DPL violation');
    eq(c.lastException.vector, 13, 'vector 13');
    eq(c.lastException.errorCode, 0x81 * 8 + 2, 'gate error code');
  });

  test('interrupt gate dispatch with a stack switch and iret back', function () {
    m.setupProt();
    m.setGate(0x80, 0x0730, 0x08, 0xEE);             /* DPL 3 interrupt gate */
    m.enterProt();
    c.setReg('ax', 0x28);
    m.load([0x0F, 0x00, 0xD8], 0x1000);              /* ltr ax */
    c.setReg('eip', 0x1000);
    c.step();
    var esp = 0x8000;
    m.w32(esp - 4, 0x23);
    m.w32(esp - 8, 0x6000);
    m.w32(esp - 12, 0x0002);
    m.w32(esp - 16, 0x1B);
    m.w32(esp - 20, 0x0500);
    c.setReg('esp', esp - 20);
    m.load([0xCF], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getSeg('cs').sel, 0x1B, 'entered ring 3');
    m.w8(0x0730, 0xCF);                              /* iret at the handler */
    m.load([0xCD, 0x80], 0x500);                     /* int 0x80 */
    c.setReg('eip', 0x500);
    c.step();
    eq(c.getSeg('cs').sel, 0x08, 'gate delivered at ring 0');
    eq(c.eip, 0x0730, 'handler address');
    eq(c.getReg('esp'), 0x7000 - 20, 'TSS ring-0 stack used');
    eq(m.r32(0x7000 - 4), 0x23, 'old ss pushed');
    eq(m.r32(0x7000 - 8), 0x6000, 'old esp pushed');
    eq(m.r32(0x7000 - 20), 0x0502, 'return eip pushed');
    c.step();                                         /* iret back to ring 3 */
    eq(c.getSeg('cs').sel, 0x1B, 'back at ring 3');
    eq(c.eip, 0x0502, 'ring-3 return point');
    eq(c.getReg('esp'), 0x6000, 'ring-3 stack restored');
  });

  test('far call and retf inside one privilege level', function () {
    m.setupProt();
    m.enterProt();
    c.setReg('esp', 0x8000);
    m.load([0x9A, 0x00, 0x06, 0x00, 0x00, 0x08, 0x00], 0x1000);   /* call far 0x0008:0x0600 */
    m.w8(0x0600, 0xCB);                               /* retf */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eip, 0x0600, 'far call target');
    eq(c.getSeg('cs').sel, 0x08, 'far call selector');
    eq(m.r32(c.getReg('esp')), 0x1007, 'return offset pushed');
    eq(m.r32(c.getReg('esp') + 4), 0x08, 'return selector pushed');
    c.step();                                         /* retf */
    eq(c.eip, 0x1007, 'retf returns');
    eq(c.getSeg('cs').sel, 0x08, 'retf restores cs');
    eq(c.getReg('esp'), 0x8000, 'stack balanced');
  });
});

/* ---------------------------------------------------------------- paging -- */

suite('cpu paging', function () {
  var m = new Machine();
  var c = m.cpu;

  /*
   * Page directory at 0x3000, page table at 0x4000.
   * Linear 0x0000-0xEFFF identity mapped except:
   *   0x8000 -> 0xA000      (remap)
   *   0x9000 read only      (write faults)
   *   0xA000 supervisor     (user access faults)
   *   0xB000 not present
   */
  function pagingSetup() {
    m.setupProt();
    m.setGate(14, 0x0710, 0x08, 0x8F);
    m.setGate(13, 0x0700, 0x08, 0x8F);
    var i;
    for (i = 0; i < 16; i++) m.w32(0x4000 + i * 4, (i * 0x1000) | 0x07);
    m.w32(0x4000 + 8 * 4, 0xA000 | 0x07);
    m.w32(0x4000 + 9 * 4, 0x9000 | 0x05);
    m.w32(0x4000 + 10 * 4, 0xA000 | 0x03);
    m.w32(0x4000 + 11 * 4, 0x0000);
    m.w32(0x3000, 0x4000 | 0x07);
    m.enterProt();
    c.cr3 = 0x3000;
    c.setCR(0, 0x80000013);
    return m;
  }

  test('4KB translation and the A/D bits', function () {
    pagingSetup();
    c.translate(0x8000, false, false);
    m.w32(0xA000, 0x12345678);
    m.load([0xA1, 0x00, 0x80, 0x00, 0x00, 0xF4], 0x1000);   /* mov eax,[0x8000]; hlt */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eax >>> 0, 0x12345678, 'linear 0x8000 maps to physical 0xA000');
    eq(m.r32(0xA000) & 0xFFFFFFFF, 0x12345678, 'physical content unchanged');

    pagingSetup();
    m.w32(0xC000, 0xABCDEF01);
    var pa = c.translate(0xC000, false, false);
    eq(pa, 0xC000, 'identity translation');
    eq(c.translate(0x8000, false, false), 0xA000, 'remapped translation');
    eq(m.r32(0x4000 + 12 * 4) & 0x20, 0x20, 'PTE accessed bit set');
    eq(m.r32(0x3000) & 0x20, 0x20, 'PDE accessed bit set');
    c.translate(0xC004, true, false);
    eq(m.r32(0x4000 + 12 * 4) & 0x40, 0x40, 'PTE dirty bit set on write');
  });

  test('#PF on a not-present page sets CR2 and pushes the error code', function () {
    pagingSetup();
    m.load([0x66, 0x8B, 0x05, 0x00, 0xB0, 0x00, 0x00], 0x1000);   /* mov ax, [0xB000] */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eip, 0x0710, '#PF handler entered');
    eq(c.cr2, 0xB000, 'CR2 holds the faulting linear address');
    eq(c.lastException.vector, 14, 'vector 14');
    eq(c.lastException.errorCode, 0, 'read of a not present page: P=0 W=0 U=0');
    eq(m.r32(c.getReg('esp')), 0, 'error code on the stack');
  });

  test('#PF on a write to a read-only page', function () {
    pagingSetup();
    c.cr0 = (c.cr0 | 0x00010000) >>> 0;
    m.load([0x66, 0x89, 0x05, 0x00, 0x90, 0x00, 0x00], 0x1000);   /* mov [0x9000], ax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eip, 0x0710, '#PF handler entered');
    eq(c.cr2, 0x9000, 'CR2');
    eq(c.lastException.errorCode, 3, 'P=1 W=1');
    m.w32(0x4000 + 9 * 4, 0x9000 | 0x07);            /* make it writable */
    c.flushTLB();
    eq(c.translate(0x9000, true, false), 0x9000, 'writable again');
  });

  test('#PF for a user access to a supervisor page', function () {
    pagingSetup();
    m.setGate(0x80, 0x0730, 0x08, 0xEE);
    c.setReg('ax', 0x28);
    m.load([0x0F, 0x00, 0xD8], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    var esp = 0x8000;
    m.w32(esp - 4, 0x23);
    m.w32(esp - 8, 0x6000);
    m.w32(esp - 12, 0x0002);
    m.w32(esp - 16, 0x1B);
    m.w32(esp - 20, 0x0500);
    c.setReg('esp', esp - 20);
    m.load([0xCF], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getSeg('cs').sel, 0x1B, 'now at ring 3');
    m.load([0xA1, 0x00, 0xA0, 0x00, 0x00], 0x500);   /* mov eax,[0xA000] as user */
    c.setReg('eip', 0x500);
    c.step();
    eq(c.eip, 0x0710, '#PF handler entered');
    eq(c.lastException.errorCode, 5, 'P=1 W=0 U=1');
    eq(c.cr2, 0xA000, 'CR2');
  });

  test('INVLPG drops one TLB entry', function () {
    pagingSetup();
    eq(c.translate(0x8000, false, false), 0xA000, 'first mapping');
    m.w32(0x4000 + 8 * 4, 0xB000 | 0x07);
    eq(c.translate(0x8000, false, false), 0xA000, 'stale TLB entry');
    m.load([0x0F, 0x01, 0x3D, 0x00, 0x80, 0x00, 0x00], 0x1000);   /* invlpg [0x8000] */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.translate(0x8000, false, false), 0xB000, 'INVLPG reloads the entry');
  });
});

/* ------------------------------------------------------------------- FPU -- */

suite('cpu fpu', function () {
  var m = new Machine();
  var c = m.cpu;

  test('FILD/FIST round trip', function () {
    m.reset16();
    m.w32(0x400, 1234);
    m.load([0xDB, 0x06, 0x00, 0x04], 0x100);           /* fild dword [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    m.load([0xDB, 0x1E, 0x04, 0x04], 0x100);           /* fistp dword [0x404] */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r32(0x404), 1234, 'fild/fistp round trip');
    eq(c.fv[c.ftop], 0, 'stack empty after fistp');

    m.reset16();
    m.w16(0x400, 0xFFF6);                              /* -10 */
    m.load([0xDF, 0x06, 0x00, 0x04], 0x100);           /* fild word [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    m.load([0xDF, 0x1E, 0x02, 0x04], 0x100);           /* fistp word [0x402] */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r16(0x402), 0xFFF6, 'signed 16-bit round trip');
  });

  test('FLD/FADD/FMUL/FDIV on reals', function () {
    m.reset16();
    m.w32(0x400, 0x3FC00000);                          /* 1.5f */
    m.w32(0x408, 0x40100000);                          /* 2.25f */
    m.load([0xD9, 0x06, 0x00, 0x04], 0x100);          /* fld dword [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    m.load([0xD8, 0x06, 0x08, 0x04], 0x100);          /* fadd dword [0x408] */
    c.setReg('eip', 0x100);
    c.step();
    m.load([0xD9, 0x1E, 0x10, 0x04], 0x100);          /* fstp dword [0x410] */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r32(0x410), 0x40700000, 'fld+fadd store 3.75');

    m.reset16();
    m.w32(0x400, 0x3FC00000);
    m.w32(0x408, 0x40100000);
    m.load([0xD9, 0x06, 0x00, 0x04], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    m.load([0xD8, 0x0E, 0x08, 0x04], 0x100);          /* fmul dword [0x408] */
    c.setReg('eip', 0x100);
    c.step();
    m.load([0xD9, 0x1E, 0x10, 0x04], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r32(0x410), 0x40580000, 'fmul 1.5 * 2.25 = 3.375');

    m.reset16();
    m.w32(0x400, 0x40000000);                          /* 2.0f */
    m.w32(0x408, 0x40800000);                          /* 4.0f */
    m.load([0xD9, 0x06, 0x00, 0x04], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    m.load([0xD8, 0x36, 0x08, 0x04], 0x100);          /* fdiv dword [0x408] */
    c.setReg('eip', 0x100);
    c.step();
    m.load([0xD9, 0x1E, 0x10, 0x04], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r32(0x410), 0x3F000000, 'fdiv 2 / 4 = 0.5');
  });

  test('FSQRT and 80-bit FLD/FSTP', function () {
    m.reset16();
    m.w32(0x400, 0x40000000);                          /* 2.0 */
    m.load([0xD9, 0x06, 0x00, 0x04, 0xD9, 0xFA], 0x100);   /* fld dword [0x400]; fsqrt */
    c.setReg('eip', 0x100);
    c.step();
    c.step();
    m.load([0xD9, 0x1E, 0x10, 0x04], 0x100);          /* fstp dword [0x410] */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r32(0x410), 0x3FB504F3, 'fsqrt(2) as a float');

    m.reset16();
    m.w32(0x400, 0x00000000);
    m.w32(0x404, 0xC0000000);                          /* 1.5 in 80-bit */
    m.w16(0x408, 0x3FFF);
    m.load([0xDB, 0x2E, 0x00, 0x04], 0x100);          /* fld tbyte [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    m.load([0xDB, 0x3E, 0x10, 0x04], 0x100);          /* fstp tbyte [0x410] */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r16(0x418), 0x3FFF, '80-bit exponent round trip');
    eq(m.r32(0x414), 0xC0000000, '80-bit mantissa high round trip');
  });

  test('FCOMI, FSTSW AX and the status word', function () {
    m.reset16();
    m.load([0xD9, 0xE8, 0xD9, 0xE8, 0xDB, 0xF1, 0xDF, 0xE0], 0x100);  /* fld1; fld1; fcomi st0,st1; fnstsw ax */
    c.setReg('eip', 0x100);
    c.step();
    c.step();
    c.step();
    eq(c.getFlag('zf'), 1, 'fcomi equal sets zf');
    eq(c.getFlag('pf'), 0, 'fcomi equal clears pf');
    eq(c.getFlag('cf'), 0, 'fcomi equal clears cf');
    c.step();
    eq((c.getReg('ax') >> 14) & 1, 1, 'fstsw ax C3 set for equal');
    eq((c.getReg('ax') >> 11) & 7, 6, 'fstsw ax top of stack is 6 after two pushes');

    m.reset16();
    m.load([0xD9, 0xE8, 0xD9, 0xEE, 0xDB, 0xF1, 0xDF, 0xE0], 0x100);  /* fld1; fldz; fcomi; fnstsw ax */
    c.setReg('eip', 0x100);
    c.step();
    c.step();
    c.step();
    eq(c.getFlag('cf'), 1, 'fcomi less sets cf');
    eq(c.getFlag('zf'), 0, 'fcomi less clears zf');
    c.step();
    eq((c.getReg('ax') >> 8) & 1, 1, 'fstsw ax C0 set for less');
  });

  test('FXCH, FNINIT and FLDCW/FNSTCW', function () {
    m.reset16();
    m.load([0xD9, 0xE8, 0xD9, 0xEE, 0xD9, 0xC9], 0x100);   /* fld1; fldz; fxch st1 */
    c.setReg('eip', 0x100);
    c.step();
    c.step();
    eq(c.fv[c.ftop], 0, 'st0 is zero before fxch');
    c.step();
    eq(c.fv[c.ftop], 1, 'fxch swapped st0 and st1');

    m.load([0xDB, 0xE3], 0x100);                       /* fninit */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.fcw, 0x037F, 'fninit restores the control word');
    eq(c.ftop, 0, 'fninit clears the stack');

    m.w16(0x400, 0x077F);
    m.load([0xD9, 0x2E, 0x00, 0x04], 0x100);           /* fldcw [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.fcw, 0x077F, 'fldcw');
    m.load([0xD9, 0x3E, 0x02, 0x04], 0x100);           /* fnstcw [0x402] */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r16(0x402), 0x077F, 'fnstcw round trip');
  });

  test('unimplemented FPU opcode raises #UD', function () {
    m.reset16();
    m.w16(6 * 4, 0x0600); m.w16(6 * 4 + 2, 0);
    m.load([0xDA, 0xC0], 0x100);                       /* fcmovb: not on a 486 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x0600, '#UD taken');
    eq(c.lastException.vector, 6, 'vector 6');
  });
});


/* ------------------------------------------------------- 0F map coverage -- */

suite('cpu 386/486 opcodes', function () {
  var m = new Machine();
  var c = m.cpu;

  test('BSF and BSR', function () {
    m.reset16();
    c.setReg('ax', 0x0030);
    m.load([0x0F, 0xBC, 0xC1], 0x100);      /* bsf ax, cx */
    c.setReg('cx', 0x0030);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 4, 'bsf');
    eq(c.getFlag('zf'), 0, 'bsf zf clear');
    m.reset16();
    c.setReg('cx', 0);
    c.setReg('ax', 0x1234);
    m.load([0x0F, 0xBC, 0xC1], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('zf'), 1, 'bsf zero operand sets zf');
    eq(c.getReg('ax'), 0x1234, 'bsf leaves the destination alone');
    m.reset16();
    c.setReg('cx', 0x0010);
    m.load([0x0F, 0xBD, 0xC1], 0x100);      /* bsr ax, cx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 4, 'bsr');
  });

  test('MOVZX and MOVSX', function () {
    m.reset16();
    c.setReg('bl', 0x80);
    m.load([0x0F, 0xB6, 0xC3], 0x100);      /* movzx ax, bl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x0080, 'movzx byte');
    m.load([0x0F, 0xBE, 0xC3], 0x100);      /* movsx ax, bl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0xFF80, 'movsx byte');
    m.reset16();
    c.setReg('bx', 0x8000);
    c.setReg('ax', 0);
    m.load([0x66, 0x0F, 0xBF, 0xC3], 0x100);   /* movsx eax, bx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0xFFFF8000, 'movsx word to dword');
  });

  test('BT BTS BTR BTC', function () {
    m.reset16();
    c.setReg('ax', 0x0008);
    m.load([0x0F, 0xA3, 0xD8], 0x100);      /* bt ax, bx */
    c.setReg('bx', 3);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('cf'), 1, 'bt bit set');
    c.setReg('bx', 2);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('cf'), 0, 'bt bit clear');

    m.reset16();
    c.setReg('ax', 0x0000);
    m.load([0x0F, 0xBA, 0xE8, 0x04], 0x100);   /* bts ax, 4 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x0010, 'bts');
    eq(c.getFlag('cf'), 0, 'bts reports the old bit');
    m.load([0x0F, 0xBA, 0xF0, 0x04], 0x100);   /* btr ax, 4 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x0000, 'btr');
    eq(c.getFlag('cf'), 1, 'btr reports the old bit');
    m.load([0x0F, 0xBA, 0xF8, 0x00], 0x100);   /* btc ax, 0 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x0001, 'btc toggles on');
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x0000, 'btc toggles off');
  });

  test('SETcc', function () {
    m.reset16();
    c.setReg('al', 0xAA);
    c.setFlag('cf', 1);
    m.load([0x0F, 0x92, 0xC0], 0x100);      /* setc al */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 1, 'setc when cf set');
    c.setFlag('cf', 0);
    m.load([0x0F, 0x92, 0xC0], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0, 'setc when cf clear');
    m.load([0x0F, 0x95, 0xC0], 0x100);      /* setne al */
    c.setFlag('zf', 1);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0, 'setne when zf set');
  });

  test('XADD and CMPXCHG', function () {
    m.reset16();
    c.setReg('ax', 3); c.setReg('bx', 5);
    m.load([0x0F, 0xC1, 0xD8], 0x100);      /* xadd ax, bx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 8, 'xadd destination');
    eq(c.getReg('bx'), 3, 'xadd source gets the old destination');

    m.reset16();
    c.setReg('eax', 0x1234);
    c.setReg('ecx', 0x9999);
    m.load([0x0F, 0xB1, 0xC8], 0x100);      /* cmpxchg eax, ecx? (66 needed for 32-bit) */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('zf'), 1, 'cmpxchg equal sets zf');

    m.reset16();
    c.setReg('ax', 0x1111);
    c.setReg('bx', 0x2222);
    c.setReg('cx', 0x3333);
    m.load([0x0F, 0xB1, 0xD9], 0x100);      /* cmpxchg cx, bx  (dst=cx, src=bx) */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('zf'), 0, 'cmpxchg mismatch clears zf');
    eq(c.getReg('ax'), 0x3333, 'cmpxchg loads the accumulator');
  });

  test('CMPXCHG8B and BSWAP', function () {
    m.protFlat();
    c.setReg('eax', 0x11111111); c.setReg('edx', 0x22222222);
    c.setReg('ebx', 0xAAAA0000); c.setReg('ecx', 0xBBBB0000);
    m.w32(0x2000, 0x11111111); m.w32(0x2004, 0x22222222);
    m.load([0x0F, 0xC7, 0x0D, 0x00, 0x20, 0x00, 0x00], 0x1000);   /* cmpxchg8b [0x2000] */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getFlag('zf'), 1, 'cmpxchg8b equal');
    eq(m.r32(0x2000), 0xAAAA0000, 'low half stored');
    eq(m.r32(0x2004), 0xBBBB0000, 'high half stored');

    m.protFlat();
    c.setReg('eax', 0x11223344);
    m.load([0x0F, 0xC8], 0x1000);           /* bswap eax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eax >>> 0, 0x44332211, 'bswap eax');
  });

  test('CPUID reports a 486DX', function () {
    m.reset16();
    c.setReg('eax', 0);
    m.load([0x0F, 0xA2], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 1, 'max basic leaf');
    eq(c.ebx >>> 0, 0x756E6547, 'Genu');
    eq(c.edx >>> 0, 0x49656E69, 'ineI');
    eq(c.ecx >>> 0, 0x6C65746E, 'ntel');
    c.setReg('eax', 1);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0x0433, 'family 4 model 3 stepping 3');
    eq(c.edx >>> 0, 0x00000007, 'FPU VME DE set, PSE TSC clear');
    c.setReg('eax', 5);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eax >>> 0, 0, 'unknown leaf returns zero');
  });

  test('LAR LSL VERR VERW', function () {
    m.setupProt();
    m.enterProt();
    c.setReg('ax', 0x10);                   /* ring-0 data descriptor */
    m.load([0x0F, 0x02, 0xC8], 0x1000);     /* lar cx, ax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getFlag('zf'), 1, 'lar succeeded');
    eq((c.getReg('cx') >> 8) & 0xFF, 0x92, 'lar returns the access byte');

    m.load([0x0F, 0x03, 0xC8], 0x1000);     /* lsl cx, ax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getFlag('zf'), 1, 'lsl succeeded');
    eq(c.getReg('cx'), 0xFFFF, 'lsl low limit');
    m.load([0x66, 0x0F, 0x03, 0xC8], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getReg('ecx') >>> 0, 0xFFFFFFFF, 'lsl applies the granularity');

    c.setReg('ax', 0x38);                   /* limit 0x0F, dpl 0 */
    m.load([0x66, 0x0F, 0x03, 0xC8], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getReg('cx'), 0x000F, 'lsl small limit');

    c.setReg('ax', 0x10);
    m.load([0x0F, 0x00, 0xE0], 0x1000);     /* verr ax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getFlag('zf'), 1, 'verr accepts a data segment');
    m.load([0x0F, 0x00, 0xE8], 0x1000);     /* verw ax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getFlag('zf'), 1, 'verw accepts writable data');
  });

  test('MOV to/from CR and DR', function () {
    m.protFlat();
    c.setReg('eax', 0x00000011);
    m.load([0x0F, 0x22, 0xC0], 0x1000);     /* mov cr0, eax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.cr0 & 0x1F, 0x11, 'mov cr0, eax');
    c.setReg('eax', 0x00003000);
    m.load([0x0F, 0x22, 0xD8], 0x1000);     /* mov cr3, eax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.cr3, 0x3000, 'mov cr3, eax');
    m.load([0x0F, 0x20, 0xD8], 0x1000);     /* mov eax, cr3 */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eax >>> 0, 0x3000, 'mov eax, cr3');
    eq(c.getCR(3), 0x3000, 'getCR');
    c.setReg('eax', 0x1234);
    m.load([0x0F, 0x23, 0xC0], 0x1000);     /* mov dr0, eax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getDR(0), 0x1234, 'mov dr0, eax');
    m.load([0x0F, 0x21, 0xC8], 0x1000);     /* mov ecx, dr1 */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getReg('ecx') >>> 0, 0, 'mov ecx, dr1');
    c.setDR(1, 0x99);
    eq(c.getDR(1), 0x99, 'setDR');
  });

  test('undefined opcodes raise #UD', function () {
    var cases = [
      [[0x0F, 0x0B], 'ud2'],
      [[0x0F, 0x31], 'rdtsc'],
      [[0x0F, 0x30], 'wrmsr'],
      [[0x0F, 0x40, 0xC0], 'cmovcc'],
      [[0xF1], 'icebp'],
      [[0x0F, 0x24, 0xC0], 'mov tr'],
      [[0xFF, 0xF8], 'group5 /7'],
      [[0x0F, 0xFF], 'bogus 0F']
    ];
    var i, t;
    for (i = 0; i < cases.length; i++) {
      t = cases[i];
      m.reset16();
      m.w16(6 * 4, 0x0600); m.w16(6 * 4 + 2, 0);
      m.load(t[0], 0x100);
      c.setReg('eip', 0x100);
      c.step();
      eq(c.eip, 0x0600, '#UD for ' + t[1]);
      eq(c.lastException.vector, 6, 'vector 6 for ' + t[1]);
    }
  });
});

/* --------------------------------------------------------------- io/port -- */

suite('cpu io and control', function () {
  var m = new Machine();
  var c = m.cpu;

  test('IN/OUT with immediate and DX ports', function () {
    m.reset16();
    m.ports[0x60] = 0x1C;
    m.load([0xE4, 0x60], 0x100);            /* in al, 0x60 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0x1C, 'in al, imm8');
    m.load([0xE6, 0x61], 0x100);            /* out 0x61, al */
    c.setReg('eip', 0x100);
    c.setReg('al', 0x77);
    c.step();
    eq(m.ports[0x61], 0x77, 'out imm8, al');
    m.reset16();
    m.ports[0x1F0] = 0x1234;
    c.setReg('dx', 0x1F0);
    m.load([0xED], 0x100);                  /* in ax, dx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x1234, 'in ax, dx');
    m.load([0x66, 0xEF], 0x100);            /* out dx, eax */
    c.setReg('eip', 0x100);
    c.setReg('eax', 0x55667788);
    c.step();
    eq(m.ports[0x1F0] >>> 0, 0x55667788, 'out dx, eax');
  });

  test('CLI/STI/CLD/STD/CMC and LAHF', function () {
    m.reset16();
    c.setFlag('cf', 0);
    m.load([0xF9], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('cf'), 1, 'stc');
    m.load([0xF5], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('cf'), 0, 'cmc');
    m.load([0xF8], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('cf'), 0, 'clc');
    m.load([0xFD], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('df'), 1, 'std');
    m.load([0xFC], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('df'), 0, 'cld');
    m.load([0xFA], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('if'), 0, 'cli in real mode');
    m.load([0xFB], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getFlag('if'), 1, 'sti in real mode');
  });

  test('Jcc covers all 16 conditions', function () {
    m.reset16();
    m.load([0x90], 0x102);
    /* of=0 cf=0 zf=0 sf=0 pf=0 -> JO/JB/JE/JS/JP/JL/JBE jump when their flag sets */
    var jumpTaken = [
      0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0
    ];
    var expect = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1];
    var i;
    for (i = 0; i < 16; i++) {
      m.reset16();
      c.setFlag('of', 0); c.setFlag('cf', 0); c.setFlag('zf', 0);
      c.setFlag('sf', 0); c.setFlag('pf', 0);
      m.load([0x70 + i, 0x02], 0x100);
      c.setReg('eip', 0x100);
      c.step();
      jumpTaken[i] = c.eip === 0x104 ? 1 : 0;
      eq(jumpTaken[i], expect[i], 'jcc 0x' + (0x70 + i).toString(16) + ' with all flags clear');
    }
  });

  test('LOOP and JCXZ', function () {
    m.reset16();
    c.setReg('cx', 2);
    m.load([0xE2, 0x00], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('cx'), 1, 'loop decrements cx');
    eq(c.eip, 0x102, 'loop taken');
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('cx'), 0, 'cx exhausted');
    eq(c.eip, 0x102, 'loop falls through when cx hits zero');
    m.reset16();
    c.setReg('cx', 0);
    m.load([0xE3, 0x00], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x102, 'jcxz taken when cx is zero');
    m.reset16();
    c.setReg('cx', 5);
    c.setFlag('zf', 1);
    m.load([0xE1, 0x00], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x102, 'loope taken while zf set');
  });

  test('XLAT and LEA', function () {
    m.reset16();
    c.setReg('bx', 0x400);
    c.setReg('al', 3);
    m.w8(0x403, 0xAB);
    m.load([0xD7], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0xAB, 'xlat');
    m.reset16();
    c.setReg('bx', 0x1000);
    c.setReg('si', 0x0020);
    m.load([0x8D, 0x40, 0x10], 0x100);      /* lea ax, [bx+si+0x10] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x1030, 'lea 16-bit');
  });

  test('NOP, WAIT and LOCK are accepted', function () {
    m.reset16();
    m.load([0x90], 0x100);
    eq(m.execAt([0x90], 0x100), 1, 'nop length');
    m.load([0x9B], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x101, 'fwait is a no-op');
    m.reset16();
    c.setReg('al', 1); c.setReg('bl', 2);
    m.load([0xF0, 0x00, 0xD8], 0x100);      /* lock add al, bl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 3, 'lock prefix accepted');
  });

  test('public API: readMem, writeMem, translate and cycle counting', function () {
    m.reset16();
    c.writeMem8(0x500, 'ds', 0x99);
    eq(m.r8(0x500), 0x99, 'writeMem8');
    eq(c.readMem8(0x500, 'ds'), 0x99, 'readMem8');
    c.writeMem16(0x502, 'ds', 0x1234);
    eq(c.readMem16(0x502, 'ds'), 0x1234, 'readMem16');
    c.writeMem32(0x504, 'ds', 0xDEADBEEF);
    eq(c.readMem32(0x504, 'ds'), 0xDEADBEEF, 'readMem32');
    eq(c.translate(0x500, false, false), 0x500, 'translate without paging is the identity');
    var before = c.cycles;
    m.load([0x90, 0x90, 0x90], 0x100);
    c.setReg('eip', 0x100);
    eq(c.run(3), 3, 'run returns the executed count');
    eq(c.cycles > before, true, 'cycles advance');
    eq(c.run(0), 0, 'run(0) does nothing');
  });

  test('serviceNMI and servicePendingInterrupt', function () {
    m.reset16();
    c.setFlag('if', 1);
    m.w16(2 * 4, 0x0300); m.w16(2 * 4 + 2, 0);
    c.serviceNMI();
    eq(c.eip, 0x0300, 'NMI vectors to 2');
    m.reset16();
    c.setFlag('if', 0);
    m.w16(0x20 * 4, 0x0400); m.w16(0x20 * 4 + 2, 0);
    c.pendingIRQ = 0x20;
    eq(c.servicePendingInterrupt(), false, 'pending irq waits for IF');
    c.setFlag('if', 1);
    eq(c.servicePendingInterrupt(), true, 'pending irq delivered');
    eq(c.eip, 0x0400, 'pending irq vector');
  });

  test('triple fault when the IDT cannot be used', function () {
    m.setupProt();
    c.idtr.limit = 0;                        /* unusable IDT */
    m.enterProt();
    m.load([0x66, 0x8B, 0x05, 0x00, 0x20, 0x00, 0x00], 0x1000);  /* fine here */
    c.setSeg('ds', 0x38);
    m.load([0x66, 0x8B, 0x05, 0x00, 0x20, 0x00, 0x00], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.tripleFault, true, 'triple fault reached');
    eq(c.halted, true, 'cpu halted');
  });

  test('V86 entry, segment bases and IOPL emulation', function () {
    m.setupProt();
    m.setGate(13, 0x0700, 0x08, 0x8F);
    m.enterProt();
    c.setReg('ax', 0x28);
    m.load([0x0F, 0x00, 0xD8], 0x1000);      /* ltr ax */
    c.setReg('eip', 0x1000);
    c.step();
    var esp = 0x8000;
    m.w32(esp - 4, 0x0000);                  /* GS */
    m.w32(esp - 8, 0x0000);                  /* FS */
    m.w32(esp - 12, 0x1000);                 /* DS -> base 0x10000 */
    m.w32(esp - 16, 0x0000);                 /* ES */
    m.w32(esp - 20, 0x2000);                 /* SS -> base 0x20000 */
    m.w32(esp - 24, 0xFFF0);                 /* ESP */
    m.w32(esp - 28, 0x00020002);             /* EFLAGS: VM | IF | bit1 */
    m.w32(esp - 32, 0x3000);                 /* CS -> base 0x30000 */
    m.w32(esp - 36, 0x0100);                 /* EIP */
    c.setReg('esp', esp - 36);
    m.load([0xCF], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getSeg('cs').base >>> 0, 0x30000, 'V86 cs base from the selector');
    eq(c.getSeg('ss').base >>> 0, 0x20000, 'V86 ss base');
    eq(c.getSeg('ds').base >>> 0, 0x10000, 'V86 ds base');
    eq(c.getReg('esp'), 0xFFF0, 'V86 stack pointer');
    eq(c.eip, 0x0100, 'V86 entry offset');
    eq(c.cpl, 3, 'V86 runs at ring 3');
    eq((c.eflags & 0x20000) !== 0, true, 'VM flag set');
    m.load([0xFA], 0x30100);                 /* cli with IOPL 0 */
    c.setReg('eip', 0x0100);
    c.step();
    eq(c.eip, 0x0700, 'cli in V86 raises #GP');
    eq(c.lastException.vector, 13, 'vector 13');
  });

  test('alignment check raises #AC', function () {
    m.setupProt();
    m.setGate(17, 0x0720, 0x08, 0x8F);
    m.enterProt();
    c.setReg('ax', 0x28);
    m.load([0x0F, 0x00, 0xD8], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    c.cr0 = (c.cr0 | 0x00040000) >>> 0;       /* AM */
    var esp = 0x8000;
    m.w32(esp - 4, 0x23);
    m.w32(esp - 8, 0x6000);
    m.w32(esp - 12, 0x00040002);              /* AC set */
    m.w32(esp - 16, 0x1B);
    m.w32(esp - 20, 0x0500);
    c.setReg('esp', esp - 20);
    m.load([0xCF], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getSeg('cs').sel, 0x1B, 'at ring 3');
    eq((c.eflags & 0x40000) !== 0, true, 'AC set');
    m.load([0x66, 0x8B, 0x03], 0x500);        /* mov ax, [ebx] unaligned */
    c.setReg('ebx', 0x1001);
    c.setReg('eip', 0x500);
    c.step();
    eq(c.eip, 0x0720, '#AC delivered');
    eq(c.lastException.vector, 17, 'vector 17');
  });
});

/* -------------------------------------------------------------- programs -- */

suite('cpu real programs', function () {
  var m = new Machine();
  var c = m.cpu;

  test('first 20 Fibonacci numbers to memory (16-bit loop)', function () {
    /*
     *   mov ax,0 / mov bx,1 / mov si,0x400 / mov cx,20
     * loop: mov [si],ax / add si,2 / mov dx,ax / add ax,bx / mov bx,dx / loop loop / hlt
     */
    var code = [
      0xB8, 0x00, 0x00,
      0xBB, 0x01, 0x00,
      0xBE, 0x00, 0x04,
      0xB9, 0x14, 0x00,
      0x89, 0x04,
      0x83, 0xC6, 0x02,
      0x89, 0xC2,
      0x01, 0xD8,
      0x89, 0xD3,
      0xE2, 0xF3,
      0xF4
    ];
    m.reset16();
    m.load(code, 0x100);
    var executed = 0;
    while (!c.halted && executed < 1000) { c.step(); executed++; }
    eq(c.halted, true, 'program halted');
    eq(executed, 4 + 20 * 6 + 1, 'instruction count for 20 iterations');
    var fib = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181];
    var i;
    for (i = 0; i < 20; i++) eq(m.r16(0x400 + i * 2), fib[i], 'fib(' + i + ')');
    eq(c.getReg('si'), 0x400 + 40, 'si walked the table');
  });

  test('32-bit protected flat program writes memory and halts', function () {
    var code = [
      0xC7, 0x05, 0x00, 0x05, 0x00, 0x00, 0x78, 0x56, 0x34, 0x12,   /* mov dword [0x500],0x12345678 */
      0xA1, 0x00, 0x05, 0x00, 0x00,                                  /* mov eax,[0x500] */
      0x05, 0x01, 0x00, 0x00, 0x00,                                  /* add eax,1 */
      0xA3, 0x04, 0x05, 0x00, 0x00,                                  /* mov [0x504],eax */
      0xF4
    ];
    m.protFlat();
    m.load(code, 0x1000);
    eq(c.run(10), 5, 'five instructions executed');
    eq(m.r32(0x500), 0x12345678, 'constant stored');
    eq(m.r32(0x504), 0x12345679, 'incremented value stored');
    eq(c.eax >>> 0, 0x12345679, 'eax holds the result');
    eq(c.halted, true, 'hlt stopped the cpu');
    eq(c.getSeg('cs').big, true, '32-bit code segment');
  });

  test('16-bit string program: copy and compare a buffer', function () {
    m.reset16();
    m.wstr(0x300, 'i486DX');
    /* cld; mov si,0x300; mov di,0x400; mov cx,6; rep movsb; hlt */
    m.load([0xFC, 0xBE, 0x00, 0x03, 0xBF, 0x00, 0x04, 0xB9, 0x06, 0x00, 0xF3, 0xA4, 0xF4], 0x100);
    c.run(20);
    eq(m.readStr(0x400, 6), 'i486DX', 'buffer copied');
    eq(c.halted, true, 'halted');
  });

  test('performance: a tight loop runs at millions of instructions per second', function () {
    m.reset16();
    /* mov cx, 0x2000  / loop: dec cx / jnz loop / hlt   -> 16384*2 + 2 instructions */
    m.load([0xB9, 0x00, 0x20, 0x49, 0x75, 0xFD, 0xF4], 0x100);
    c.run(4000);
    m.reset16();
    m.load([0xB9, 0x00, 0x20, 0x49, 0x75, 0xFD, 0xF4], 0x100);
    var t0 = process.hrtime.bigint();
    var n = 0;
    while (!c.halted && n < 200000) { c.step(); n++; }
    var t1 = process.hrtime.bigint();
    var ms = Number(t1 - t0) / 1e6;
    var rate = n / (ms / 1000);
    eq(c.halted, true, 'loop finished');
    eq(n, 2 + 8192 * 2, 'instruction count');
    console.log('       performance: ' + Math.round(rate / 1000) + 'k instructions/s (' +
      n + ' instructions in ' + ms.toFixed(1) + ' ms)');
    assert(rate > 1000000, 'expected more than 1M instructions per second, got ' + Math.round(rate));
  });
});


/* ------------------------------------------------------ extra coverage -- */

suite('cpu remaining instructions', function () {
  var m = new Machine();
  var c = m.cpu;

  test('PUSH/POP FS and GS', function () {
    m.reset16();
    c.setSeg('fs', 0x1111);
    c.setSeg('gs', 0x2222);
    c.setReg('esp', 0xFF00);
    m.load([0x0F, 0xA0, 0x0F, 0xA8], 0x100);   /* push fs; push gs */
    c.setReg('eip', 0x100);
    c.step();
    c.step();
    eq(m.r16(0xFEFE), 0x1111, 'fs pushed');
    eq(m.r16(0xFEFC), 0x2222, 'gs pushed');
    c.setSeg('fs', 0);
    c.setSeg('gs', 0);
    m.load([0x0F, 0xA9, 0x0F, 0xA1], 0x100);   /* pop gs; pop fs */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getSeg('gs').sel, 0x2222, 'gs popped');
    c.step();
    eq(c.getSeg('fs').sel, 0x1111, 'fs popped');
    eq(c.getReg('sp'), 0xFF00, 'stack balanced');
  });

  test('ARPL raises the destination RPL', function () {
    m.reset16();
    c.setReg('ax', 0x0008);
    c.setReg('bx', 0x0003);
    m.load([0x63, 0xD8], 0x100);               /* arpl ax, bx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x000B, 'arpl raised the rpl to 3');
    eq(c.getFlag('zf'), 1, 'zf set when adjusted');
    m.reset16();
    c.setReg('ax', 0x000B);
    c.setReg('bx', 0x0001);
    m.load([0x63, 0xD8], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x000B, 'arpl leaves a higher rpl alone');
    eq(c.getFlag('zf'), 0, 'zf clear when unchanged');
  });

  test('BOUND raises #BR', function () {
    m.reset16();
    m.w16(5 * 4, 0x0500); m.w16(5 * 4 + 2, 0);
    m.w16(0x400, 0x0010);
    m.w16(0x402, 0x0020);
    c.setReg('ax', 0x0015);
    m.load([0x62, 0x06, 0x00, 0x04], 0x100);   /* bound ax, [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x104, 'inside the bounds continues');
    m.reset16();
    m.w16(5 * 4, 0x0500); m.w16(5 * 4 + 2, 0);
    m.w16(0x400, 0x0010);
    m.w16(0x402, 0x0020);
    c.setReg('ax', 0x0030);
    m.load([0x62, 0x06, 0x00, 0x04], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x0500, 'above the bounds raises #BR');
    eq(c.lastException.vector, 5, 'vector 5');
  });

  test('ENTER with a nesting level and far RET imm16', function () {
    m.reset16();
    c.setReg('esp', 0xFF00);
    c.setReg('bp', 0x2000);
    c.setReg('ss', 0);
    m.load([0xC8, 0x00, 0x00, 0x01], 0x100);   /* enter 0, 1 */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('bp'), 0xFEFE, 'frame pointer is the pushed bp slot');
    eq(m.r16(0xFEFE), 0x2000, 'old bp saved');
    eq(m.r16(0xFEFC), 0xFEFE, 'level 1 pushes the frame pointer once more');
    eq(c.getReg('sp'), 0xFEFC, 'stack pointer after the level 1 frame');

    m.reset16();
    c.setReg('esp', 0xFF00);
    m.load([0xCA, 0x04, 0x00], 0x100);         /* retf 4 */
    m.w16(0xFF00, 0x1234);
    m.w16(0xFF02, 0x0000);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x1234, 'retf pops the offset');
    eq(c.getReg('sp'), 0xFF08, 'retf imm16 releases the arguments');
  });

  test('16-bit IRET restores flags and selector', function () {
    m.reset16();
    c.setReg('esp', 0xFF00);
    m.w16(0xFF00, 0x0123);      /* ip */
    m.w16(0xFF02, 0x0000);      /* cs */
    m.w16(0xFF04, 0x0046);      /* flags: zf pf */
    c.setFlag('zf', 0);
    c.setFlag('pf', 0);
    m.load([0xCF], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x0123, 'ip restored');
    eq(c.getFlag('zf'), 1, 'zf restored');
    eq(c.getFlag('pf'), 1, 'pf restored');
    eq(c.getReg('sp'), 0xFF06, 'stack popped');
  });

  test('32-bit PUSHF and POPF', function () {
    m.protFlat();
    c.setFlag('cf', 1);
    m.load([0x9C], 0x1000);                     /* pushfd */
    c.setReg('eip', 0x1000);
    c.step();
    eq(m.r32(c.getReg('esp')), (c.eflags >>> 0), 'pushfd stores eflags');
    c.setFlag('cf', 0);
    m.load([0x9D], 0x1000);                     /* popfd */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getFlag('cf'), 1, 'popfd restores cf');
  });

  test('INS and OUTS string ports', function () {
    m.reset16();
    m.ports[0x1F0] = 0xA5;
    c.setReg('dx', 0x1F0);
    c.setReg('di', 0x500);
    m.load([0x6C], 0x100);                      /* insb */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r8(0x500), 0xA5, 'insb port to memory');
    eq(c.getReg('di'), 0x501, 'di advanced');
    m.reset16();
    m.w8(0x500, 0x3C);
    c.setReg('dx', 0x1F0);
    c.setReg('si', 0x500);
    m.load([0x6E], 0x100);                      /* outsb */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.ports[0x1F0], 0x3C, 'outsb memory to port');
  });

  test('LSS and LFS load far pointers', function () {
    m.setupProt();
    m.enterProt();
    m.w32(0x3000, 0x00007000);                  /* offset */
    m.w16(0x3004, 0x0010);                      /* selector */
    c.setReg('esp', 0x8000);
    m.load([0x0F, 0xB2, 0x25, 0x00, 0x30, 0x00, 0x00], 0x1000);   /* lss esp, [0x3000] */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getReg('esp'), 0x7000, 'lss offset');
    eq(c.getSeg('ss').sel, 0x10, 'lss selector');
  });

  test('LMSW only changes the low four bits of CR0', function () {
    m.setupProt();
    m.enterProt();
    c.setReg('ax', 0x0005);
    m.load([0x0F, 0x01, 0xF0], 0x1000);         /* lmsw ax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.cr0 & 0x0F, 0x05, 'low cr0 bits replaced');
    eq(c.cr0 & 0x10, 0x10, 'ET stays set');
  });

  test('LTR sets the busy bit in the descriptor', function () {
    m.setupProt();
    m.enterProt();
    c.setReg('ax', 0x28);
    eq(m.r8(0x82D), 0x89, 'TSS descriptor before LTR');
    m.load([0x0F, 0x00, 0xD8], 0x1000);
    c.setReg('eip', 0x1000);
    c.step();
    eq(m.r8(0x82D), 0x8B, 'busy bit set by LTR');
  });

  test('FS/GS overrides reach the right segment', function () {
    m.reset16();
    c.setSeg('fs', 0x4000);
    c.setSeg('gs', 0x5000);
    m.w16(0x40000, 0xAAAA);
    m.w16(0x50000, 0xBBBB);
    m.load([0x64, 0x8B, 0x06, 0x00, 0x00], 0x100);   /* mov ax, fs:[0] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0xAAAA, 'fs override');
    m.load([0x65, 0x8B, 0x06, 0x00, 0x00], 0x100);   /* mov ax, gs:[0] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0xBBBB, 'gs override');
  });

  test('JMP far through a memory pointer', function () {
    m.reset16();
    m.w16(0x400, 0x0100);
    m.w16(0x402, 0x0900);
    m.load([0xFF, 0x2E, 0x00, 0x04], 0x100);    /* jmp far [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x0100, 'far jmp offset');
    eq(c.getSeg('cs').sel, 0x0900, 'far jmp selector');
    eq(c.getSeg('cs').base >>> 0, 0x9000, 'far jmp base');
  });

  test('REP MOVSW moves words and honours the operand size', function () {
    m.reset16();
    m.w16(0x200, 0x1111); m.w16(0x202, 0x2222);
    c.setReg('si', 0x200); c.setReg('di', 0x300); c.setReg('cx', 2);
    c.setFlag('df', 0);
    m.load([0xF3, 0xA5], 0x100);                /* rep movsw */
    c.setReg('eip', 0x100);
    c.step();
    eq(m.r16(0x300), 0x1111, 'first word');
    eq(m.r16(0x302), 0x2222, 'second word');
    eq(c.getReg('di'), 0x304, 'di advanced by 4');
  });


  test('translate and readMem report faults to callers outside step()', function () {
    m.setupProt();
    m.enterProt();
    c.setSeg('ds', 0x38);                       /* limit 0x0F */
    eq(c.getSeg('ds').limit, 0x0F, 'small segment limit loaded');
    harness.throws(function () { c.readMem8(0x20, 'ds'); }, 'readMem8 beyond the segment limit throws');
    var caught = null;
    try { c.readMem8(0x20, 'ds'); } catch (e) { caught = e; }
    eq(caught.vector, 13, 'fault carries the vector');
    eq(caught.errorCode, 0, 'fault carries the error code');
    eq(c.readMem8(0x08, 'ds'), 0, 'a linear address inside the segment works');
    harness.throws(function () { c.writeMem8(0x20, 'ds', 1); }, 'writeMem8 beyond the limit throws');
    eq(c.translate(0x1234, false, false), 0x1234, 'identity translation without paging');
  });

  test('XCHG, MOV Sreg and LES', function () {
    m.reset16();
    c.setReg('ax', 0x1111);
    c.setReg('bx', 0x2222);
    m.load([0x93], 0x100);                       /* xchg ax, bx */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('ax'), 0x2222, 'xchg ax');
    eq(c.getReg('bx'), 0x1111, 'xchg bx');
    m.reset16();
    c.setReg('al', 0x5A);
    c.setReg('bl', 0xA5);
    m.load([0x86, 0xD8], 0x100);                 /* xchg al, bl */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('al'), 0xA5, 'xchg al');
    eq(c.getReg('bl'), 0x5A, 'xchg bl');

    m.protFlat();
    c.setReg('eax', 0x10);
    m.load([0x8E, 0xD8], 0x1000);                /* mov ds, ax */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getSeg('ds').sel, 0x10, 'mov ds, ax');
    m.load([0x8C, 0xC8], 0x1000);                /* mov ax, cs */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.getReg('ax'), 0x08, 'mov ax, cs');

    m.reset16();
    m.w16(0x400, 0x0200);
    m.w16(0x402, 0x0300);
    m.load([0xC4, 0x1E, 0x00, 0x04], 0x100);     /* les bx, [0x400] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('bx'), 0x0200, 'les offset');
    eq(c.getSeg('es').sel, 0x0300, 'les selector');
    m.w16(0x410, 0x0400);
    m.w16(0x412, 0x0500);
    m.load([0xC5, 0x2E, 0x10, 0x04], 0x100);     /* lds bp, [0x410] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.getReg('bp'), 0x0400, 'lds offset');
    eq(c.getSeg('ds').sel, 0x0500, 'lds selector');
  });
});


/* -------------------------------------------------------- moffs A0-A3 -- */

suite('cpu moffs addressing (A0-A3)', function () {
  var m = new Machine();
  var c = m.cpu;

  /* Reset, stage the code at 0x100, let setup fill memory, run one instruction. */
  function run1(code, setup) {
    m.reset16();
    m.w32(0x300, 0);
    m.w32(0x304, 0);
    m.w32(0x300, 0x11223344);
    m.load(code, 0x100);
    if (setup) setup(c);
    c.setReg('eip', 0x100);
    c.step();
    return c.eip - 0x100;
  }

  test('load forms: AL/AL/AX/EAX with a16 and a32', function () {
    var adv;
    adv = run1([0xA0, 0x00, 0x03]);
    eq(adv, 3, 'A0 00 03 advance (o8 a16)');
    eq(c.getReg('al'), 0x44, 'A0 value');

    adv = run1([0x67, 0xA0, 0x00, 0x03, 0x00, 0x00]);
    eq(adv, 6, '67 A0 advance (o8 a32)');
    eq(c.getReg('al'), 0x44, '67 A0 value');

    adv = run1([0x66, 0xA0, 0x00, 0x03]);
    eq(adv, 4, '66 A0 advance (o8 a16, prefix + opcode + 2-byte offset)');
    eq(c.getReg('al'), 0x44, '66 A0 value');

    adv = run1([0x66, 0x67, 0xA0, 0x00, 0x03, 0x00, 0x00]);
    eq(adv, 7, '66 67 A0 advance (o8 a32)');
    eq(c.getReg('al'), 0x44, '66 67 A0 value');

    adv = run1([0xA1, 0x00, 0x03]);
    eq(adv, 3, 'A1 advance (o16 a16)');
    eq(c.getReg('ax'), 0x3344, 'A1 value');

    adv = run1([0x66, 0xA1, 0x00, 0x03]);
    eq(adv, 4, '66 A1 advance (o32 a16)');
    eq(c.eax >>> 0, 0x11223344, '66 A1 value');

    adv = run1([0x67, 0xA1, 0x00, 0x03, 0x00, 0x00]);
    eq(adv, 6, '67 A1 advance (o16 a32)');
    eq(c.getReg('ax'), 0x3344, '67 A1 value');

    adv = run1([0x66, 0x67, 0xA1, 0x00, 0x03, 0x00, 0x00]);
    eq(adv, 7, '66 67 A1 advance (o32 a32)');
    eq(c.eax >>> 0, 0x11223344, '66 67 A1 value');
  });

  test('store forms: AL/AX/EAX with a16 and a32', function () {
    var adv;
    adv = run1([0xA2, 0x00, 0x03], function (cpu) { cpu.setReg('al', 0xAB); });
    eq(adv, 3, 'A2 advance (o8 a16)');
    eq(m.r8(0x300), 0xAB, 'A2 value');

    adv = run1([0x67, 0xA2, 0x00, 0x03, 0x00, 0x00], function (cpu) { cpu.setReg('al', 0xCD); });
    eq(adv, 6, '67 A2 advance (o8 a32)');
    eq(m.r8(0x300), 0xCD, '67 A2 value');

    adv = run1([0x66, 0xA2, 0x00, 0x03], function (cpu) { cpu.setReg('al', 0xEF); });
    eq(adv, 4, '66 A2 advance (o8 a16)');
    eq(m.r8(0x300), 0xEF, '66 A2 value');

    adv = run1([0xA3, 0x00, 0x03], function (cpu) { cpu.setReg('ax', 0xABCD); });
    eq(adv, 3, 'A3 advance (o16 a16)');
    eq(m.r16(0x300), 0xABCD, 'A3 value');

    adv = run1([0x66, 0xA3, 0x00, 0x03], function (cpu) { cpu.setReg('eax', 0x12345678); });
    eq(adv, 4, '66 A3 advance (o32 a16)');
    eq(m.r32(0x300), 0x12345678, '66 A3 value');

    adv = run1([0x67, 0xA3, 0x00, 0x03, 0x00, 0x00], function (cpu) { cpu.setReg('ax', 0x0F1E); });
    eq(adv, 6, '67 A3 advance (o16 a32)');
    eq(m.r16(0x300), 0x0F1E, '67 A3 value');

    adv = run1([0x66, 0x67, 0xA3, 0x00, 0x03, 0x00, 0x00], function (cpu) { cpu.setReg('eax', 0x9ABCDEF0); });
    eq(adv, 7, '66 67 A3 advance (o32 a32)');
    eq(m.r32(0x300), 0x9ABCDEF0, '66 67 A3 value');
  });

  test('segment override and full 32-bit offsets', function () {
    var adv;
    adv = run1([0x26, 0xA1, 0x00, 0x03], function (cpu) {
      cpu.setSeg('es', 0x4000);
      m.w16(0x40300, 0x5A5A);
    });
    eq(adv, 4, '26 A1 advance');
    eq(c.getReg('ax'), 0x5A5A, 'ES override honoured by moffs');

    adv = run1([0x26, 0x67, 0xA1, 0x00, 0x03, 0x00, 0x00], function (cpu) {
      cpu.setSeg('es', 0x4000);
      m.w16(0x40300, 0x6B6B);
    });
    eq(adv, 7, '26 67 A1 advance');
    eq(c.getReg('ax'), 0x6B6B, 'ES override with a 32-bit offset');

    /* a32 offset above the 64K real-mode limit must fault, proving the width */
    m.reset16();
    m.w16(13 * 4, 0x0700); m.w16(13 * 4 + 2, 0);
    m.load([0x67, 0xA1, 0x00, 0x00, 0x10, 0x00], 0x100);   /* mov ax, [0x00100000] */
    c.setReg('eip', 0x100);
    c.step();
    eq(c.eip, 0x0700, 'a32 offset beyond the segment limit raises #GP');
    eq(c.lastException.vector, 13, 'vector 13');
    eq(c.lastException.errorCode, 0, 'error code 0');
  });

  test('moffs inside a 32-bit flat protected program', function () {
    m.protFlat();
    m.w32(0x300, 0xC0FFEE11);
    m.load([0xA1, 0x00, 0x03, 0x00, 0x00], 0x1000);         /* mov eax, [0x300] */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eip - 0x1000, 5, 'A1 in 32-bit code reads a 4-byte offset');
    eq(c.eax >>> 0, 0xC0FFEE11, 'dword loaded');
    m.load([0x66, 0xA1, 0x00, 0x03, 0x00, 0x00], 0x1000);   /* mov ax, [0x300] */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eip - 0x1000, 6, '66 A1 still uses the 32-bit offset');
    eq(c.getReg('ax'), 0xEE11, 'word loaded');
    m.load([0xA0, 0x00, 0x03, 0x00, 0x00], 0x1000);         /* mov al, [0x300] */
    c.setReg('eip', 0x1000);
    c.step();
    eq(c.eip - 0x1000, 5, 'A0 in 32-bit code reads a 4-byte offset');
    eq(c.getReg('al'), 0x11, 'byte loaded');
  });
});


/* ------------------------------------------- TEST accumulator forms A8/A9 -- */

suite('cpu TEST accumulator forms (A8/A9)', function () {
  var m = new Machine();
  var c = m.cpu;

  function test1(code, setup) {
    m.reset16();
    m.load(code, 0x100);
    if (setup) setup(c);
    c.setReg('eip', 0x100);
    c.step();
    return c.eip - 0x100;
  }

  test('A8 TEST AL, imm8', function () {
    var adv;
    adv = test1([0xA8, 0x80], function (cpu) {
      cpu.setReg('al', 0x80);
      cpu.setFlag('cf', 1); cpu.setFlag('of', 1); cpu.setFlag('af', 1);
    });
    eq(adv, 2, 'A8 advance');
    eq(c.getFlag('zf'), 0, 'A8 zf clear for 0x80');
    eq(c.getFlag('sf'), 1, 'A8 sf from the result');
    eq(c.getFlag('pf'), 0, 'A8 pf clear (one bit set)');
    eq(c.getFlag('cf'), 0, 'A8 clears cf');
    eq(c.getFlag('of'), 0, 'A8 clears of');
    eq(c.getFlag('af'), 0, 'A8 clears af');
    eq(c.getReg('al'), 0x80, 'A8 leaves AL untouched');

    adv = test1([0xA8, 0x00], function (cpu) { cpu.setReg('al', 0xFF); });
    eq(adv, 2, 'A8 00 advance');
    eq(c.getFlag('zf'), 1, 'A8 with a zero mask sets zf');
    eq(c.getFlag('pf'), 1, 'A8 zero result has even parity');
    eq(c.getReg('al'), 0xFF, 'A8 does not modify AL');

    adv = test1([0xA8, 0xFF], function (cpu) { cpu.setReg('al', 0x0F); });
    eq(adv, 2, 'A8 FF advance');
    eq(c.getFlag('zf'), 0, 'A8 FF keeps zf clear');
    eq(c.getFlag('sf'), 0, 'A8 FF sf clear');
    eq(c.getFlag('pf'), 1, 'A8 0x0F has even parity');
    eq(c.getFlag('cf'), 0, 'A8 FF clears cf');
  });

  test('A9 TEST AX/EAX, imm16/imm32', function () {
    var adv;
    adv = test1([0xA9, 0x80, 0x00], function (cpu) {
      cpu.setReg('ax', 0x0080);
      cpu.setFlag('cf', 1);
    });
    eq(adv, 3, 'A9 o16 advance');
    eq(c.getFlag('zf'), 0, 'A9 zf clear');
    eq(c.getFlag('sf'), 0, 'A9 sf clear');
    eq(c.getFlag('cf'), 0, 'A9 clears cf');
    eq(c.getReg('ax'), 0x0080, 'A9 leaves AX untouched');

    adv = test1([0xA9, 0x00, 0x00], function (cpu) { cpu.setReg('ax', 0x1234); });
    eq(adv, 3, 'A9 o16 zero mask advance');
    eq(c.getFlag('zf'), 1, 'A9 zero result sets zf');
    eq(c.getFlag('pf'), 1, 'A9 zero result has even parity');

    adv = test1([0x66, 0xA9, 0x00, 0x00, 0x00, 0xFF], function (cpu) { cpu.setReg('eax', 0x00345678); });
    eq(adv, 6, '66 A9 o32 advance');
    eq(c.getFlag('zf'), 1, 'A9 with a disjoint mask sets zf');
    eq(c.getFlag('sf'), 0, 'A9 o32 sf clear');
    eq(c.eax >>> 0, 0x00345678, 'A9 leaves EAX untouched');

    adv = test1([0x66, 0xA9, 0xF0, 0xFF, 0xFF, 0xFF], function (cpu) { cpu.setReg('eax', 0x80000001); });
    eq(adv, 6, '66 A9 o32 sign advance');
    eq(c.getFlag('sf'), 1, 'A9 o32 sf from bit 31');
    eq(c.getFlag('zf'), 0, 'A9 o32 zf clear');
    eq(c.getFlag('pf'), 1, 'A9 o32 parity from the low byte');
    eq(c.getFlag('of'), 0, 'A9 o32 clears of');
    eq(c.eax >>> 0, 0x80000001, 'A9 o32 preserves the accumulator');
  });

  test('A8/A9 do not disturb any other register', function () {
    m.reset16();
    c.setReg('eax', 0x11223344); c.setReg('ebx', 0x55667788);
    c.setReg('ecx', 0x99AABBCC); c.setReg('edx', 0xDDEEFF00);
    c.setReg('esi', 0x01020304); c.setReg('edi', 0x05060708);
    c.setReg('ebp', 0x090A0B0C);
    m.load([0xA8, 0xFF, 0xA9, 0xFF, 0xFF], 0x100);
    c.setReg('eip', 0x100);
    c.step();
    c.step();
    eq(c.eax >>> 0, 0x11223344, 'eax untouched');
    eq(c.ebx >>> 0, 0x55667788, 'ebx untouched');
    eq(c.ecx >>> 0, 0x99AABBCC, 'ecx untouched');
    eq(c.edx >>> 0, 0xDDEEFF00, 'edx untouched');
    eq(c.esi >>> 0, 0x01020304, 'esi untouched');
    eq(c.edi >>> 0, 0x05060708, 'edi untouched');
    eq(c.ebp >>> 0, 0x090A0B0C, 'ebp untouched');
  });
});

/* -------------------------------------------------- opcode presence sweep -- */

suite('cpu opcode presence sweep', function () {
  var m = new Machine();
  var c = m.cpu;

  /* 0x0F opens the two-byte map; the rest are prefix bytes, covered elsewhere. */
  var SKIP = {};
  [0x0F, 0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65, 0x66, 0x67, 0xF0, 0xF2, 0xF3]
    .forEach(function (v) { SKIP[v] = 1; });

  var hex2 = function (v) { return '0x' + (v < 16 ? '0' : '') + v.toString(16); };

  function tryOpcode(op) {
    var i, err = null;
    m.reset16();
    for (i = 0; i < 0x120; i++) m.w8(i, 0);
    m.w8(0x100, op);
    c.setReg('eip', 0x100);
    try { c.step(); } catch (e) { err = e; }
    return { err: err, vec: c.lastException ? c.lastException.vector : -1 };
  }

  test('every 486 one-byte opcode executes: no #UD, no JS throw', function () {
    var op, r, checked = 0;
    for (op = 0; op < 256; op++) {
      if (SKIP[op] || op === 0xD6 || op === 0xF1) continue;
      r = tryOpcode(op);
      checked++;
      eq(r.err, null, hex2(op) + ' must not throw a JS exception');
      assert(r.vec !== 6, hex2(op) + ' must not raise #UD');
    }
    eq(checked, 242, 'one-byte opcodes swept');
  });

  test('undefined one-byte opcodes still raise #UD', function () {
    var bad = [0xD6, 0xF1], i, r;
    for (i = 0; i < bad.length; i++) {
      r = tryOpcode(bad[i]);
      eq(r.err, null, hex2(bad[i]) + ' does not throw');
      eq(r.vec, 6, hex2(bad[i]) + ' raises #UD');
    }
  });

  test('documented 8086 forms execute instead of raising #UD', function () {
    /* 06/0E/16/1E PUSH ES/CS/SS/DS, 27/2F/37/3F DAA/DAS/AAA/AAS, A8/A9 TEST acc,imm */
    var valid = [0x06, 0x0E, 0x16, 0x1E, 0x27, 0x2F, 0x37, 0x3F, 0xA8, 0xA9];
    var i, r;
    for (i = 0; i < valid.length; i++) {
      r = tryOpcode(valid[i]);
      eq(r.err, null, hex2(valid[i]) + ' does not throw');
      assert(r.vec !== 6, hex2(valid[i]) + ' is a documented instruction, not #UD');
    }
  });
});

if (require.main === module) { process.exit(harness.run() ? 1 : 0); }
