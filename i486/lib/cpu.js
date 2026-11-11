(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ==========================================================================
   * i486/lib/cpu.js -- I486DX processor core (I486.CPU)
   *
   * Real mode, protected mode (16/32, GDT/IDT/LDT, privilege checks, gates),
   * 4KB and 4MB paging with A/D bits, basic V86, 387 FPU subset behind D8-DF.
   * The bus object is injected: read8/16/32, write8/16/32, io.in8/out8/...
   *
   * Exceptions are raised as #-style faults that vector through the IDT (real
   * mode: the IVT).  Internally a fault is a thrown preallocated object, caught
   * once at the step() boundary; nothing is allocated on the normal path.
   *
   * GAPS (deliberate, per CONTRACT.md section 5 "Task switching"):
   *  - Hardware task switching is NOT implemented.  JMP/CALL to a TSS selector,
   *    task gates in the IDT and IRET with EFLAGS.NT=1 raise #GP(0).  They never
   *    hang; a machine that needs a TSS only uses it for ring-0 stacks (V86).
   *  - FPU registers are held as IEEE doubles, not true 80-bit extended.  Every
   *    double round-trips exactly through FLD m80 / FSTP m80, but an 80-bit
   *    pattern with more than 53 significant mantissa bits loses the low bits.
   *    FPU status/tag words are plausible, not cycle-accurate; numeric FPU
   *    exceptions (precision/underflow) are never signalled and #MF/#NM are not
   *    generated (a 486DX reports the FPU as built in, CR0.EM/TS unused).
   *    FNSTENV/FLDENV only carry the control, status and tag words (the rest of
   *    the 14/28 byte environment is written as zero); FRSTOR/FNSAVE keep the
   *    same reduced model.
   *  - Debug registers are stored by MOV DR but never trap; #DB comes from
   *    single-step (EFLAGS.TF) and from INT1/ICEBP is #UD (0xF1 is undefined).
   *  - No cache model: INVD/WBINVD are accepted no-ops, CLTS just clears TS.
   *  - #BR (BOUND) pushes no error code, matching the 386/486 (P6 pushes 0).
   *  - 486-only opcodes that a 486DX lacks (0F 30 WRMSR, 0F 31 RDTSC, 0F 32
   *    RDMSR, 0F 40-4F CMOVcc, 0F C7 CMPXCHG8B is present, 0F B2/B4/B5 LSS/LFS/
   *    LGS are present) raise #UD where the contract asks for it.
   * ========================================================================== */

  var CF = 0x0001, PF = 0x0004, AF = 0x0010, ZF = 0x0040, SF = 0x0080,
      TF = 0x0100, IF = 0x0200, DF = 0x0400, OF = 0x0800,
      IOPL = 0x3000, NT = 0x4000, RF = 0x10000, VM = 0x20000, AC = 0x40000,
      VIF = 0x80000, VIP = 0x100000, ID = 0x200000;

  var ES = 0, CS = 1, SS = 2, DS = 3, FS = 4, GS = 5;

  var PAR = new Uint8Array(256);
  (function () {
    for (var i = 0; i < 256; i++) {
      var b = i, n = 0;
      while (b) { n += b & 1; b >>= 1; }
      PAR[i] = (n & 1) ? 0 : PF;
    }
  })();

  var REG32 = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
  var REG16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
  var REG8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
  var SEGN = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];
  var FLAGBIT = {
    cf: CF, pf: PF, af: AF, zf: ZF, sf: SF, tf: TF, if: IF, df: DF, of: OF,
    nt: NT, rf: RF, vm: VM, ac: AC, vif: VIF, vip: VIP, id: ID
  };

  function mkseg() {
    return { sel: 0, base: 0, limit: 0xFFFF, big: false, dpl: 0, type: 3, s: 1, p: 1, g: 0, valid: true };
  }

  /* Error code pushed by each fault vector (386/486 behaviour). */
  function hasErrCode(vec) {
    return vec === 8 || vec === 10 || vec === 11 || vec === 12 || vec === 13 || vec === 14 || vec === 17;
  }

  var CPU = function CPU(bus) {
    if (!bus) throw new Error('CPU requires a bus object');
    var i;
    this.bus = bus;
    this.r = new Int32Array(8);
    this.segs = [mkseg(), mkseg(), mkseg(), mkseg(), mkseg(), mkseg()];
    this.gdtr = { base: 0, limit: 0 };
    this.idtr = { base: 0, limit: 0 };
    this.tr = mkseg();
    this.ldtr = mkseg();
    this.dr = new Int32Array(8);
    this.desc = new Uint8Array(8);
    this.faultInfo = { vector: 0, errorCode: 0, hasError: false };
    this.tlbTag = new Int32Array(1024);
    this.tlbBase = new Int32Array(1024);
    this.tlbPerm = new Uint8Array(1024);
    this.tlbPte = new Int32Array(1024);
    this.fv = new Float64Array(8);
    this.ftag = new Uint8Array(8);
    this.inStep = 0;
    this.excDepth = 0;
    this.cycStart = 0;
    for (i = 0; i < 8; i++) this.ftag[i] = 3;
    this.reset();
  };

  /* ---------------------------------------------------------------- state -- */

  CPU.prototype.reset = function () {
    var i;
    for (i = 0; i < 8; i++) { this.r[i] = 0; this.dr[i] = 0; }
    this.r[0] = 0;
    this.r[2] = 0x00000404;              /* EDX: family 4, model 0 */
    this.eip = 0x0000FFF0;
    this.eflags = 0x00000002;
    this.cr0 = 0x60000010;
    this.cr2 = 0; this.cr3 = 0; this.cr4 = 0;
    this.dr[6] = 0xFFFF0FF0;
    this.dr[7] = 0x00000400;
    this.gdtr.base = 0; this.gdtr.limit = 0xFFFF;
    this.idtr.base = 0; this.idtr.limit = 0x03FF;
    var t = mkseg(); t.sel = 0; t.base = 0; t.limit = 0xFFFF; t.type = 2; this.ldtr = t;
    var tr = mkseg(); tr.sel = 0; tr.base = 0; tr.limit = 0xFFFF; tr.type = 3; this.tr = tr;
    for (i = 0; i < 6; i++) {
      var s = this.segs[i];
      s.sel = 0; s.base = 0xFFFF0000; s.limit = 0xFFFF; s.big = false;
      s.dpl = 0; s.type = 3; s.s = 1; s.p = 1; s.g = 0; s.valid = true;
    }
    var cs = this.segs[CS];
    cs.sel = 0xF000; cs.type = 0x0B;
    this.cpl = 0; this.cpl3 = false;
    this.csBase = this.segs[CS].base;
    this.csLimit = this.segs[CS].limit;
    this.csBig = this.segs[CS].big;
    this.paging = false;
    this.acCheck = false;
    this.halted = false;
    this.tripleFault = false;
    this.lastException = null;
    this.cycles = 0;
    this.intShadow = 0;
    this.pendingIRQ = -1;
    this.fpuReset();
    this.flushTLB();
    this.o32 = 0; this.a32 = 0;
    this.p66 = 0; this.p67 = 0; this.segovr = -1; this.rep = 0; this.lock = 0;
    this.mod = 0; this.reg = 0; this.rm = 0; this.isReg = 0;
    this.ea = 0; this.eaSeg = DS;
    this.instrEip = 0;
    return this;
  };

  /* ------------------------------------------------------------- segments -- */

  CPU.prototype.flushTLB = function () {
    var i;
    for (i = 0; i < 1024; i++) this.tlbTag[i] = 0;
  };

  CPU.prototype.refreshCS = function () {
    var cs = this.segs[CS];
    this.csBase = cs.base;
    this.csLimit = cs.limit;
    this.csBig = cs.big;
    this.cpl = cs.sel & 3;
    this.cpl3 = this.cpl === 3;
    this.acCheck = (this.cr0 & 0x00040000) !== 0 && (this.eflags & AC) !== 0 && this.cpl === 3;
  };

  CPU.prototype.refreshFlags = function () {
    this.paging = (this.cr0 & 0x80000000) !== 0;
    this.acCheck = (this.cr0 & 0x00040000) !== 0 && (this.eflags & AC) !== 0 && this.cpl === 3;
  };

  /* Real-mode selector load: base = sel<<4, limit = 0xFFFF. */
  function loadReal(cpu, idx, sel) {
    var s = cpu.segs[idx];
    s.sel = sel & 0xFFFF;
    s.base = (sel & 0xFFFF) << 4;
    s.limit = 0xFFFF;
    s.big = false;
    s.dpl = 0; s.type = idx === CS ? 0x0B : 0x03; s.s = 1; s.p = 1; s.g = 0;
    s.valid = true;
    if (idx === CS) cpu.refreshCS();
  }

  /* Descriptor fetch into cpu.desc; faults with #GP(sel&~3) when out of bounds. */
  function readDescriptor(cpu, base, limit, sel, asLdt) {
    var off = sel & 0xFFF8;
    if (off + 7 > limit) fault(cpu, 13, sel & 0xFFFC);
    var la = (base + off) >>> 0;
    if (cpu.paging) la = xlate(cpu, la, false, false);
    cpu.desc[0] = cpu.bus.read8(la);
    cpu.desc[1] = cpu.bus.read8((la + 1) >>> 0);
    cpu.desc[2] = cpu.bus.read8((la + 2) >>> 0);
    cpu.desc[3] = cpu.bus.read8((la + 3) >>> 0);
    cpu.desc[4] = cpu.bus.read8((la + 4) >>> 0);
    cpu.desc[5] = cpu.bus.read8((la + 5) >>> 0);
    cpu.desc[6] = cpu.bus.read8((la + 6) >>> 0);
    cpu.desc[7] = cpu.bus.read8((la + 7) >>> 0);
    return cpu.desc;
  }

  function descBase(d) {
    return (d[2] | (d[3] << 8) | (d[4] << 16) | (d[7] << 24)) >>> 0;
  }
  function descLimit(d) {
    var l = d[0] | (d[1] << 8) | ((d[6] & 0x0F) << 16);
    if (d[6] & 0x80) l = ((l << 12) | 0xFFF) >>> 0;
    return l >>> 0;
  }

  /* Apply an 8-byte descriptor to a segment object. */
  function applyDesc(s, d) {
    s.base = descBase(d);
    s.limit = descLimit(d);
    s.big = (d[6] & 0x40) !== 0;
    s.g = (d[6] & 0x80) !== 0;
    s.p = (d[5] & 0x80) !== 0;
    s.dpl = (d[5] >> 5) & 3;
    s.s = (d[5] & 0x10) !== 0;
    s.type = d[5] & 0x0F;
    s.valid = true;
  }

  CPU.prototype.setSeg = function (reg, sel) {
    var idx = segIndex(reg);
    if (idx < 0) throw new Error('bad segment ' + reg);
    if (!this.inStep) {
      try {
        return this.setSegInternal(idx, sel);
      } catch (e) {
        if (e === this.faultInfo) throw faultError(e);
        throw e;
      }
    }
    return this.setSegInternal(idx, sel);
  };

  CPU.prototype.setSegInternal = function (idx, sel) {
    sel = sel & 0xFFFF;
    if ((this.cr0 & 1) === 0 || (this.eflags & VM) !== 0) {
      loadReal(this, idx, sel);
      return this.segs[idx];
    }
    this.loadProtected(idx, sel, false);
    return this.segs[idx];
  };

  /* Protected-mode selector load with the checks the 486 performs. */
  CPU.prototype.loadProtected = function (idx, sel, viaGate) {
    var cpl = this.cpl;
    if (sel === 0) {
      if (idx === CS || idx === SS) fault(this, 13, 0);
      var n = this.segs[idx];
      n.sel = 0; n.base = 0; n.limit = 0; n.big = false; n.valid = false;
      n.dpl = 0; n.type = 0; n.s = 1; n.p = 0; n.g = 0;
      return;
    }
    var ti = (sel & 4) !== 0;
    var rpl = sel & 3;
    var d;
    if (ti) d = readDescriptor(this, this.ldtr.base, this.ldtr.limit, sel);
    else d = readDescriptor(this, this.gdtr.base, this.gdtr.limit, sel);
    if ((d[5] & 0x80) === 0) fault(this, 11, sel & 0xFFFC);   /* #NP */
    var type = d[5] & 0x0F;
    var sbit = (d[5] & 0x10) !== 0;
    var dpl = (d[5] >> 5) & 3;
    if (idx === CS) {
      if (!sbit || (type & 0x08) === 0) fault(this, 13, sel & 0xFFFC);
      if (!viaGate) {
        if ((type & 0x04) === 0 && dpl !== cpl) fault(this, 13, sel & 0xFFFC);
        if (rpl !== cpl) fault(this, 13, sel & 0xFFFC);
      }
      var cs = this.segs[CS];
      cs.sel = sel;
      applyDesc(cs, d);
      this.refreshCS();
      return;
    }
    if (idx === SS) {
      if (!sbit || (type & 0x0A) !== 0x02) fault(this, 13, sel & 0xFFFC);
      if (dpl !== cpl || rpl !== cpl) fault(this, 13, sel & 0xFFFC);
      var ss = this.segs[SS];
      ss.sel = sel; applyDesc(ss, d);
      return;
    }
    /* data segments: data or (386+) readable code */
    if (!sbit) fault(this, 13, sel & 0xFFFC);
    if ((type & 0x08) !== 0) {
      if ((type & 0x04) === 0) fault(this, 13, sel & 0xFFFC);   /* execute-only code */
    }
    if (dpl < cpl || dpl < rpl) fault(this, 13, sel & 0xFFFC);
    var ds = this.segs[idx];
    ds.sel = sel; applyDesc(ds, d);
  };

  function segIndex(reg) {
    if (typeof reg === 'number') return (reg >= 0 && reg < 6) ? reg : -1;
    switch (String(reg).toLowerCase()) {
      case 'es': return ES;
      case 'cs': return CS;
      case 'ss': return SS;
      case 'ds': return DS;
      case 'fs': return FS;
      case 'gs': return GS;
    }
    return -1;
  }

  /* --------------------------------------------------------------- faults -- */

  function fault(cpu, vec, err) {
    var f = cpu.faultInfo;
    f.vector = vec;
    f.errorCode = err >>> 0;
    f.hasError = hasErrCode(vec);
    throw f;
  }

  function faultError(f) {
    var e = new Error('#EXC ' + f.vector + ' err=' + f.errorCode);
    e.vector = f.vector;
    e.errorCode = f.errorCode;
    e.isFault = true;
    return e;
  }

  /* ------------------------------------------------------- linear/physical -- */

  function xlate(cpu, la, isWrite, isUser) {
    if (!cpu.paging) return la >>> 0;
    var pdx = la >>> 12;
    var idx = pdx & 0x3FF;
    var tag = cpu.tlbTag[idx];
    var perm, pa;
    if (tag !== 0 && tag === pdx + 1) {
      perm = cpu.tlbPerm[idx];
      if ((isWrite && (perm & 1) === 0) || (isUser && (perm & 2) === 0)) {
        cpu.cr2 = la >>> 0;
        fault(cpu, 14, 1 | (isWrite ? 2 : 0) | (isUser ? 4 : 0));
      }
      if (isWrite && (perm & 4) === 0) {
        var dpa = cpu.tlbPte[idx] >>> 0;
        cpu.bus.write32(dpa, (cpu.bus.read32(dpa) | 0x40) >>> 0);
        cpu.tlbPerm[idx] = perm | 4;
      }
      return (cpu.tlbBase[idx] + (la & 0xFFF)) >>> 0;
    }
    var bus = cpu.bus;
    var pdeAddr = ((cpu.cr3 & 0xFFFFF000) + (la >>> 22) * 4) >>> 0;
    var pde = bus.read32(pdeAddr);
    if ((pde & 1) === 0) {
      cpu.cr2 = la >>> 0;
      fault(cpu, 14, (isWrite ? 2 : 0) | (isUser ? 4 : 0));
    }
    var wp = (cpu.cr0 & 0x00010000) !== 0;
    if ((isWrite && ((pde & 2) === 0) && (isUser || wp)) || (isUser && (pde & 4) === 0)) {
      cpu.cr2 = la >>> 0;
      fault(cpu, 14, 1 | (isWrite ? 2 : 0) | (isUser ? 4 : 0));
    }
    var base;
    var wperm = (pde & 2) ? 1 : 0;
    var uperm = (pde & 4) ? 2 : 0;
    if ((cpu.cr4 & 0x10) !== 0 && (pde & 0x80) !== 0) {
      base = pde & 0xFFC00000;
      if (isWrite && (pde & 0x20) === 0) bus.write32(pdeAddr, pde | 0x20 | 0x20);
      if ((pde & 0x20) === 0) bus.write32(pdeAddr, (pde | 0x20) >>> 0);
      cpu.tlbTag[idx] = pdx + 1;
      cpu.tlbBase[idx] = base;
      cpu.tlbPerm[idx] = wperm | uperm;
      if ((isWrite && (wperm & 1) === 0) || (isUser && (uperm & 2) === 0)) {
        cpu.cr2 = la >>> 0;
        fault(cpu, 14, 1 | (isWrite ? 2 : 0) | (isUser ? 4 : 0));
      }
      return (base + (la & 0x3FFFFF)) >>> 0;
    }
    var pteAddr = ((pde & 0xFFFFF000) + ((la >>> 12) & 0x3FF) * 4) >>> 0;
    var pte = bus.read32(pteAddr);
    if ((pte & 1) === 0) {
      cpu.cr2 = la >>> 0;
      fault(cpu, 14, (isWrite ? 2 : 0) | (isUser ? 4 : 0));
    }
    if ((isWrite && ((pte & 2) === 0) && (isUser || wp)) || (isUser && (pte & 4) === 0)) {
      cpu.cr2 = la >>> 0;
      fault(cpu, 14, 1 | (isWrite ? 2 : 0) | (isUser ? 4 : 0));
    }
    if ((pte & 0x20) === 0 || (pde & 0x20) === 0) {
      bus.write32(pdeAddr, (pde | 0x20) >>> 0);
      bus.write32(pteAddr, (pte | 0x20 | (isWrite ? 0x40 : 0)) >>> 0);
    } else if (isWrite && (pte & 0x40) === 0) {
      bus.write32(pteAddr, (pte | 0x40) >>> 0);
    }
    base = pte & 0xFFFFF000;
    cpu.tlbPerm[idx] = wperm | uperm | ((isWrite || (pte & 0x40)) ? 4 : 0);
    cpu.tlbPte[idx] = pteAddr;
    cpu.tlbBase[idx] = base;
    cpu.tlbTag[idx] = pdx + 1;
    return (base + (la & 0xFFF)) >>> 0;
  }

  CPU.prototype.translate = function (la, isWrite, isUser) {
    la = la >>> 0;
    if (this.inStep) return xlate(this, la, !!isWrite, !!isUser);
    try {
      return xlate(this, la, !!isWrite, !!isUser);
    } catch (e) {
      if (e === this.faultInfo) throw faultError(e);
      throw e;
    }
  };

  /* --------------------------------------------------------------- memory -- */

  function segRead(cpu, idx, off, sz) {
    var s = cpu.segs[idx];
    if (off + sz - 1 > s.limit) fault(cpu, idx === SS ? 12 : 13, 0);
    var la = (s.base + off) >>> 0;
    if (cpu.acCheck && (la & (sz - 1)) !== 0) fault(cpu, 17, 0);
    if (cpu.paging) la = xlate(cpu, la, false, cpu.cpl3);
    var b = cpu.bus;
    if (sz === 1) return b.read8(la);
    if (sz === 2) return b.read16(la);
    return b.read32(la);
  }

  function segWrite(cpu, idx, off, sz, v) {
    var s = cpu.segs[idx];
    if (off + sz - 1 > s.limit) fault(cpu, idx === SS ? 12 : 13, 0);
    var la = (s.base + off) >>> 0;
    if (cpu.acCheck && (la & (sz - 1)) !== 0) fault(cpu, 17, 0);
    if (cpu.paging) la = xlate(cpu, la, true, cpu.cpl3);
    var b = cpu.bus;
    if (sz === 1) b.write8(la, v & 0xFF);
    else if (sz === 2) b.write16(la, v & 0xFFFF);
    else b.write32(la, v >>> 0);
  }

  function linRead(cpu, la, sz) {
    if (cpu.paging) la = xlate(cpu, la, false, false);
    var b = cpu.bus;
    if (sz === 1) return b.read8(la);
    if (sz === 2) return b.read16(la);
    return b.read32(la);
  }

  function linWrite(cpu, la, sz, v) {
    if (cpu.paging) la = xlate(cpu, la, true, false);
    var b = cpu.bus;
    if (sz === 1) b.write8(la, v & 0xFF);
    else if (sz === 2) b.write16(la, v & 0xFFFF);
    else b.write32(la, v >>> 0);
  }

  CPU.prototype.readMem8 = function (la, segReg) { return this.readMemN(la, 1, segReg); };
  CPU.prototype.readMem16 = function (la, segReg) { return this.readMemN(la, 2, segReg); };
  CPU.prototype.readMem32 = function (la, segReg) { return this.readMemN(la, 4, segReg); };
  CPU.prototype.writeMem8 = function (la, segReg, v) { this.writeMemN(la, 1, segReg, v); };
  CPU.prototype.writeMem16 = function (la, segReg, v) { this.writeMemN(la, 2, segReg, v); };
  CPU.prototype.writeMem32 = function (la, segReg, v) { this.writeMemN(la, 4, segReg, v); };

  CPU.prototype.readMemN = function (la, sz, segReg) {
    var self = this;
    var idx = segReg == null ? -1 : segIndex(segReg);
    var run = function () {
      la = la >>> 0;
      if (idx >= 0) {
        var s = self.segs[idx];
        if (la < s.base || la - s.base + sz - 1 > s.limit) {
          if (self.inStep) fault(self, idx === SS ? 12 : 13, 0);
          var e = new Error('#EXC ' + (idx === SS ? 12 : 13)); e.vector = idx === SS ? 12 : 13; e.errorCode = 0; throw e;
        }
      }
      return linRead(self, la, sz);
    };
    if (this.inStep) return run();
    try { return run(); }
    catch (e) {
      if (e === this.faultInfo) throw faultError(e);
      throw e;
    }
  };

  CPU.prototype.writeMemN = function (la, sz, segReg, v) {
    var self = this;
    var idx = segReg == null ? -1 : segIndex(segReg);
    var run = function () {
      la = la >>> 0;
      if (idx >= 0) {
        var s = self.segs[idx];
        if (la < s.base || la - s.base + sz - 1 > s.limit) {
          if (self.inStep) fault(self, idx === SS ? 12 : 13, 0);
          var e = new Error('#EXC ' + (idx === SS ? 12 : 13)); e.vector = idx === SS ? 12 : 13; e.errorCode = 0; throw e;
        }
      }
      linWrite(self, la, sz, v);
    };
    if (this.inStep) return run();
    try { return run(); }
    catch (e) {
      if (e === this.faultInfo) throw faultError(e);
      throw e;
    }
  };

  /* --------------------------------------------------------------- stack -- */

  function stackWrite(cpu, off, sz, v) {
    var ss = cpu.segs[SS];
    if (off + sz - 1 > ss.limit) fault(cpu, 12, 0);
    var la = (ss.base + off) >>> 0;
    if (cpu.paging) la = xlate(cpu, la, true, cpu.cpl3);
    var b = cpu.bus;
    if (sz === 2) b.write16(la, v & 0xFFFF);
    else b.write32(la, v >>> 0);
  }

  function stackRead(cpu, off, sz) {
    var ss = cpu.segs[SS];
    if (off + sz - 1 > ss.limit) fault(cpu, 12, 0);
    var la = (ss.base + off) >>> 0;
    if (cpu.paging) la = xlate(cpu, la, false, cpu.cpl3);
    var b = cpu.bus;
    return sz === 2 ? b.read16(la) : b.read32(la);
  }

  function pushN(cpu, sz, v) {
    if (sz === 2) {
      var sp = (cpu.r[4] - 2) & 0xFFFF;
      cpu.r[4] = (cpu.r[4] & 0xFFFF0000) | sp;
      stackWrite(cpu, sp, 2, v);
    } else {
      var esp = (cpu.r[4] - 4) >>> 0;
      cpu.r[4] = esp | 0;
      stackWrite(cpu, esp, 4, v);
    }
  }

  function popN(cpu, sz) {
    var v;
    if (sz === 2) {
      var sp = cpu.r[4] & 0xFFFF;
      v = stackRead(cpu, sp, 2);
      cpu.r[4] = (cpu.r[4] & 0xFFFF0000) | ((sp + 2) & 0xFFFF);
    } else {
      var esp = cpu.r[4] >>> 0;
      v = stackRead(cpu, esp, 4);
      cpu.r[4] = (esp + 4) | 0;
    }
    return v;
  }

  /* ------------------------------------------------------------- delivery -- */

  CPU.prototype.deliverFault = function (vec, err, hasErr) {
    this.eip = this.instrEip >>> 0;
    this.lastException = { vector: vec, errorCode: err >>> 0, eip: this.instrEip >>> 0 };
    this.deliverException(vec, err, hasErr);
  };

  CPU.prototype.deliverException = function (vec, err, hasErr) {
    if (this.excDepth > 0) {
      if (vec === 8) { this.tripleFault = true; this.halted = true; this.excDepth = 0; return; }
      vec = 8; err = 0; hasErr = true;
    }
    this.excDepth = 1;
    try {
      this.deliver(vec, err, hasErr, false);
    } catch (e) {
      this.excDepth = 0;
      if (e !== this.faultInfo) throw e;
      if (vec === 8) { this.tripleFault = true; this.halted = true; return; }
      this.excDepth = 1;
      try {
        this.deliver(8, 0, true, false);
      } catch (e2) {
        this.excDepth = 0;
        if (e2 !== this.faultInfo) throw e2;
        this.tripleFault = true;
        this.halted = true;
        return;
      }
      this.excDepth = 0;
      return;
    }
    this.excDepth = 0;
  };

  CPU.prototype.deliver = function (vec, err, hasErr, isSoft) {
    if ((this.cr0 & 1) === 0) {
      var vb = (vec * 4) >>> 0;
      var nip = linRead(this, vb, 2);
      var ncs = linRead(this, (vb + 2) >>> 0, 2);
      pushN(this, 2, this.eflags & 0xFFFF);
      pushN(this, 2, this.segs[CS].sel);
      pushN(this, 2, this.eip & 0xFFFF);
      this.eflags &= ~(IF | TF | RF | NT);
      this.eip = nip & 0xFFFF;
      loadReal(this, CS, ncs);
      this.cpl = 0; this.cpl3 = false;
      this.refreshFlags();
      return;
    }
    /* protected mode / V86 : IDT gate */
    var off = (vec * 8) >>> 0;
    if (off + 7 > this.idtr.limit) fault(this, 13, off + 2);
    var d = readDescriptor(this, this.idtr.base, 0xFFFFFFFF, off & ~7, false);
    var p = (d[5] & 0x80) !== 0;
    var dpl = (d[5] >> 5) & 3;
    var type = d[5] & 0x1F;
    if (!p) fault(this, 11, off + 2);
    if (type === 5) fault(this, 13, off + 2);          /* task gate: GAP */
    if (type !== 6 && type !== 7 && type !== 0x0E && type !== 0x0F) fault(this, 13, off + 2);
    if (isSoft && dpl < this.cpl) fault(this, 13, off + 2);
    var sel = d[2] | (d[3] << 8);
    var target = (d[0] | (d[1] << 8) | ((d[6] | (d[7] << 8)) << 16)) >>> 0;
    if ((sel & 0xFFFC) === 0) fault(this, 13, 0);
    var g;
    if (sel & 4) g = readDescriptor(this, this.ldtr.base, this.ldtr.limit, sel);
    else g = readDescriptor(this, this.gdtr.base, this.gdtr.limit, sel);
    if ((g[5] & 0x80) === 0) fault(this, 11, sel & 0xFFFC);
    if ((g[5] & 0x18) !== 0x18) fault(this, 13, sel & 0xFFFC);
    var cdpl = (g[5] >> 5) & 3;
    var codeType = g[5] & 0x0F;
    var newCpl;
    if ((codeType & 0x04) !== 0) {
      if (cdpl > this.cpl) fault(this, 13, sel & 0xFFFC);
      newCpl = this.cpl;
    } else {
      if (cdpl > this.cpl) fault(this, 13, sel & 0xFFFC);
      newCpl = cdpl;
    }
    var gate32 = type === 0x0E || type === 0x0F;
    var v86 = (this.eflags & VM) !== 0;
    var oldCpl = this.cpl;
    var oldSS = this.segs[SS].sel;
    var oldESP = this.r[4] >>> 0;
    var pushSz = gate32 ? 4 : 2;
    if (newCpl < oldCpl) {
      this.stackSwitch(newCpl);
    }
    if (v86 && newCpl === 0) {
      pushN(this, pushSz, this.segs[GS].sel);
      pushN(this, pushSz, this.segs[FS].sel);
      pushN(this, pushSz, this.segs[DS].sel);
      pushN(this, pushSz, this.segs[ES].sel);
    }
    if (newCpl < oldCpl) {
      pushN(this, pushSz, oldSS);
      pushN(this, pushSz, oldESP);
    }
    pushN(this, pushSz, this.eflags);
    pushN(this, pushSz, this.segs[CS].sel);
    pushN(this, pushSz, this.eip >>> 0);
    if (hasErr) pushN(this, pushSz, err >>> 0);
    var cs = this.segs[CS];
    cs.sel = sel; applyDesc(cs, g);
    this.refreshCS();
    if (gate32) this.eip = target;
    else this.eip = target & 0xFFFF;
    this.eflags &= ~(TF | NT | RF | VM);
    if (type === 6 || type === 0x0E) this.eflags &= ~IF;
    this.refreshFlags();
  };

  CPU.prototype.stackSwitch = function (newCpl) {
    var tss = this.tr;
    if (tss.sel === 0) fault(this, 10, 0);
    var savedCpl = this.cpl;
    this.cpl = newCpl;
    this.cpl3 = newCpl === 3;
    try {
      if ((tss.type & 0x09) === 0x09) {
        var esp = linRead(this, (tss.base + 4) >>> 0, 4) >>> 0;
        var ssSel = linRead(this, (tss.base + 8) >>> 0, 2);
        this.loadProtected(SS, ssSel, false);
        this.r[4] = esp | 0;
      } else {
        var sp = linRead(this, (tss.base + 2) >>> 0, 2);
        var ssSel2 = linRead(this, (tss.base + 4) >>> 0, 2);
        this.loadProtected(SS, ssSel2, false);
        this.r[4] = (this.r[4] & 0xFFFF0000) | (sp & 0xFFFF);
      }
    } catch (e) {
      this.cpl = savedCpl;
      this.cpl3 = savedCpl === 3;
      throw e;
    }
  };

  CPU.prototype.canInterrupt = function () {
    return (this.eflags & IF) !== 0 && this.intShadow === 0 && !this.halted;
  };

  CPU.prototype.serviceInterrupt = function (vec) {
    if (this.tripleFault) return false;
    if ((this.eflags & IF) === 0 || this.intShadow !== 0) return false;
    this.halted = false;
    this.inStep = 1;
    this.instrEip = this.eip >>> 0;
    try {
      this.deliverException(vec & 0xFF, 0, false);
    } catch (e) {
      this.inStep = 0;
      throw e;
    }
    this.inStep = 0;
    return true;
  };

  CPU.prototype.serviceNMI = function () {
    this.halted = false;
    this.inStep = 1;
    this.instrEip = this.eip >>> 0;
    try {
      this.deliverException(2, 0, false);
    } catch (e) {
      this.inStep = 0;
      throw e;
    }
    this.inStep = 0;
    return true;
  };

  CPU.prototype.servicePendingInterrupt = function () {
    if (this.pendingIRQ < 0) return false;
    var v = this.pendingIRQ;
    if (!this.serviceInterrupt(v)) return false;
    this.pendingIRQ = -1;
    return true;
  };

  /* ------------------------------------------------------------- fetching -- */

  CPU.prototype.fetch8 = function () {
    if (this.eip > this.csLimit) fault(this, 13, 0);
    var la = (this.csBase + this.eip) >>> 0;
    this.eip = (this.eip + 1) >>> 0;
    if (this.paging) la = xlate(this, la, false, this.cpl3);
    return this.bus.read8(la);
  };

  CPU.prototype.fetch16 = function () {
    if (this.eip + 1 > this.csLimit) fault(this, 13, 0);
    var la = (this.csBase + this.eip) >>> 0;
    this.eip = (this.eip + 2) >>> 0;
    if (this.paging) {
      var a = xlate(this, la, false, this.cpl3);
      var b = xlate(this, (la + 1) >>> 0, false, this.cpl3);
      return this.bus.read8(a) | (this.bus.read8(b) << 8);
    }
    return this.bus.read16(la);
  };

  CPU.prototype.fetch32 = function () {
    if (this.eip + 3 > this.csLimit) fault(this, 13, 0);
    var la = (this.csBase + this.eip) >>> 0;
    this.eip = (this.eip + 4) >>> 0;
    if (this.paging) {
      var v = 0, i;
      for (i = 3; i >= 0; i--) v = (v << 8) | this.bus.read8(xlate(this, (la + i) >>> 0, false, this.cpl3));
      return v >>> 0;
    }
    return this.bus.read32(la) >>> 0;
  };

  /* Immediate operand of the current operand size. */
  CPU.prototype.fetchImm = function () {
    return this.o32 ? this.fetch32() : this.fetch16();
  };

  /* --------------------------------------------------------------- decode -- */

  /*
   * ModR/M + optional SIB + displacement.  Fills:
   *   mod, reg, rm, isReg, ea (offset within the selected segment), eaSeg.
   * 16-bit forms wrap their effective address at 64K; 32-bit forms do not.
   * The default segment is SS for BP/EBP/SP/ESP based addresses, else DS.
   */
  CPU.prototype.modrm = function () {
    var m = this.fetch8();
    var mod = m >> 6, reg = (m >> 3) & 7, rm = m & 7;
    this.mod = mod; this.reg = reg; this.rm = rm;
    if (mod === 3) {
      this.isReg = 1;
      this.ea = 0;
      this.eaSeg = this.segovr >= 0 ? this.segovr : DS;
      return;
    }
    this.isReg = 0;
    var dflt = DS, ea = 0, disp = 0, i, sib, base, index, scale;
    if (this.a32) {
      if (rm === 4) {
        sib = this.fetch8();
        scale = sib >> 6;
        index = (sib >> 3) & 7;
        base = sib & 7;
        if (base === 5 && mod === 0) {
          ea = this.fetch32();
        } else {
          ea = this.r[base] >>> 0;
          if (base === 5 || base === 4) dflt = SS;
          if (index !== 4) ea = (ea + (this.r[index] >>> 0) * (1 << scale)) >>> 0;
          if (mod === 1) ea = (ea + (this.fetch8() << 24 >> 24)) >>> 0;
          else if (mod === 2) ea = (ea + this.fetch32()) >>> 0;
          this.ea = ea >>> 0;
          this.eaSeg = this.segovr >= 0 ? this.segovr : dflt;
          return;
        }
        if (index !== 4) ea = (ea + (this.r[index] >>> 0) * (1 << scale)) >>> 0;
        this.ea = ea >>> 0;
        this.eaSeg = this.segovr >= 0 ? this.segovr : dflt;
        return;
      }
      if (rm === 5 && mod === 0) {
        ea = this.fetch32();
      } else {
        ea = this.r[rm] >>> 0;
        if (rm === 5) dflt = SS;
        if (mod === 1) ea = (ea + (this.fetch8() << 24 >> 24)) >>> 0;
        else if (mod === 2) ea = (ea + this.fetch32()) >>> 0;
      }
      this.ea = ea >>> 0;
      this.eaSeg = this.segovr >= 0 ? this.segovr : dflt;
      return;
    }
    /* 16-bit addressing */
    var bx = this.r[3] & 0xFFFF, bp = this.r[5] & 0xFFFF;
    var si = this.r[6] & 0xFFFF, di = this.r[7] & 0xFFFF;
    switch (rm) {
      case 0: ea = bx + si; break;
      case 1: ea = bx + di; break;
      case 2: ea = bp + si; dflt = SS; break;
      case 3: ea = bp + di; dflt = SS; break;
      case 4: ea = si; break;
      case 5: ea = di; break;
      case 6:
        if (mod === 0) { ea = this.fetch16(); }
        else { ea = bp; dflt = SS; }
        break;
      default: ea = bx; break;
    }
    if (mod === 1) ea += (this.fetch8() << 24 >> 24);
    else if (mod === 2) ea += this.fetch16();
    this.ea = ea & 0xFFFF;
    this.eaSeg = this.segovr >= 0 ? this.segovr : dflt;
  };

  /* ------------------------------------------------------------- operands -- */

  function rdReg(cpu, i, sz) {
    if (sz === 4) return cpu.r[i];
    if (sz === 2) return cpu.r[i] & 0xFFFF;
    return i < 4 ? (cpu.r[i] & 0xFF) : ((cpu.r[i - 4] >> 8) & 0xFF);
  }

  function wrReg(cpu, i, v, sz) {
    if (sz === 4) { cpu.r[i] = v | 0; return; }
    if (sz === 2) { cpu.r[i] = (cpu.r[i] & ~0xFFFF) | (v & 0xFFFF); return; }
    if (i < 4) cpu.r[i] = (cpu.r[i] & ~0xFF) | (v & 0xFF);
    else cpu.r[i - 4] = (cpu.r[i - 4] & ~0xFF00) | ((v & 0xFF) << 8);
  }

  function imem(cpu, sz) {
    var idx = cpu.eaSeg;
    return segRead(cpu, idx, cpu.ea, sz);
  }

  function rmRead(cpu, sz) {
    return cpu.isReg ? rdReg(cpu, cpu.rm, sz) : imem(cpu, sz);
  }

  function rmWrite(cpu, sz, v) {
    if (cpu.isReg) wrReg(cpu, cpu.rm, v, sz);
    else segWrite(cpu, cpu.eaSeg, cpu.ea, sz, v);
  }

  /* --------------------------------------------------------------- flags -- */

  var M8 = 0xFF, M16 = 0xFFFF, M32 = 0xFFFFFFFF;

  function addF(cpu, a, b, c, sz) {
    var r, res, f = cpu.eflags & ~(CF | PF | AF | ZF | SF | OF);
    if (sz === 4) {
      r = (a >>> 0) + (b >>> 0) + c;
      res = r >>> 0;
      if (r > 0xFFFFFFFF) f |= CF;
      if (((a ^ res) & (b ^ res) & 0x80000000) !== 0) f |= OF;
      if (((a ^ b ^ res) & 0x10) !== 0) f |= AF;
      if (res === 0) f |= ZF;
      if (res & 0x80000000) f |= SF;
      cpu.eflags = f | PAR[res & 0xFF];
      return res | 0;
    }
    var m = sz === 1 ? M8 : M16, sbit = sz === 1 ? 0x80 : 0x8000;
    a &= m; b &= m;
    r = a + b + c;
    res = r & m;
    if (r > m) f |= CF;
    if (((a ^ res) & (b ^ res) & sbit) !== 0) f |= OF;
    if (((a ^ b ^ res) & 0x10) !== 0) f |= AF;
    if (res === 0) f |= ZF;
    if (res & sbit) f |= SF;
    cpu.eflags = f | PAR[res & 0xFF];
    return res;
  }

  function subF(cpu, a, b, c, sz) {
    var r, res, f = cpu.eflags & ~(CF | PF | AF | ZF | SF | OF);
    if (sz === 4) {
      r = (a >>> 0) - (b >>> 0) - c;
      res = r >>> 0;
      if (r < 0) f |= CF;
      if (((a ^ b) & (a ^ res) & 0x80000000) !== 0) f |= OF;
      if (((a ^ b ^ res) & 0x10) !== 0) f |= AF;
      if (res === 0) f |= ZF;
      if (res & 0x80000000) f |= SF;
      cpu.eflags = f | PAR[res & 0xFF];
      return res | 0;
    }
    var m = sz === 1 ? M8 : M16, sbit = sz === 1 ? 0x80 : 0x8000;
    a &= m; b &= m;
    r = a - b - c;
    res = r & m;
    if (r < 0) f |= CF;
    if (((a ^ b) & (a ^ res) & sbit) !== 0) f |= OF;
    if (((a ^ b ^ res) & 0x10) !== 0) f |= AF;
    if (res === 0) f |= ZF;
    if (res & sbit) f |= SF;
    cpu.eflags = f | PAR[res & 0xFF];
    return res;
  }

  function logicF(cpu, res, sz) {
    var f = cpu.eflags & ~(CF | PF | AF | ZF | SF | OF);
    if (sz === 4) {
      res = res | 0;
      if (res === 0) f |= ZF;
      if (res & 0x80000000) f |= SF;
    } else {
      res &= sz === 1 ? M8 : M16;
      if (res === 0) f |= ZF;
      if (res & (sz === 1 ? 0x80 : 0x8000)) f |= SF;
    }
    cpu.eflags = f | PAR[res & 0xFF];
    return res;
  }

  /* op: 0 add, 1 or, 2 adc, 3 sbb, 4 and, 5 sub, 6 xor, 7 cmp */
  function aluOp(cpu, op, a, b, sz) {
    switch (op) {
      case 0: return addF(cpu, a, b, 0, sz);
      case 2: return addF(cpu, a, b, (cpu.eflags & CF) ? 1 : 0, sz);
      case 5: return subF(cpu, a, b, 0, sz);
      case 3: return subF(cpu, a, b, (cpu.eflags & CF) ? 1 : 0, sz);
      case 7: subF(cpu, a, b, 0, sz); return a;
      case 1: return logicF(cpu, a | b, sz);
      case 4: return logicF(cpu, a & b, sz);
      default: return logicF(cpu, a ^ b, sz);
    }
  }

  function incF(cpu, v, sz) {
    var cf = cpu.eflags & CF;
    var res = addF(cpu, v, 1, 0, sz);
    cpu.eflags = (cpu.eflags & ~CF) | cf;
    return res;
  }

  function decF(cpu, v, sz) {
    var cf = cpu.eflags & CF;
    var res = subF(cpu, v, 1, 0, sz);
    cpu.eflags = (cpu.eflags & ~CF) | cf;
    return res;
  }

  function negF(cpu, v, sz) {
    return subF(cpu, 0, v, 0, sz);
  }

  function widthOf(sz) { return sz === 1 ? 8 : sz === 2 ? 16 : 32; }
  function maskOf(sz) { return sz === 1 ? M8 : sz === 2 ? M16 : M32; }
  function sbitOf(sz) { return sz === 1 ? 0x80 : sz === 2 ? 0x8000 : 0x80000000; }

  function setZS(cpu, res, sz) {
    var f = cpu.eflags & ~(ZF | SF);
    if (sz === 4) {
      if (res === 0) f |= ZF;
      if (res & 0x80000000) f |= SF;
    } else {
      res &= sz === 1 ? M8 : M16;
      if (res === 0) f |= ZF;
      if (res & (sz === 1 ? 0x80 : 0x8000)) f |= SF;
    }
    cpu.eflags = f;
    return res;
  }

  function shlF(cpu, v, cnt, sz) {
    cnt &= 0x1F;
    var w = widthOf(sz), m = maskOf(sz);
    if (cnt === 0) return sz === 4 ? (v | 0) : (v & m);
    var f = cpu.eflags & ~(CF | OF | PF | ZF | SF);
    var res, cf, of = 0;
    if (sz === 4) {
      var u = v >>> 0;
      cf = (u >>> (32 - cnt)) & 1;
      res = (u << cnt) >>> 0;
      if (((res >>> 31) ^ cf) !== 0) of = OF;
    } else {
      var u2 = v & m;
      if (cnt > w) { res = 0; cf = 0; }
      else if (cnt === w) { res = 0; cf = u2 & 1; }
      else { cf = (u2 >>> (w - cnt)) & 1; res = (u2 << cnt) & m; }
      if (((res & sbitOf(sz)) !== 0) !== (cf !== 0)) of = OF;
    }
    if (res === 0) f |= ZF;
    if (sz === 4) { if (res & 0x80000000) f |= SF; }
    else if (res & sbitOf(sz)) f |= SF;
    cpu.eflags = f | of | cf | PAR[res & 0xFF];
    return sz === 4 ? res | 0 : res;
  }

  function shrF(cpu, v, cnt, sz) {
    cnt &= 0x1F;
    var w = widthOf(sz), m = maskOf(sz);
    if (cnt === 0) return sz === 4 ? (v | 0) : (v & m);
    var f = cpu.eflags & ~(CF | OF | PF | ZF | SF);
    var res, cf;
    if (sz === 4) {
      var u = v >>> 0;
      cf = (u >>> (cnt - 1)) & 1;
      res = (u >>> cnt) >>> 0;
      if (cnt === 1 && (u & 0x80000000)) f |= OF;
    } else {
      var u2 = v & m;
      if (cnt > w) { res = 0; cf = 0; }
      else { cf = (u2 >>> (cnt - 1)) & 1; res = u2 >>> cnt; }
      if (cnt === 1 && (u2 & sbitOf(sz))) f |= OF;
    }
    if (res === 0) f |= ZF;
    if (sz === 4) { if (res & 0x80000000) f |= SF; }
    else if (res & sbitOf(sz)) f |= SF;
    cpu.eflags = f | cf | PAR[res & 0xFF];
    return sz === 4 ? res | 0 : res;
  }

  function sarF(cpu, v, cnt, sz) {
    cnt &= 0x1F;
    var w = widthOf(sz), m = maskOf(sz);
    if (cnt === 0) return sz === 4 ? (v | 0) : (v & m);
    var f = cpu.eflags & ~(CF | OF | PF | ZF | SF);
    var res, cf;
    if (sz === 4) {
      var s = v | 0;
      if (cnt > 31) { res = s < 0 ? -1 : 0; cf = s & 1; }
      else { cf = (s >> (cnt - 1)) & 1; res = (s >> cnt) | 0; }
    } else {
      var s2 = (v & m);
      if (s2 & sbitOf(sz)) s2 -= (m + 1);
      if (cnt >= w) { res = s2 < 0 ? m : 0; cf = s2 & 1; }
      else { cf = (s2 >> (cnt - 1)) & 1; res = (s2 >> cnt) & m; }
    }
    if (res === 0) f |= ZF;
    if (sz === 4) { if (res & 0x80000000) f |= SF; }
    else if ((res & m) & sbitOf(sz)) f |= SF;
    cpu.eflags = f | cf | PAR[res & 0xFF];
    return sz === 4 ? res | 0 : (res & m);
  }

  function rolF(cpu, v, cnt, sz) {
    var w = widthOf(sz), m = maskOf(sz);
    var c = cnt & 0x1F;
    if (c === 0) return sz === 4 ? (v | 0) : (v & m);
    var u = (v & m) >>> 0;
    var cw = c % w;
    var f = cpu.eflags & ~(CF | OF);
    var res;
    if (cw === 0) {
      res = u;
      if (u & 1) f |= CF;
    } else {
      res = (((u << cw) >>> 0) | (u >>> (w - cw))) & m;
      if (((u >>> (w - cw)) & 1) !== 0) f |= CF;
    }
    if (c === 1 && ((((res >>> (w - 1)) & 1) ^ ((f & CF) ? 1 : 0)) !== 0)) f |= OF;
    cpu.eflags = f;
    return sz === 4 ? res | 0 : res;
  }

  function rorF(cpu, v, cnt, sz) {
    var w = widthOf(sz), m = maskOf(sz);
    var c = cnt & 0x1F;
    if (c === 0) return sz === 4 ? (v | 0) : (v & m);
    var u = (v & m) >>> 0;
    var cw = c % w;
    var f = cpu.eflags & ~(CF | OF);
    var res;
    if (cw === 0) {
      res = u;
      if ((u >>> (w - 1)) & 1) f |= CF;
    } else {
      res = (((u >>> cw) | ((u << (w - cw)) >>> 0)) & m) >>> 0;
      if (((u >>> (cw - 1)) & 1) !== 0) f |= CF;
    }
    if (c === 1 && ((((res >>> (w - 1)) ^ (res >>> (w - 2))) & 1) !== 0)) f |= OF;
    cpu.eflags = f;
    return sz === 4 ? res | 0 : res;
  }

  function rclF(cpu, v, cnt, sz) {
    var w = widthOf(sz), m = maskOf(sz);
    var c = cnt & 0x1F;
    if (c === 0) return sz === 4 ? (v | 0) : (v & m);
    var out = (cpu.eflags & CF) ? 1 : 0;
    var res = (v & m) >>> 0;
    for (var i = 0; i < c; i++) {
      var msb = (res >>> (w - 1)) & 1;
      res = (((res << 1) >>> 0) | out) & m;
      out = msb;
    }
    var f = cpu.eflags & ~(CF | OF);
    if (out) f |= CF;
    if (c === 1 && (((((res >>> (w - 1)) & 1) ^ out) !== 0))) f |= OF;
    cpu.eflags = f;
    return sz === 4 ? res | 0 : res;
  }

  function rcrF(cpu, v, cnt, sz) {
    var w = widthOf(sz), m = maskOf(sz);
    var c = cnt & 0x1F;
    if (c === 0) return sz === 4 ? (v | 0) : (v & m);
    var out = (cpu.eflags & CF) ? 1 : 0;
    var res = (v & m) >>> 0;
    for (var i = 0; i < c; i++) {
      var lsb = res & 1;
      res = (((res >>> 1) | (out << (w - 1))) >>> 0) & m;
      out = lsb;
    }
    var f = cpu.eflags & ~(CF | OF);
    if (out) f |= CF;
    if (c === 1 && (((((res >>> (w - 1)) ^ (res >>> (w - 2))) & 1) !== 0))) f |= OF;
    cpu.eflags = f;
    return sz === 4 ? res | 0 : res;
  }

  /* --------------------------------------------------------------- step -- */

  CPU.prototype.step = function () {
    if (this.halted || this.tripleFault) { this.cycles += 1; return 1; }
    if (this.intShadow) this.intShadow--;
    this.instrEip = this.eip >>> 0;
    this.p66 = 0; this.p67 = 0; this.segovr = -1; this.rep = 0; this.lock = 0;
    this.cycStart = this.cycles;
    this.inStep = 1;
    var ok = 0;
    try {
      this.exec();
      ok = 1;
    } catch (e) {
      if (e !== this.faultInfo) { this.inStep = 0; throw e; }
      this.deliverFault(e.vector, e.errorCode, e.hasError);
    }
    if (ok && (this.eflags & TF) !== 0 && !this.tripleFault) {
      try {
        this.deliverException(1, 0, false);
      } catch (e2) {
        if (e2 !== this.faultInfo) { this.inStep = 0; throw e2; }
        this.tripleFault = true;
        this.halted = true;
      }
    }
    this.inStep = 0;
    var d = this.cycles - this.cycStart;
    if (d < 1) { this.cycles = this.cycStart + 1; d = 1; }
    return d;
  };

  CPU.prototype.run = function (n) {
    var done = 0;
    while (done < n) {
      if (this.halted || this.tripleFault) break;
      this.step();
      done++;
    }
    return done;
  };

  CPU.prototype.exec = function () {
    var op = this.fetch8();
    for (;;) {
      if (op === 0x66) this.p66 = 1;
      else if (op === 0x67) this.p67 = 1;
      else if (op === 0x2E) this.segovr = CS;
      else if (op === 0x36) this.segovr = SS;
      else if (op === 0x3E) this.segovr = DS;
      else if (op === 0x26) this.segovr = ES;
      else if (op === 0x64) this.segovr = FS;
      else if (op === 0x65) this.segovr = GS;
      else if (op === 0xF3) this.rep = 1;
      else if (op === 0xF2) this.rep = 2;
      else if (op === 0xF0) this.lock = 1;
      else break;
      op = this.fetch8();
    }
    this.o32 = (this.csBig ? 1 : 0) ^ this.p66;
    this.a32 = (this.csBig ? 1 : 0) ^ this.p67;
    this.dispatch(op);
  };

  /* Signed value of a sz-sized operand. */
  function sval(v, sz) {
    if (sz === 1) return (v << 24) >> 24;
    if (sz === 2) return (v << 16) >> 16;
    return v | 0;
  }

  function cond(cpu, cc) {
    var f = cpu.eflags;
    switch (cc) {
      case 0x0: return (f & OF) !== 0;
      case 0x1: return (f & OF) === 0;
      case 0x2: return (f & CF) !== 0;
      case 0x3: return (f & CF) === 0;
      case 0x4: return (f & ZF) !== 0;
      case 0x5: return (f & ZF) === 0;
      case 0x6: return (f & CF) !== 0 || (f & ZF) !== 0;
      case 0x7: return (f & CF) === 0 && (f & ZF) === 0;
      case 0x8: return (f & SF) !== 0;
      case 0x9: return (f & SF) === 0;
      case 0xA: return (f & PF) !== 0;
      case 0xB: return (f & PF) === 0;
      case 0xC: return ((f & SF) !== 0) !== ((f & OF) !== 0);
      case 0xD: return ((f & SF) !== 0) === ((f & OF) !== 0);
      case 0xE: return (f & ZF) !== 0 || (((f & SF) !== 0) !== ((f & OF) !== 0));
      default: return (f & ZF) === 0 && (((f & SF) !== 0) === ((f & OF) !== 0));
    }
  }

  /* ------------------------------------------------------ multi-precision -- */

  function mulu32(a, b) {
    var al = a & 0xFFFF, ah = a >>> 16, bl = b & 0xFFFF, bh = b >>> 16;
    var lo = al * bl;
    var mid = ah * bl + al * bh;
    var hi = ah * bh;
    var midLow = mid % 4294967296;
    var midHigh = (mid - midLow) / 4294967296;
    var acc = midLow * 65536 + lo;
    var l32 = acc % 4294967296;
    var h32 = (hi + midHigh * 65536 + (acc - l32) / 4294967296) % 4294967296;
    return { lo: l32 >>> 0, hi: h32 >>> 0 };
  }

  function udiv64(cpu, h, l, d) {
    var q = 0, r = h, bi;
    for (bi = 31; bi >= 0; bi--) {
      r = r * 2 + ((l >>> bi) & 1);
      q = q * 2;
      if (r >= d) { r -= d; q += 1; }
    }
    cpu.divR = r;
    return q;
  }

  function doMul(cpu, sz, v) {
    var f = cpu.eflags & ~(CF | OF);
    if (sz === 1) {
      var r8 = (cpu.r[0] & 0xFF) * (v & 0xFF);
      cpu.r[0] = (cpu.r[0] & ~0xFFFF) | (r8 & 0xFFFF);
      if (r8 & 0xFF00) f |= CF | OF;
    } else if (sz === 2) {
      var r16 = (cpu.r[0] & 0xFFFF) * (v & 0xFFFF);
      cpu.r[0] = (cpu.r[0] & ~0xFFFF) | (r16 & 0xFFFF);
      cpu.r[2] = (cpu.r[2] & ~0xFFFF) | ((r16 / 65536) & 0xFFFF);
      if (r16 > 0xFFFF) f |= CF | OF;
    } else {
      var p = mulu32(cpu.r[0] >>> 0, v >>> 0);
      cpu.r[0] = p.lo | 0;
      cpu.r[2] = p.hi | 0;
      if (p.hi !== 0) f |= CF | OF;
    }
    cpu.eflags = f;
  }

  function doIMul(cpu, sz, v) {
    var f = cpu.eflags & ~(CF | OF);
    if (sz === 1) {
      var r8 = ((cpu.r[0] << 24) >> 24) * ((v << 24) >> 24);
      cpu.r[0] = (cpu.r[0] & ~0xFFFF) | (r8 & 0xFFFF);
      if (r8 < -128 || r8 > 127) f |= CF | OF;
    } else if (sz === 2) {
      var r16 = ((cpu.r[0] << 16) >> 16) * ((v << 16) >> 16);
      cpu.r[0] = (cpu.r[0] & ~0xFFFF) | (r16 & 0xFFFF);
      cpu.r[2] = (cpu.r[2] & ~0xFFFF) | ((r16 >> 16) & 0xFFFF);
      if (r16 < -32768 || r16 > 32767) f |= CF | OF;
    } else {
      var a = sval(cpu.r[0], 4), b = sval(v, 4);
      var neg = (a < 0) !== (b < 0);
      var p = mulu32(Math.abs(a) >>> 0, Math.abs(b) >>> 0);
      var lo = p.lo, hi = p.hi;
      if (neg) {
        lo = ((~lo) + 1) >>> 0;
        hi = ((~hi) + (lo === 0 ? 1 : 0)) >>> 0;
      }
      cpu.r[0] = lo | 0;
      cpu.r[2] = hi | 0;
      var se = (lo & 0x80000000) ? 0xFFFFFFFF : 0;
      if (hi !== se) f |= CF | OF;
    }
    cpu.eflags = f;
  }

  function imulN(cpu, a, b, sz) {
    var f = cpu.eflags & ~(CF | OF);
    var res, wide;
    if (sz === 1) {
      wide = sval(a, 1) * sval(b, 1);
      res = wide & 0xFF;
      if (wide < -128 || wide > 127) f |= CF | OF;
    } else if (sz === 2) {
      wide = sval(a, 2) * sval(b, 2);
      res = wide & 0xFFFF;
      if (wide < -32768 || wide > 32767) f |= CF | OF;
    } else {
      var sa = sval(a, 4), sb = sval(b, 4);
      var neg = (sa < 0) !== (sb < 0);
      var p = mulu32(Math.abs(sa) >>> 0, Math.abs(sb) >>> 0);
      var lo = p.lo, hi = p.hi;
      if (neg) {
        lo = ((~lo) + 1) >>> 0;
        hi = ((~hi) + (lo === 0 ? 1 : 0)) >>> 0;
      }
      res = lo | 0;
      var se = (lo & 0x80000000) ? 0xFFFFFFFF : 0;
      if (hi !== se) f |= CF | OF;
    }
    cpu.eflags = f;
    return res;
  }

  function doDiv(cpu, sz, v) {
    var q, r, n, d;
    if (sz === 1) {
      d = v & 0xFF;
      if (d === 0) fault(cpu, 0, 0);
      n = cpu.r[0] & 0xFFFF;
      q = Math.floor(n / d);
      if (q * d > n) q--;
      if (q > 0xFF) fault(cpu, 0, 0);
      r = n - q * d;
      cpu.r[0] = (cpu.r[0] & ~0xFFFF) | ((r << 8) | q);
    } else if (sz === 2) {
      d = v & 0xFFFF;
      if (d === 0) fault(cpu, 0, 0);
      n = ((cpu.r[2] & 0xFFFF) >>> 0) * 65536 + (cpu.r[0] & 0xFFFF);
      q = Math.floor(n / d);
      if (q * d > n) q--;
      if ((q + 1) * d <= n) q++;
      if (q > 0xFFFF) fault(cpu, 0, 0);
      r = n - q * d;
      cpu.r[0] = (cpu.r[0] & ~0xFFFF) | q;
      cpu.r[2] = (cpu.r[2] & ~0xFFFF) | r;
    } else {
      d = v >>> 0;
      if (d === 0) fault(cpu, 0, 0);
      var h = cpu.r[2] >>> 0;
      if (h >= d) fault(cpu, 0, 0);
      q = udiv64(cpu, h, cpu.r[0] >>> 0, d);
      cpu.r[0] = q | 0;
      cpu.r[2] = cpu.divR | 0;
    }
  }

  function doIDiv(cpu, sz, v) {
    var q, r, n, d;
    if (sz === 1) {
      d = (v << 24) >> 24;
      if (d === 0) fault(cpu, 0, 0);
      n = (cpu.r[0] << 16) >> 16;
      q = Math.trunc(n / d);
      r = n - q * d;
      if (q < -128 || q > 127) fault(cpu, 0, 0);
      cpu.r[0] = (cpu.r[0] & ~0xFFFF) | ((r & 0xFF) << 8) | (q & 0xFF);
    } else if (sz === 2) {
      d = (v << 16) >> 16;
      if (d === 0) fault(cpu, 0, 0);
      n = (((cpu.r[2] & 0xFFFF) << 16) | (cpu.r[0] & 0xFFFF)) | 0;
      q = Math.trunc(n / d);
      r = n - q * d;
      if (q < -32768 || q > 32767) fault(cpu, 0, 0);
      cpu.r[0] = (cpu.r[0] & ~0xFFFF) | (q & 0xFFFF);
      cpu.r[2] = (cpu.r[2] & ~0xFFFF) | (r & 0xFFFF);
    } else {
      d = v | 0;
      if (d === 0) fault(cpu, 0, 0);
      var h = cpu.r[2] | 0, l = cpu.r[0] >>> 0;
      var negN = h < 0;
      var ll = l, hh = h >>> 0;
      if (negN) {
        ll = ((~l) + 1) >>> 0;
        hh = ((~h) + (ll === 0 ? 1 : 0)) >>> 0;
      }
      var dv = Math.abs(d) >>> 0;
      if (hh >= dv) fault(cpu, 0, 0);
      var uq = udiv64(cpu, hh, ll, dv);
      var ur = cpu.divR;
      var negQ = negN !== (d < 0);
      if (negQ) {
        if (uq > 2147483648) fault(cpu, 0, 0);
        uq = (4294967296 - uq) % 4294967296;
        ur = (4294967296 - ur) % 4294967296;
      } else if (uq > 2147483647) fault(cpu, 0, 0);
      cpu.r[0] = uq | 0;
      cpu.r[2] = ur | 0;
    }
  }

  /* ------------------------------------------------------------ transfers -- */

  CPU.prototype.farTransfer = function (off, sel, isCall) {
    var sz = this.o32 ? 4 : 2;
    if ((this.cr0 & 1) === 0) {
      if (isCall) { pushN(this, sz, this.segs[CS].sel); pushN(this, sz, this.eip); }
      loadReal(this, CS, sel);
      this.eip = this.o32 ? (off >>> 0) : (off & 0xFFFF);
      return;
    }
    if ((sel & 0xFFFC) === 0) fault(this, 13, 0);
    var d = (sel & 4)
      ? readDescriptor(this, this.ldtr.base, this.ldtr.limit, sel)
      : readDescriptor(this, this.gdtr.base, this.gdtr.limit, sel);
    if ((d[5] & 0x80) === 0) fault(this, 11, sel & 0xFFFC);
    var type = d[5] & 0x1F;
    var sbit = (d[5] & 0x10) !== 0;
    var dpl = (d[5] >> 5) & 3;
    var rpl = sel & 3;
    if (sbit && (type & 0x08) !== 0) {
      if ((type & 0x04) !== 0) {
        if (dpl > this.cpl) fault(this, 13, sel & 0xFFFC);
      } else if (dpl !== this.cpl || rpl > this.cpl) {
        fault(this, 13, sel & 0xFFFC);
      }
      if (isCall) { pushN(this, sz, this.segs[CS].sel); pushN(this, sz, this.eip); }
      var cs = this.segs[CS];
      cs.sel = sel;
      applyDesc(cs, d);
      this.refreshCS();
      this.eip = this.o32 ? (off >>> 0) : (off & 0xFFFF);
      return;
    }
    fault(this, 13, sel & 0xFFFC);
  };

  CPU.prototype.retFar = function (extra) {
    var sz = this.o32 ? 4 : 2;
    if ((this.cr0 & 1) === 0) {
      var off = popN(this, 2);
      var sel = popN(this, 2);
      loadReal(this, CS, sel);
      this.eip = off & 0xFFFF;
      if (extra) {
        var sp = ((this.r[4] & 0xFFFF) + extra) & 0xFFFF;
        this.r[4] = (this.r[4] & 0xFFFF0000) | sp;
      }
      return;
    }
    var off2 = popN(this, sz);
    var sel2 = popN(this, sz);
    if (sel2 === 0) fault(this, 13, 0);
    var d = (sel2 & 4)
      ? readDescriptor(this, this.ldtr.base, this.ldtr.limit, sel2)
      : readDescriptor(this, this.gdtr.base, this.gdtr.limit, sel2);
    if ((d[5] & 0x80) === 0) fault(this, 11, sel2 & 0xFFFC);
    if ((d[5] & 0x18) !== 0x18) fault(this, 13, sel2 & 0xFFFC);
    var rpl = sel2 & 3;
    if (rpl < this.cpl) fault(this, 13, sel2 & 0xFFFC);
    var cs = this.segs[CS];
    cs.sel = sel2;
    applyDesc(cs, d);
    if (rpl > this.cpl) {
      var esp = popN(this, sz);
      var ssSel = popN(this, sz);
      this.loadProtected(SS, ssSel, false);
      this.r[4] = esp | 0;
    }
    this.refreshCS();
    this.eip = this.o32 ? (off2 >>> 0) : (off2 & 0xFFFF);
    if (extra) {
      if (this.o32) this.r[4] = (this.r[4] + extra) | 0;
      else this.r[4] = (this.r[4] & 0xFFFF0000) | (((this.r[4] & 0xFFFF) + extra) & 0xFFFF);
    }
  };

  CPU.prototype.writeFlags = function (v, mask) {
    var nf = (this.eflags & ~mask) | (v & mask);
    nf |= 0x0002;
    if ((this.cr0 & 1) !== 0) {
      if (this.cpl !== 0) nf = (nf & ~IOPL) | (this.eflags & IOPL);
      var iopl = (this.eflags >> 12) & 3;
      if (this.cpl > iopl) nf = (nf & ~IF) | (this.eflags & IF);
      if (this.cpl !== 0) nf = (nf & ~VM) | (this.eflags & VM);
    }
    var oldIF = this.eflags & IF;
    this.eflags = nf;
    this.refreshFlags();
    if (!oldIF && (nf & IF)) this.intShadow = 1;
  };

  CPU.prototype.loadV86 = function (idx, sel) {
    var s = this.segs[idx];
    s.sel = sel & 0xFFFF;
    s.base = (sel & 0xFFFF) << 4;
    s.limit = 0xFFFF;
    s.big = false;
    s.dpl = 3; s.type = 0x03; s.s = 1; s.p = 1; s.g = 0; s.valid = true;
  };

  CPU.prototype.iret = function () {
    var sz = this.o32 ? 4 : 2;
    if ((this.eflags & NT) !== 0) fault(this, 13, 0);
    if ((this.cr0 & 1) === 0) {
      var ip = popN(this, 2);
      var cs0 = popN(this, 2);
      var fl = popN(this, 2);
      this.writeFlags(fl, 0x7FD5);
      loadReal(this, CS, cs0);
      this.eip = ip & 0xFFFF;
      return;
    }
    var nip = popN(this, sz);
    var ncs = popN(this, sz);
    var nfl = popN(this, sz);
    if ((nfl & VM) !== 0) {
      if (this.cpl !== 0) fault(this, 13, 0);
      var nesp = popN(this, sz);
      var nss = popN(this, sz);
      var ne = popN(this, sz);
      var nd = popN(this, sz);
      var nf2 = popN(this, sz);
      var ng = popN(this, sz);
      this.writeFlags(nfl, 0x247FD5 | VM);
      var cs = this.segs[CS];
      cs.sel = ncs & 0xFFFF;
      cs.base = (ncs & 0xFFFF) << 4; cs.limit = 0xFFFF; cs.big = false;
      cs.dpl = 3; cs.type = 0x0B; cs.s = 1; cs.p = 1; cs.g = 0; cs.valid = true;
      this.refreshCS();
      this.eip = nip & 0xFFFF;
      this.loadV86(DS, nd); this.loadV86(ES, ne); this.loadV86(FS, nf2); this.loadV86(GS, ng);
      this.loadV86(SS, nss);
      this.cpl = 3;
      this.cpl3 = true;
      this.r[4] = nesp | 0;
      return;
    }
    var outerRet = (ncs & 3) > this.cpl;
    var esp2 = 0, ss2 = 0;
    if (outerRet) {
      esp2 = popN(this, sz);
      ss2 = popN(this, sz);
    }
    this.writeFlags(nfl, 0x247FD5 | (this.cpl === 0 ? VM : 0));
    this.loadProtected(CS, ncs & 0xFFFF, true);
    this.eip = this.o32 ? (nip >>> 0) : (nip & 0xFFFF);
    if (outerRet) {
      this.loadProtected(SS, ss2, false);
      this.r[4] = esp2 | 0;
    }
  };

  CPU.prototype.softInt = function (vec) {
    if ((this.cr0 & 1) !== 0 && (this.eflags & VM) === 0 && this.cpl > ((this.eflags >> 12) & 3)) {
      var off = (vec * 8) >>> 0;
      if (off + 7 > this.idtr.limit) fault(this, 13, off + 2);
      var d = readDescriptor(this, this.idtr.base, 0xFFFFFFFF, off & ~7, false);
      if (!(d[5] & 0x80)) fault(this, 11, off + 2);
      if (((d[5] >> 5) & 3) < this.cpl) fault(this, 13, off + 2);
    }
    this.deliver(vec, 0, false, true);
  };

  /* ---------------------------------------------------------- string ops -- */

  function stringOp(cpu, kind, sz) {
    var a32 = cpu.a32;
    var delta = (cpu.eflags & DF) ? -sz : sz;
    var mask = a32 ? 0xFFFFFFFF : 0xFFFF;
    var srcSeg = cpu.segovr >= 0 ? cpu.segovr : DS;
    var rep = cpu.rep;
    var cnt = rep ? (a32 ? (cpu.r[1] >>> 0) : (cpu.r[1] & 0xFFFF)) : 1;
    if (rep && cnt === 0) return;
    var v, a, b;
    for (;;) {
      var si = a32 ? (cpu.r[6] >>> 0) : (cpu.r[6] & 0xFFFF);
      var di = a32 ? (cpu.r[7] >>> 0) : (cpu.r[7] & 0xFFFF);
      if (kind === 0) {
        v = segRead(cpu, srcSeg, si, sz);
        segWrite(cpu, ES, di, sz, v);
      } else if (kind === 1) {
        a = segRead(cpu, srcSeg, si, sz);
        b = segRead(cpu, ES, di, sz);
        subF(cpu, a, b, 0, sz);
      } else if (kind === 2) {
        segWrite(cpu, ES, di, sz, rdReg(cpu, 0, sz));
      } else if (kind === 3) {
        v = segRead(cpu, srcSeg, si, sz);
        wrReg(cpu, 0, v, sz);
      } else {
        a = rdReg(cpu, 0, sz);
        b = segRead(cpu, ES, di, sz);
        subF(cpu, a, b, 0, sz);
      }
      if (kind !== 2 && kind !== 4) cpu.r[6] = ((si + delta) >>> 0) & mask;
      if (kind !== 3) cpu.r[7] = ((di + delta) >>> 0) & mask;
      if (!rep) break;
      cnt--;
      cpu.r[1] = a32 ? (cnt | 0) : ((cpu.r[1] & 0xFFFF0000) | (cnt & 0xFFFF));
      if (cnt === 0) break;
      if (kind === 1 || kind === 4) {
        var zf = (cpu.eflags & ZF) !== 0;
        if (rep === 1 && !zf) break;
        if (rep === 2 && zf) break;
      }
    }
  }

  function busIn(cpu, port, sz) {
    var io = cpu.bus.io;
    if (sz === 1) return io.in8(port) & 0xFF;
    if (sz === 2) return io.in16(port) & 0xFFFF;
    return io.in32(port) >>> 0;
  }

  function busOut(cpu, port, sz, v) {
    var io = cpu.bus.io;
    if (sz === 1) io.out8(port, v & 0xFF);
    else if (sz === 2) io.out16(port, v & 0xFFFF);
    else io.out32(port, v >>> 0);
  }

  function ioCheck(cpu, port, sz) {
    if ((cpu.cr0 & 1) === 0) return;
    var iopl = (cpu.eflags >> 12) & 3;
    if (cpu.cpl <= iopl) return;
    var tss = cpu.tr;
    if (tss.sel === 0) fault(cpu, 13, 0);
    var bitmapBase;
    if ((tss.type & 0x09) === 0x09) bitmapBase = linRead(cpu, (tss.base + 0x66) >>> 0, 2);
    else bitmapBase = 0x66;
    for (var i = 0; i < sz; i++) {
      var p = port + i;
      var byteOff = bitmapBase + (p >> 3);
      if (byteOff > tss.limit) fault(cpu, 13, 0);
      var by = linRead(cpu, (tss.base + byteOff) >>> 0, 1);
      if (by & (1 << (p & 7))) fault(cpu, 13, 0);
    }
  }

  function insOuts(cpu, isIn, sz) {
    var a32 = cpu.a32;
    var delta = (cpu.eflags & DF) ? -sz : sz;
    var mask = a32 ? 0xFFFFFFFF : 0xFFFF;
    var srcSeg = cpu.segovr >= 0 ? cpu.segovr : DS;
    var rep = cpu.rep;
    var cnt = rep ? (a32 ? (cpu.r[1] >>> 0) : (cpu.r[1] & 0xFFFF)) : 1;
    if (rep && cnt === 0) return;
    var port = cpu.r[2] & 0xFFFF;
    ioCheck(cpu, port, sz);
    for (;;) {
      var di = a32 ? (cpu.r[7] >>> 0) : (cpu.r[7] & 0xFFFF);
      var si = a32 ? (cpu.r[6] >>> 0) : (cpu.r[6] & 0xFFFF);
      if (isIn) {
        segWrite(cpu, ES, di, sz, busIn(cpu, port, sz));
        cpu.r[7] = ((di + delta) >>> 0) & mask;
      } else {
        busOut(cpu, port, sz, segRead(cpu, srcSeg, si, sz));
        cpu.r[6] = ((si + delta) >>> 0) & mask;
      }
      if (!rep) break;
      cnt--;
      cpu.r[1] = a32 ? (cnt | 0) : ((cpu.r[1] & 0xFFFF0000) | (cnt & 0xFFFF));
      if (cnt === 0) break;
    }
  }

  /* ----------------------------------------------------------- group ALU -- */

  CPU.prototype.aluGroup = function (op) {
    var opc = op >> 3;
    var form = op & 7;
    var sz = this.o32 ? 4 : 2;
    var a, b, r;
    if (form === 0) {
      this.modrm();
      a = this.isReg ? rdReg(this, this.rm, 1) : segRead(this, this.eaSeg, this.ea, 1);
      b = rdReg(this, this.reg, 1);
      r = aluOp(this, opc, a, b, 1);
      if (opc !== 7) rmWrite(this, 1, r);
      return;
    }
    if (form === 1) {
      this.modrm();
      a = this.isReg ? rdReg(this, this.rm, sz) : segRead(this, this.eaSeg, this.ea, sz);
      b = rdReg(this, this.reg, sz);
      r = aluOp(this, opc, a, b, sz);
      if (opc !== 7) rmWrite(this, sz, r);
      return;
    }
    if (form === 2) {
      this.modrm();
      a = rdReg(this, this.reg, 1);
      b = this.isReg ? rdReg(this, this.rm, 1) : segRead(this, this.eaSeg, this.ea, 1);
      r = aluOp(this, opc, a, b, 1);
      if (opc !== 7) wrReg(this, this.reg, r, 1);
      return;
    }
    if (form === 3) {
      this.modrm();
      a = rdReg(this, this.reg, sz);
      b = this.isReg ? rdReg(this, this.rm, sz) : segRead(this, this.eaSeg, this.ea, sz);
      r = aluOp(this, opc, a, b, sz);
      if (opc !== 7) wrReg(this, this.reg, r, sz);
      return;
    }
    if (form === 4) {
      a = rdReg(this, 0, 1);
      b = this.fetch8();
      r = aluOp(this, opc, a, b, 1);
      if (opc !== 7) wrReg(this, 0, r, 1);
      return;
    }
    a = rdReg(this, 0, sz);
    b = this.fetchImm();
    r = aluOp(this, opc, a, b, sz);
    if (opc !== 7) wrReg(this, 0, r, sz);
  };

  CPU.prototype.shiftGroup = function (count, sz) {
    this.modrm();
    this.shiftApply(count, sz);
  };

  CPU.prototype.shiftApply = function (count, sz) {
    var sel = this.reg;
    var v = rmRead(this, sz);
    var res;
    switch (sel) {
      case 0: res = rolF(this, v, count, sz); break;
      case 1: res = rorF(this, v, count, sz); break;
      case 2: res = rclF(this, v, count, sz); break;
      case 3: res = rcrF(this, v, count, sz); break;
      case 4: res = shlF(this, v, count, sz); break;
      case 5: res = shrF(this, v, count, sz); break;
      case 6: res = shlF(this, v, count, sz); break;
      default: res = sarF(this, v, count, sz); break;
    }
    rmWrite(this, sz, res);
  };

  CPU.prototype.group3 = function (sz) {
    this.modrm();
    var sel = this.reg;
    var v;
    if (sel === 0 || sel === 1) {
      v = rmRead(this, sz);
      var imm = sz === 1 ? this.fetch8() : this.fetchImm();
      logicF(this, v & imm, sz);
      return;
    }
    v = rmRead(this, sz);
    switch (sel) {
      case 2: rmWrite(this, sz, ~v); return;
      case 3: rmWrite(this, sz, negF(this, v, sz)); return;
      case 4: doMul(this, sz, v); return;
      case 5: doIMul(this, sz, v); return;
      case 6: doDiv(this, sz, v); return;
      default: doIDiv(this, sz, v); return;
    }
  };

  CPU.prototype.cseg = function (op) {
    var sz = this.o32 ? 4 : 2;
    this.modrm();
    if (this.isReg) fault(this, 6, 0);
    var off = segRead(this, this.eaSeg, this.ea, sz);
    var sel = segRead(this, this.eaSeg, (this.ea + sz) >>> 0, 2);
    wrReg(this, this.reg, off, sz);
    this.setSeg(op === 0xC4 ? ES : DS, sel);
    return true;
  };

  CPU.prototype.group5 = function (sz) {
    this.modrm();
    var sel = this.reg;
    var v;
    switch (sel) {
      case 0:
        v = rmRead(this, sz);
        rmWrite(this, sz, incF(this, v, sz));
        return;
      case 1:
        v = rmRead(this, sz);
        rmWrite(this, sz, decF(this, v, sz));
        return;
      case 2:
        v = rmRead(this, sz);
        pushN(this, sz, this.eip);
        this.eip = this.o32 ? (v >>> 0) : (v & 0xFFFF);
        return;
      case 3:
        if (this.isReg) fault(this, 6, 0);
        this.farTransfer(segRead(this, this.eaSeg, this.ea, sz),
          segRead(this, this.eaSeg, (this.ea + sz) >>> 0, 2), true);
        return;
      case 4:
        v = rmRead(this, sz);
        this.eip = this.o32 ? (v >>> 0) : (v & 0xFFFF);
        return;
      case 5:
        if (this.isReg) fault(this, 6, 0);
        this.farTransfer(segRead(this, this.eaSeg, this.ea, sz),
          segRead(this, this.eaSeg, (this.ea + sz) >>> 0, 2), false);
        return;
      case 6:
        v = rmRead(this, sz);
        pushN(this, sz, v);
        return;
      default:
        fault(this, 6, 0);
    }
  };

  function cpu_cbw(cpu) {
    var al = cpu.r[0] & 0xFF;
    cpu.r[0] = (cpu.r[0] & ~0xFFFF) | ((al & 0x80) ? (al | 0xFF00) : al);
  }
  function cpu_cwde(cpu) {
    var ax = cpu.r[0] & 0xFFFF;
    cpu.r[0] = (ax & 0x8000) ? (ax | 0xFFFF0000) : ax;
  }
  function cpu_cwd(cpu) {
    var ax = cpu.r[0] & 0xFFFF;
    cpu.r[2] = (cpu.r[2] & ~0xFFFF) | ((ax & 0x8000) ? 0xFFFF : 0);
  }
  function cpu_cdq(cpu) {
    cpu.r[2] = (cpu.r[0] & 0x80000000) ? -1 : 0;
  }

  /* ------------------------------------------------------------- BCD ops -- */

  CPU.prototype.daa = function () {
    var al = this.r[0] & 0xFF;
    var oldCF = (this.eflags & CF) ? 1 : 0;
    var oldAF = (this.eflags & AF) ? 1 : 0;
    var cf = 0, af = 0;
    if ((al & 0x0F) > 9 || oldAF) { al += 6; af = 1; }
    if (al > 0xFF) cf = 1;
    al &= 0xFF;
    if ((al & 0xF0) > 0x90 || oldCF) { al = (al + 0x60) & 0xFF; cf = 1; }
    this.r[0] = (this.r[0] & ~0xFF) | al;
    var f = this.eflags & ~(CF | AF | ZF | SF | PF);
    if (cf) f |= CF;
    if (af) f |= AF;
    if (al === 0) f |= ZF;
    if (al & 0x80) f |= SF;
    this.eflags = f | PAR[al];
  };

  CPU.prototype.das = function () {
    var al = this.r[0] & 0xFF;
    var oldCF = (this.eflags & CF) ? 1 : 0;
    var oldAF = (this.eflags & AF) ? 1 : 0;
    var cf = 0, af = 0;
    if ((al & 0x0F) > 9 || oldAF) { al -= 6; af = 1; }
    if (al < 0) { al &= 0xFF; cf = 1; }
    if ((al & 0xF0) > 0x90 || oldCF) { al = (al - 0x60) & 0xFF; cf = 1; }
    this.r[0] = (this.r[0] & ~0xFF) | (al & 0xFF);
    var f = this.eflags & ~(CF | AF | ZF | SF | PF);
    if (cf) f |= CF;
    if (af) f |= AF;
    if ((al & 0xFF) === 0) f |= ZF;
    if (al & 0x80) f |= SF;
    this.eflags = f | PAR[al & 0xFF];
  };

  CPU.prototype.aaa = function () {
    var al = this.r[0] & 0xFF;
    var ah = (this.r[0] >> 8) & 0xFF;
    var f = this.eflags & ~(CF | AF);
    if ((al & 0x0F) > 9 || (this.eflags & AF)) {
      al = (al + 6) & 0x0F;
      ah = (ah + 1) & 0xFF;
      f |= AF | CF;
    } else {
      al &= 0x0F;
    }
    this.r[0] = (this.r[0] & ~0xFFFF) | (al | (ah << 8));
    this.eflags = f;
  };

  CPU.prototype.aas = function () {
    var al = this.r[0] & 0xFF;
    var ah = (this.r[0] >> 8) & 0xFF;
    var f = this.eflags & ~(CF | AF);
    if ((al & 0x0F) > 9 || (this.eflags & AF)) {
      al = (al - 6) & 0x0F;
      ah = (ah - 1) & 0xFF;
      f |= AF | CF;
    } else {
      al &= 0x0F;
    }
    this.r[0] = (this.r[0] & ~0xFFFF) | (al | (ah << 8));
    this.eflags = f;
  };

  /* ------------------------------------------------------------- dispatch -- */

  CPU.prototype.dispatch = function (op) {
    var sz = this.o32 ? 4 : 2;
    var a, b, v, d, i, sel;

    if (op < 0x40) {
      if (op === 0x0F) { this.exec0f(); return; }
      if (op === 0x27) { this.daa(); return; }
      if (op === 0x2F) { this.das(); return; }
      if (op === 0x37) { this.aaa(); return; }
      if (op === 0x3F) { this.aas(); return; }
      if (op === 0x06) { pushN(this, sz, this.segs[ES].sel); return; }
      if (op === 0x0E) { pushN(this, sz, this.segs[CS].sel); return; }
      if (op === 0x16) { pushN(this, sz, this.segs[SS].sel); return; }
      if (op === 0x1E) { pushN(this, sz, this.segs[DS].sel); return; }
      if (op === 0x07) { v = popN(this, sz); this.setSeg(ES, v & 0xFFFF); return; }
      if (op === 0x17) { v = popN(this, sz); this.setSeg(SS, v & 0xFFFF); this.intShadow = 1; return; }
      if (op === 0x1F) { v = popN(this, sz); this.setSeg(DS, v & 0xFFFF); return; }
      this.aluGroup(op);
      return;
    }
    if (op >= 0x40 && op <= 0x4F) {
      var ri = op & 7;
      v = rdReg(this, ri, sz);
      wrReg(this, ri, op < 0x48 ? incF(this, v, sz) : decF(this, v, sz), sz);
      return;
    }
    if (op >= 0x50 && op <= 0x57) { pushN(this, sz, rdReg(this, op & 7, sz)); return; }
    if (op >= 0x58 && op <= 0x5F) { wrReg(this, op & 7, popN(this, sz), sz); return; }
    if (op >= 0x70 && op <= 0x7F) {
      d = (this.fetch8() << 24) >> 24;
      if (cond(this, op & 0xF)) this.eip = (this.eip + d) & (this.o32 ? 0xFFFFFFFF : 0xFFFF);
      return;
    }
    if (op >= 0x90 && op <= 0x97) {
      if (op === 0x90) return;
      var rx = op & 7;
      a = rdReg(this, 0, sz);
      b = rdReg(this, rx, sz);
      wrReg(this, 0, b, sz);
      wrReg(this, rx, a, sz);
      return;
    }
    if (op >= 0xB0 && op <= 0xB7) { wrReg(this, op & 7, this.fetch8(), 1); return; }
    if (op >= 0xB8 && op <= 0xBF) { wrReg(this, op & 7, this.fetchImm(), sz); return; }

    switch (op) {
      case 0x60:
        v = rdReg(this, 4, sz);
        pushN(this, sz, rdReg(this, 0, sz));
        pushN(this, sz, rdReg(this, 1, sz));
        pushN(this, sz, rdReg(this, 2, sz));
        pushN(this, sz, rdReg(this, 3, sz));
        pushN(this, sz, v);
        pushN(this, sz, rdReg(this, 5, sz));
        pushN(this, sz, rdReg(this, 6, sz));
        pushN(this, sz, rdReg(this, 7, sz));
        return;
      case 0x61:
        wrReg(this, 7, popN(this, sz), sz);
        wrReg(this, 6, popN(this, sz), sz);
        wrReg(this, 5, popN(this, sz), sz);
        popN(this, sz);
        wrReg(this, 3, popN(this, sz), sz);
        wrReg(this, 2, popN(this, sz), sz);
        wrReg(this, 1, popN(this, sz), sz);
        wrReg(this, 0, popN(this, sz), sz);
        return;
      case 0x62: {
        this.modrm();
        if (this.isReg) fault(this, 6, 0);
        var idxv = sval(rdReg(this, this.reg, sz), sz);
        var lo = sval(segRead(this, this.eaSeg, this.ea, sz), sz);
        var hi = sval(segRead(this, this.eaSeg, (this.ea + sz) >>> 0, sz), sz);
        if (idxv < lo || idxv > hi) fault(this, 5, 0);
        return;
      }
      case 0x63:
        this.modrm();
        v = rmRead(this, 2);
        a = rdReg(this, this.reg, 2) & 3;
        if ((v & 3) < a) {
          rmWrite(this, 2, (v & ~3) | a);
          this.eflags |= ZF;
        } else {
          this.eflags &= ~ZF;
        }
        return;
      case 0x68: pushN(this, sz, this.o32 ? this.fetch32() : this.fetch16()); return;
      case 0x6A: {
        var ib = this.fetch8();
        pushN(this, sz, sz === 2 ? (((ib << 24) >> 24) & 0xFFFF) : ((ib << 24) >> 24));
        return;
      }
      case 0x69:
        this.modrm();
        b = rmRead(this, sz);
        v = this.fetchImm();
        wrReg(this, this.reg, imulN(this, b, v, sz), sz);
        return;
      case 0x6B:
        this.modrm();
        b = rmRead(this, sz);
        v = (this.fetch8() << 24) >> 24;
        wrReg(this, this.reg, imulN(this, b, v, sz), sz);
        return;
      case 0x6C: insOuts(this, true, 1); return;
      case 0x6D: insOuts(this, true, sz); return;
      case 0x6E: insOuts(this, false, 1); return;
      case 0x6F: insOuts(this, false, sz); return;
      case 0x80:
        this.modrm();
        v = rmRead(this, 1);
        b = this.fetch8();
        a = aluOp(this, this.reg, v, b, 1);
        if (this.reg !== 7) rmWrite(this, 1, a);
        return;
      case 0x82: this.dispatch(0x80); return;
      case 0x81:
        this.modrm();
        v = rmRead(this, sz);
        b = this.fetchImm();
        a = aluOp(this, this.reg, v, b, sz);
        if (this.reg !== 7) rmWrite(this, sz, a);
        return;
      case 0x83:
        this.modrm();
        v = rmRead(this, sz) & maskOf(sz);
        b = (this.fetch8() << 24) >> 24;
        a = aluOp(this, this.reg, v, b & maskOf(sz), sz);
        if (this.reg !== 7) rmWrite(this, sz, a);
        return;
      case 0x84:
        this.modrm();
        a = rmRead(this, 1);
        b = rdReg(this, this.reg, 1);
        logicF(this, a & b, 1);
        return;
      case 0x85:
        this.modrm();
        a = rmRead(this, sz);
        b = rdReg(this, this.reg, sz);
        logicF(this, a & b, sz);
        return;
      case 0x86:
        this.modrm();
        a = rmRead(this, 1);
        b = rdReg(this, this.reg, 1);
        rmWrite(this, 1, b);
        wrReg(this, this.reg, a, 1);
        return;
      case 0x87:
        this.modrm();
        a = rmRead(this, sz);
        b = rdReg(this, this.reg, sz);
        rmWrite(this, sz, b);
        wrReg(this, this.reg, a, sz);
        return;
      case 0x88:
        this.modrm();
        rmWrite(this, 1, rdReg(this, this.reg, 1));
        return;
      case 0x89:
        this.modrm();
        rmWrite(this, sz, rdReg(this, this.reg, sz));
        return;
      case 0x8A:
        this.modrm();
        wrReg(this, this.reg, rmRead(this, 1), 1);
        return;
      case 0x8B:
        this.modrm();
        wrReg(this, this.reg, rmRead(this, sz), sz);
        return;
      case 0x8C:
        this.modrm();
        if (this.reg > 5) fault(this, 6, 0);
        rmWrite(this, 2, this.segs[this.reg].sel);
        return;
      case 0x8D:
        this.modrm();
        if (this.isReg) fault(this, 6, 0);
        wrReg(this, this.reg, this.ea >>> 0, sz);
        return;
      case 0x8E:
        this.modrm();
        if (this.reg > 5 || this.reg === CS) fault(this, 6, 0);
        sel = rmRead(this, 2) & 0xFFFF;
        this.setSeg(this.reg, sel);
        if (this.reg === SS) this.intShadow = 1;
        return;
      case 0x8F:
        this.modrm();
        if (this.reg !== 0) fault(this, 6, 0);
        v = popN(this, sz);
        rmWrite(this, sz, v);
        return;
      case 0x98:
        if (sz === 2) cpu_cbw(this); else cpu_cwde(this);
        return;
      case 0x99:
        if (sz === 2) cpu_cwd(this); else cpu_cdq(this);
        return;
      case 0x9A: {
        var off9 = this.o32 ? this.fetch32() : this.fetch16();
        var sel9 = this.fetch16();
        this.farTransfer(off9, sel9, true);
        return;
      }
      case 0x9B: return;
      case 0x9C:
        pushN(this, sz, sz === 2 ? (this.eflags & 0xFFFF) | 2 : this.eflags);
        return;
      case 0x9D:
        v = popN(this, sz);
        this.writeFlags(v, sz === 2 ? 0x7FD5 : 0x247FD5);
        return;
      case 0x9E:
        this.eflags = (this.eflags & ~(SF | ZF | AF | PF | CF)) |
          ((this.r[0] >> 8) & (SF | ZF | AF | PF | CF)) | 0x2;
        return;
      case 0x9F:
        wrReg(this, 4, this.eflags & (SF | ZF | AF | PF | CF | 0x2), 1);
        return;
      case 0xA0: {
        var o0 = this.a32 ? this.fetch32() : this.fetch16();
        wrReg(this, 0, segRead(this, this.segovr >= 0 ? this.segovr : DS, o0, 1), 1);
        return;
      }
      case 0xA1: {
        var o1 = this.a32 ? this.fetch32() : this.fetch16();
        wrReg(this, 0, segRead(this, this.segovr >= 0 ? this.segovr : DS, o1, sz), sz);
        return;
      }
      case 0xA2: {
        var o2 = this.a32 ? this.fetch32() : this.fetch16();
        segWrite(this, this.segovr >= 0 ? this.segovr : DS, o2, 1, rdReg(this, 0, 1));
        return;
      }
      case 0xA3: {
        var o3 = this.a32 ? this.fetch32() : this.fetch16();
        segWrite(this, this.segovr >= 0 ? this.segovr : DS, o3, sz, rdReg(this, 0, sz));
        return;
      }
      case 0xA4: stringOp(this, 0, 1); return;
      case 0xA5: stringOp(this, 0, sz); return;
      case 0xA6: stringOp(this, 1, 1); return;
      case 0xA7: stringOp(this, 1, sz); return;
      case 0xA8:
        logicF(this, rdReg(this, 0, 1) & this.fetch8(), 1);
        return;
      case 0xA9: {
        var immt = this.fetchImm();
        logicF(this, rdReg(this, 0, sz) & immt, sz);
        return;
      }
      case 0xAA: stringOp(this, 2, 1); return;
      case 0xAB: stringOp(this, 2, sz); return;
      case 0xAC: stringOp(this, 3, 1); return;
      case 0xAD: stringOp(this, 3, sz); return;
      case 0xAE: stringOp(this, 4, 1); return;
      case 0xAF: stringOp(this, 4, sz); return;
      case 0xC0: this.modrm(); this.shiftApply(this.fetch8() & 0x1F, 1); return;
      case 0xC1: this.modrm(); this.shiftApply(this.fetch8() & 0x1F, sz); return;
      case 0xC2: {
        v = this.fetch16();
        this.eip = popN(this, sz) >>> 0;
        this.r[4] = (this.r[4] + v) | 0;
        return;
      }
      case 0xC3: this.eip = popN(this, sz) >>> 0; return;
      case 0xC4: this.cseg(0xC4); return;
      case 0xC5: this.cseg(0xC5); return;
      case 0xC6:
        this.modrm();
        v = this.fetch8();
        rmWrite(this, 1, v);
        return;
      case 0xC7:
        this.modrm();
        v = this.fetchImm();
        rmWrite(this, sz, v);
        return;
      case 0xC8: {
        var nsize = this.fetch16();
        var lvl = this.fetch8() & 0x1F;
        var bpr = rdReg(this, 5, sz);
        pushN(this, sz, bpr);
        var frame = rdReg(this, 4, sz);
        if (lvl > 0) {
          for (i = 1; i < lvl; i++) {
            var bp2 = (bpr - sz) & maskOf(sz);
            var tmp = segRead(this, SS, this.a32 ? bp2 : (bp2 & 0xFFFF), sz);
            pushN(this, sz, tmp);
            bpr = bp2;
          }
          pushN(this, sz, frame);
        }
        wrReg(this, 5, frame, sz);
        if (sz === 2) {
          var sp8 = (this.r[4] - nsize) & 0xFFFF;
          this.r[4] = (this.r[4] & 0xFFFF0000) | sp8;
        } else {
          this.r[4] = (this.r[4] - nsize) | 0;
        }
        return;
      }
      case 0xC9:
        this.r[4] = rdReg(this, 5, sz) | 0;
        wrReg(this, 5, popN(this, sz), sz);
        return;
      case 0xCA: v = this.fetch16(); this.retFar(v); return;
      case 0xCB: this.retFar(0); return;
      case 0xCC: this.softInt(3); return;
      case 0xCD: this.softInt(this.fetch8()); return;
      case 0xCE: if (this.eflags & OF) this.softInt(4); return;
      case 0xCF: this.iret(); return;
      case 0xD0: this.shiftGroup(1, 1); return;
      case 0xD1: this.shiftGroup(1, sz); return;
      case 0xD2: this.shiftGroup(this.r[1] & 0x1F, 1); return;
      case 0xD3: this.shiftGroup(this.r[1] & 0x1F, sz); return;
      case 0xD4: {
        var base4 = this.fetch8();
        if (base4 === 0) fault(this, 0, 0);
        var al4 = this.r[0] & 0xFF;
        var q4 = Math.floor(al4 / base4);
        var r4 = al4 % base4;
        this.r[0] = (this.r[0] & ~0xFFFF) | ((r4 << 8) | q4);
        setZS(this, q4, 1);
        this.eflags = (this.eflags & ~PF) | PAR[q4 & 0xFF];
        return;
      }
      case 0xD5: {
        var base5 = this.fetch8();
        var al5 = ((this.r[0] & 0xFF) + (((this.r[0] >> 8) & 0xFF) * base5)) & 0xFF;
        this.r[0] = (this.r[0] & ~0xFFFF) | al5;
        setZS(this, al5, 1);
        this.eflags = (this.eflags & ~PF) | PAR[al5 & 0xFF];
        return;
      }
      case 0xD7: {
        var off7 = this.a32 ? ((this.r[3] + (this.r[0] & 0xFF)) >>> 0)
          : (((this.r[3] & 0xFFFF) + (this.r[0] & 0xFF)) & 0xFFFF);
        wrReg(this, 0, segRead(this, this.segovr >= 0 ? this.segovr : DS, off7, 1), 1);
        return;
      }
      case 0xE0: case 0xE1: case 0xE2: case 0xE3: {
        d = (this.fetch8() << 24) >> 24;
        var cx3 = this.a32 ? (this.r[1] >>> 0) : (this.r[1] & 0xFFFF);
        var take = false;
        if (op === 0xE3) take = cx3 === 0;
        else {
          cx3 = (cx3 - 1) >>> 0;
          if (this.a32) this.r[1] = cx3 | 0;
          else this.r[1] = (this.r[1] & 0xFFFF0000) | (cx3 & 0xFFFF);
          if (op === 0xE2) take = cx3 !== 0;
          else if (op === 0xE1) take = cx3 !== 0 && (this.eflags & ZF) !== 0;
          else take = cx3 !== 0 && (this.eflags & ZF) === 0;
        }
        if (take) this.eip = (this.eip + d) & (this.o32 ? 0xFFFFFFFF : 0xFFFF);
        return;
      }
      case 0xE4:
        v = this.fetch8(); ioCheck(this, v, 1);
        wrReg(this, 0, busIn(this, v, 1), 1);
        return;
      case 0xE5:
        v = this.fetch8(); ioCheck(this, v, sz);
        wrReg(this, 0, busIn(this, v, sz), sz);
        return;
      case 0xE6:
        v = this.fetch8(); ioCheck(this, v, 1);
        busOut(this, v, 1, rdReg(this, 0, 1));
        return;
      case 0xE7:
        v = this.fetch8(); ioCheck(this, v, sz);
        busOut(this, v, sz, rdReg(this, 0, sz));
        return;
      case 0xE8: {
        var rel8 = this.o32 ? this.fetch32() : this.fetch16();
        var tgt = this.o32 ? ((this.eip + rel8) >>> 0) : ((this.eip + rel8) & 0xFFFF);
        pushN(this, sz, this.eip);
        this.eip = tgt;
        return;
      }
      case 0xE9: {
        var rel9 = this.o32 ? this.fetch32() : this.fetch16();
        this.eip = this.o32 ? ((this.eip + rel9) >>> 0) : ((this.eip + rel9) & 0xFFFF);
        return;
      }
      case 0xEA: {
        var offa = this.o32 ? this.fetch32() : this.fetch16();
        var sela = this.fetch16();
        this.farTransfer(offa, sela, false);
        return;
      }
      case 0xEB: {
        var relb = (this.fetch8() << 24) >> 24;
        this.eip = (this.eip + relb) & (this.o32 ? 0xFFFFFFFF : 0xFFFF);
        return;
      }
      case 0xEC:
        ioCheck(this, this.r[2] & 0xFFFF, 1);
        wrReg(this, 0, busIn(this, this.r[2] & 0xFFFF, 1), 1);
        return;
      case 0xED:
        ioCheck(this, this.r[2] & 0xFFFF, sz);
        wrReg(this, 0, busIn(this, this.r[2] & 0xFFFF, sz), sz);
        return;
      case 0xEE:
        ioCheck(this, this.r[2] & 0xFFFF, 1);
        busOut(this, this.r[2] & 0xFFFF, 1, rdReg(this, 0, 1));
        return;
      case 0xEF:
        ioCheck(this, this.r[2] & 0xFFFF, sz);
        busOut(this, this.r[2] & 0xFFFF, sz, rdReg(this, 0, sz));
        return;
      case 0xF4:
        this.halted = true;
        return;
      case 0xF5:
        this.eflags ^= CF;
        return;
      case 0xF6: this.group3(1); return;
      case 0xF7: this.group3(sz); return;
      case 0xF8: this.eflags &= ~CF; return;
      case 0xF9: this.eflags |= CF; return;
      case 0xFA:
        if ((this.cr0 & 1) !== 0 && this.cpl > ((this.eflags >> 12) & 3)) fault(this, 13, 0);
        this.eflags &= ~IF;
        return;
      case 0xFB:
        if ((this.cr0 & 1) !== 0 && this.cpl > ((this.eflags >> 12) & 3)) fault(this, 13, 0);
        this.eflags |= IF;
        this.intShadow = 1;
        return;
      case 0xFC: this.eflags &= ~DF; return;
      case 0xFD: this.eflags |= DF; return;
      case 0xFE:
        this.modrm();
        v = rmRead(this, 1);
        if (this.reg === 0) rmWrite(this, 1, incF(this, v, 1));
        else if (this.reg === 1) rmWrite(this, 1, decF(this, v, 1));
        else fault(this, 6, 0);
        return;
      case 0xFF: this.group5(sz); return;
      case 0xD8: case 0xD9: case 0xDA: case 0xDB:
      case 0xDC: case 0xDD: case 0xDE: case 0xDF:
        this.fpuOp(op);
        return;
      default:
        fault(this, 6, 0);
    }
  };

  /* ------------------------------------------------------- CR/DR access -- */

  function writeCR(cpu, n, v) {
    v = v >>> 0;
    switch (n) {
      case 0:
        if ((v & 0x80000000) !== 0 && (v & 1) === 0) fault(cpu, 13, 0);
        var oldPG = cpu.cr0 & 0x80000000;
        cpu.cr0 = ((v & 0xE005003F) | 0x10) >>> 0;
        if ((cpu.cr0 & 0x80000000) !== oldPG) cpu.flushTLB();
        cpu.refreshFlags();
        return;
      case 2:
        cpu.cr2 = v;
        return;
      case 3:
        cpu.cr3 = v;
        cpu.flushTLB();
        return;
      case 4:
        cpu.cr4 = (v & 0x0000001F) >>> 0;
        cpu.flushTLB();
        return;
      default:
        fault(cpu, 6, 0);
    }
  }

  function readCR(cpu, n) {
    switch (n) {
      case 0: return cpu.cr0 >>> 0;
      case 2: return cpu.cr2 >>> 0;
      case 3: return cpu.cr3 >>> 0;
      case 4: return cpu.cr4 >>> 0;
      default: fault(cpu, 6, 0);
    }
  }

  /* -------------------------------------------------------- two-byte map -- */

  CPU.prototype.exec0f = function () {
    var op = this.fetch8();
    var sz = this.o32 ? 4 : 2;
    var a, b, v, d, sel, n, i;

    if (op >= 0x80 && op <= 0x8F) {
      var rel = this.o32 ? this.fetch32() : this.fetch16();
      if (cond(this, op & 0xF)) this.eip = (this.eip + rel) & (this.o32 ? 0xFFFFFFFF : 0xFFFF);
      return;
    }
    if (op >= 0x90 && op <= 0x9F) {
      this.modrm();
      rmWrite(this, 1, cond(this, op & 0xF) ? 1 : 0);
      return;
    }
    if (op >= 0x40 && op <= 0x4F) { fault(this, 6, 0); return; }
    if (op >= 0xC8 && op <= 0xCF) {
      n = op & 7;
      v = rdReg(this, n, 4);
      wrReg(this, n, ((v & 0xFF) << 24) | ((v & 0xFF00) << 8) | ((v >>> 8) & 0xFF00) | ((v >>> 24) & 0xFF), 4);
      return;
    }

    switch (op) {
      case 0x00: {
        this.modrm();
        var g6 = this.reg;
        if (g6 === 0) { rmWrite(this, 2, this.ldtr.sel); return; }
        if (g6 === 1) { rmWrite(this, 2, this.tr.sel); return; }
        if (g6 === 2) {
          if (this.cpl !== 0) fault(this, 13, 0);
          sel = rmRead(this, 2) & 0xFFFF;
          if ((sel & 0xFFFC) === 0) {
            this.ldtr = { sel: 0, base: 0, limit: 0, big: false, dpl: 0, type: 2, s: 0, p: 0, g: 0, valid: false };
            return;
          }
          d = (sel & 4) ? readDescriptor(this, this.ldtr.base, this.ldtr.limit, sel)
            : readDescriptor(this, this.gdtr.base, this.gdtr.limit, sel);
          if ((d[5] & 0x80) === 0) fault(this, 11, sel & 0xFFFC);
          if ((d[5] & 0x10) !== 0 || (d[5] & 0x0F) !== 2) fault(this, 13, sel & 0xFFFC);
          var ld = mkseg();
          ld.sel = sel; ld.s = 0; applyDesc(ld, d); ld.type = 2;
          this.ldtr = ld;
          return;
        }
        if (g6 === 3) {
          if (this.cpl !== 0) fault(this, 13, 0);
          sel = rmRead(this, 2) & 0xFFFF;
          if ((sel & 0xFFFC) === 0) fault(this, 13, 0);
          d = (sel & 4) ? readDescriptor(this, this.ldtr.base, this.ldtr.limit, sel)
            : readDescriptor(this, this.gdtr.base, this.gdtr.limit, sel);
          if ((d[5] & 0x80) === 0) fault(this, 11, sel & 0xFFFC);
          var ty = d[5] & 0x0F;
          if ((d[5] & 0x10) !== 0 || (ty !== 9 && ty !== 1)) fault(this, 13, sel & 0xFFFC);
          var ng = mkseg();
          ng.sel = sel; ng.s = 0; applyDesc(ng, d); ng.type = ty | 2;
          this.tr = ng;
          setDescriptorBusy(this, sel);
          return;
        }
        if (g6 === 4 || g6 === 5) {
          sel = rmRead(this, 2) & 0xFFFF;
          if ((sel & 0xFFFC) === 0) { this.eflags &= ~ZF; return; }
          if ((sel & 4) && this.ldtr.sel === 0) { this.eflags &= ~ZF; return; }
          d = (sel & 4) ? readDescriptor(this, this.ldtr.base, this.ldtr.limit, sel)
            : readDescriptor(this, this.gdtr.base, this.gdtr.limit, sel);
          var okv = (d[5] & 0x80) !== 0 && (d[5] & 0x10) !== 0;
          var typ = d[5] & 0x0F;
          var dp = (d[5] >> 5) & 3;
          var rp = sel & 3;
          if (okv) {
            if (g6 === 5) okv = (typ & 0x0A) === 0x02;
            else okv = (typ & 0x08) !== 0 ? (typ & 0x02) !== 0 : true;
            if (dp < this.cpl || dp < rp) okv = false;
          }
          if (okv) this.eflags |= ZF; else this.eflags &= ~ZF;
          return;
        }
        fault(this, 6, 0);
        return;
      }
      case 0x01: {
        var b1 = this.fetch8();
        var m1 = b1 >> 6, r1 = (b1 >> 3) & 7, rm1 = b1 & 7;
        if (m1 !== 3) {
          this.eip = (this.eip - 1) >>> 0;
          this.modrm();
        } else {
          this.mod = 3; this.reg = r1; this.rm = rm1; this.isReg = 1;
          this.ea = 0; this.eaSeg = this.segovr >= 0 ? this.segovr : DS;
        }
        switch (r1) {
          case 0: case 1:
            if (this.isReg) fault(this, 6, 0);
            var gd = r1 === 0 ? this.gdtr : this.idtr;
            segWrite(this, this.eaSeg, this.ea, 2, gd.limit & 0xFFFF);
            segWrite(this, this.eaSeg, (this.ea + 2) >>> 0, 2, gd.base & 0xFFFF);
            segWrite(this, this.eaSeg, (this.ea + 4) >>> 0, 2, (gd.base >>> 16) & 0xFFFF);
            return;
          case 2: case 3: {
            if (this.isReg) fault(this, 6, 0);
            var lim = segRead(this, this.eaSeg, this.ea, 2);
            var bl = segRead(this, this.eaSeg, (this.ea + 2) >>> 0, 2);
            var bh = this.o32 ? segRead(this, this.eaSeg, (this.ea + 4) >>> 0, 2) : 0;
            var nt = r1 === 2 ? this.gdtr : this.idtr;
            nt.limit = lim;
            nt.base = (bl | (bh << 16)) >>> 0;
            return;
          }
          case 4: {
            rmWrite(this, 2, this.cr0 & 0xFFFF);
            return;
          }
          case 6: {
            if (this.cpl !== 0) fault(this, 13, 0);
            var msw = rmRead(this, 2) & 0x000F;
            this.cr0 = ((this.cr0 & ~0x000F) | msw) >>> 0;
            this.refreshFlags();
            return;
          }
          case 7:
            if (this.cpl !== 0) fault(this, 13, 0);
            if (this.isReg) fault(this, 6, 0);
            if (this.paging) invlpg(this, this.eaSeg, this.ea);
            return;
          default:
            fault(this, 6, 0);
        }
        return;
      }
      case 0x02: case 0x03: {
        this.modrm();
        sel = rmRead(this, 2) & 0xFFFF;
        if ((sel & 0xFFFC) === 0) { this.eflags &= ~ZF; return; }
        if ((sel & 4) && this.ldtr.sel === 0) { this.eflags &= ~ZF; return; }
        d = (sel & 4) ? readDescriptor(this, this.ldtr.base, this.ldtr.limit, sel)
          : readDescriptor(this, this.gdtr.base, this.gdtr.limit, sel);
        if ((d[5] & 0x80) === 0) { this.eflags &= ~ZF; return; }
        var t2 = d[5] & 0x0F;
        if ((d[5] & 0x10) === 0 && (t2 === 0 || t2 > 0x0B)) { this.eflags &= ~ZF; return; }
        if (op === 0x02) {
          wrReg(this, this.reg, ((d[4] & 0xFF) | (d[5] << 8) | ((d[6] & 0xF0) << 12)) >>> 0, sz);
        } else {
          wrReg(this, this.reg, descLimit(d), sz);
        }
        this.eflags |= ZF;
        return;
      }
      case 0x06:
        if (this.cpl !== 0) fault(this, 13, 0);
        this.cr0 = (this.cr0 & ~0x8) >>> 0;
        this.refreshFlags();
        return;
      case 0x08: case 0x09:
        if (this.cpl !== 0) fault(this, 13, 0);
        this.flushTLB();
        return;
      case 0x0B: fault(this, 6, 0); return;
      case 0x20: case 0x21: case 0x22: case 0x23: {
        this.modrm();
        if (this.mod !== 3) fault(this, 6, 0);
        n = this.reg;
        if (op === 0x20) {
          if (n === 1 || n > 4) fault(this, 6, 0);
          wrReg(this, this.rm, readCR(this, n), 4);
          return;
        }
        if (op === 0x22) {
          if (n === 1 || n > 4) fault(this, 6, 0);
          writeCR(this, n, rdReg(this, this.rm, 4));
          return;
        }
        if (n > 7 || n === 4 || n === 5) fault(this, 6, 0);
        if (op === 0x21) {
          wrReg(this, this.rm, this.dr[n] >>> 0, 4);
          return;
        }
        this.dr[n] = rdReg(this, this.rm, 4);
        return;
      }
      case 0x24: case 0x26:
        fault(this, 6, 0);   /* MOV TR: not on 386/486 */
        return;
      case 0x30: case 0x31: case 0x32: case 0x33:
        fault(this, 6, 0);
        return;
      case 0xA0: pushN(this, sz, this.segs[FS].sel); return;
      case 0xA1: v = popN(this, sz); this.setSeg(FS, v & 0xFFFF); return;
      case 0xA8: pushN(this, sz, this.segs[GS].sel); return;
      case 0xA9: v = popN(this, sz); this.setSeg(GS, v & 0xFFFF); return;
      case 0xA2: {
        var leaf = this.r[0] >>> 0;
        if (leaf === 0) {
          this.r[0] = 1;
          this.r[1] = 0x6C65746E;
          this.r[2] = 0x49656E69;
          this.r[3] = 0x756E6547;
        } else if (leaf === 1) {
          this.r[0] = 0x0433;
          this.r[1] = 0;
          this.r[2] = 0x00000007;
          this.r[3] = 0;
        } else {
          this.r[0] = 0; this.r[1] = 0; this.r[2] = 0; this.r[3] = 0;
        }
        return;
      }
      case 0xA3: case 0xAB: case 0xB3: case 0xBB:
        this.bitOp(op === 0xA3 ? 0 : op === 0xAB ? 1 : op === 0xB3 ? 2 : 3, -1, sz);
        return;
      case 0xA4:
        this.modrm();
        this.shldGroup(rmReadReg(this, sz), rdReg(this, this.reg, sz), this.fetch8() & 0x1F, 0, sz);
        return;
      case 0xA5:
        this.modrm();
        this.shldGroup(rmReadReg(this, sz), rdReg(this, this.reg, sz), this.r[1] & 0x1F, 0, sz);
        return;
      case 0xAC:
        this.modrm();
        this.shldGroup(rmReadReg(this, sz), rdReg(this, this.reg, sz), this.fetch8() & 0x1F, 1, sz);
        return;
      case 0xAD:
        this.modrm();
        this.shldGroup(rmReadReg(this, sz), rdReg(this, this.reg, sz), this.r[1] & 0x1F, 1, sz);
        return;
      case 0xBA: {
        this.modrm();
        var which = this.reg - 4;
        var ibits = this.fetch8() & (sz === 4 ? 31 : 15);
        this.bitApply(which, ibits, sz);
        return;
      }
      case 0xAF:
        this.modrm();
        b = rmRead(this, sz);
        wrReg(this, this.reg, imulN(this, rdReg(this, this.reg, sz), b, sz), sz);
        return;
      case 0xB0: case 0xB1: {
        var s2 = op === 0xB0 ? 1 : sz;
        this.modrm();
        a = rmRead(this, s2);
        b = rdReg(this, this.reg, s2);
        if (rdReg(this, 0, s2) === a) {
          this.eflags |= ZF;
          rmWrite(this, s2, b);
        } else {
          this.eflags &= ~ZF;
          wrReg(this, 0, a, s2);
        }
        return;
      }
      case 0xB2: this.farSegLoad(SS); return;
      case 0xB4: this.farSegLoad(FS); return;
      case 0xB5: this.farSegLoad(GS); return;
      case 0xB6:
        this.modrm();
        wrReg(this, this.reg, rmRead(this, 1), sz);
        return;
      case 0xB7:
        this.modrm();
        wrReg(this, this.reg, rmRead(this, 2), sz);
        return;
      case 0xBC: case 0xBD: {
        this.modrm();
        v = rmRead(this, sz);
        if (v === 0) {
          this.eflags |= ZF;
          return;
        }
        this.eflags &= ~ZF;
        var bitn = 0;
        if (op === 0xBC) {
          while (((v >>> bitn) & 1) === 0) bitn++;
        } else {
          bitn = sz * 8 - 1;
          while (((v >>> bitn) & 1) === 0) bitn--;
        }
        wrReg(this, this.reg, bitn, sz);
        return;
      }
      case 0xBE:
        this.modrm();
        wrReg(this, this.reg, sval(rmRead(this, 1), 1), sz);
        return;
      case 0xBF:
        this.modrm();
        wrReg(this, this.reg, sval(rmRead(this, 2), 2), sz);
        return;
      case 0xC0: case 0xC1: {
        var x2 = op === 0xC0 ? 1 : sz;
        this.modrm();
        a = rmRead(this, x2);
        b = rdReg(this, this.reg, x2);
        rmWrite(this, x2, addF(this, a, b, 0, x2));
        wrReg(this, this.reg, a, x2);
        return;
      }
      case 0xC7:
        this.modrm();
        if (this.reg !== 1) fault(this, 6, 0);
        if (this.isReg) fault(this, 6, 0);
        var lo = segRead(this, this.eaSeg, this.ea, 4) >>> 0;
        var hi = segRead(this, this.eaSeg, (this.ea + 4) >>> 0, 4) >>> 0;
        if ((this.r[0] >>> 0) === lo && (this.r[2] >>> 0) === hi) {
          this.eflags |= ZF;
          segWrite(this, this.eaSeg, this.ea, 4, this.r[3]);
          segWrite(this, this.eaSeg, (this.ea + 4) >>> 0, 4, this.r[1]);
        } else {
          this.eflags &= ~ZF;
          this.r[0] = lo | 0;
          this.r[2] = hi | 0;
        }
        return;
      default:
        fault(this, 6, 0);
    }
  };

  function rmReadReg(cpu, sz) {
    return cpu.isReg ? rdReg(cpu, cpu.rm, sz) : segRead(cpu, cpu.eaSeg, cpu.ea, sz);
  }

  function invlpg(cpu, segIdx, off) {
    var s = cpu.segs[segIdx];
    if (off + 3 > s.limit) fault(cpu, 13, 0);
    var la = (s.base + off) >>> 0;
    var idx = (la >>> 12) & 0x3FF;
    if (cpu.tlbTag[idx] === (la >>> 12) + 1) cpu.tlbTag[idx] = 0;
  }

  function setDescriptorBusy(cpu, sel) {
    var base = (sel & 4) ? cpu.ldtr.base : cpu.gdtr.base;
    var limit = (sel & 4) ? cpu.ldtr.limit : cpu.gdtr.limit;
    var off = sel & 0xFFF8;
    if (off + 7 > limit) return;
    var la = (base + off + 5) >>> 0;
    if (cpu.paging) la = xlate(cpu, la, true, false);
    var b = cpu.bus.read8(la);
    cpu.bus.write8(la, b | 0x02);
  }

  CPU.prototype.farSegLoad = function (idx) {
    var sz = this.o32 ? 4 : 2;
    this.modrm();
    if (this.isReg) fault(this, 6, 0);
    var off = segRead(this, this.eaSeg, this.ea, sz);
    var sel = segRead(this, this.eaSeg, (this.ea + sz) >>> 0, 2);
    wrReg(this, this.reg, off, sz);
    this.setSeg(idx, sel);
  };

  CPU.prototype.bitOp = function (kind, imm, sz) {
    this.modrm();
    this.bitApply(kind, imm, sz);
  };

  CPU.prototype.bitApply = function (kind, imm, sz) {
    if (kind < 0 || kind > 3) fault(this, 6, 0);
    var bits = sz * 8;
    var bitOff;
    if (imm >= 0) {
      bitOff = imm & (bits - 1);
    } else {
      bitOff = sval(rdReg(this, this.reg, sz), sz);
      if (!this.isReg) {
        var shift = sz === 2 ? 4 : sz === 4 ? 5 : 6;
        var adj = (bitOff >> shift) * sz;
        this.ea = (this.ea + adj) >>> 0;
        if (this.a32) this.ea = this.ea >>> 0; else this.ea = this.ea & 0xFFFF;
        bitOff &= (bits - 1);
      } else {
        bitOff &= (bits - 1);
      }
    }
    var v = rmRead(this, sz);
    var bit = (v >>> bitOff) & 1;
    this.eflags = (this.eflags & ~CF) | (bit ? CF : 0);
    if (kind === 1) rmWrite(this, sz, v | (1 << bitOff));
    else if (kind === 2) rmWrite(this, sz, v & ~(1 << bitOff));
    else if (kind === 3) rmWrite(this, sz, v ^ (1 << bitOff));
  };

  CPU.prototype.shldGroup = function (dst, src, cnt, isShr, sz) {
    var w = sz * 8, mask = maskOf(sz);
    var res;
    if (cnt === 0) {
      rmWrite(this, sz, dst);
      return;
    }
    var f = this.eflags & ~(CF | OF | PF | ZF | SF);
    if (cnt <= w) {
      if (isShr) {
        res = ((dst >>> cnt) | (src << (w - cnt))) & mask;
        if (((dst >>> (cnt - 1)) & 1) !== 0) f |= CF;
      } else {
        res = (((dst << cnt) >>> 0) | (src >>> (w - cnt))) & mask;
        if (((dst >>> (w - cnt)) & 1) !== 0) f |= CF;
      }
    } else {
      res = 0;
    }
    if (res === 0) f |= ZF;
    if (res & sbitOf(sz)) f |= SF;
    if (cnt === 1) {
      var msb = res & sbitOf(sz);
      if ((((msb !== 0) ? 1 : 0) ^ ((f & CF) ? 1 : 0)) !== 0) f |= OF;
    }
    this.eflags = f | PAR[res & 0xFF];
    rmWrite(this, sz, res);
  };

  /* ---------------------------------------------------------------- FPU -- */

  var FBUF = new Float64Array(1);
  var FU32 = new Uint32Array(FBUF.buffer);
  var FF32 = new Float32Array(1);
  var FU8F = new Uint8Array(FF32.buffer);

  CPU.prototype.fpuReset = function () {
    var i;
    for (i = 0; i < 8; i++) { this.fv[i] = 0; this.ftag[i] = 3; }
    this.ftop = 0;
    this.fcw = 0x037F;
    this.fsw = 0;
    this.fip = 0;
    this.fop = 0;
  };

  function fswTop(cpu) {
    return (cpu.fsw & ~0x3800) | ((cpu.ftop & 7) << 11);
  }

  function ftagWord(cpu) {
    var w = 0, i;
    for (i = 0; i < 8; i++) w |= (cpu.ftag[i] & 3) << (i * 2);
    return w & 0xFFFF;
  }

  function fpuTagOf(v) {
    if (v === 0) return 1;
    if (!isFinite(v)) return 2;
    return 0;
  }

  function fpuPush(cpu, v) {
    cpu.ftop = (cpu.ftop - 1) & 7;
    cpu.fv[cpu.ftop] = v;
    cpu.ftag[cpu.ftop] = fpuTagOf(v);
  }

  function fpuPop(cpu) {
    var v = cpu.fv[cpu.ftop];
    cpu.ftag[cpu.ftop] = 3;
    cpu.ftop = (cpu.ftop + 1) & 7;
    return v;
  }

  function st(cpu, i) { return cpu.fv[(cpu.ftop + i) & 7]; }
  function stSet(cpu, i, v) {
    var k = (cpu.ftop + i) & 7;
    cpu.fv[k] = v;
    cpu.ftag[k] = fpuTagOf(v);
  }

  function fsetC(cpu, c0, c1, c2, c3) {
    var sw = cpu.fsw & ~(0x0100 | 0x0200 | 0x0400 | 0x4000);
    if (c0) sw |= 0x0100;
    if (c1) sw |= 0x0200;
    if (c2) sw |= 0x0400;
    if (c3) sw |= 0x4000;
    cpu.fsw = sw;
  }

  function fcompare(cpu, a, b) {
    if (isNaN(a) || isNaN(b)) { fsetC(cpu, 1, 0, 1, 1); return; }
    if (a > b) fsetC(cpu, 0, 0, 0, 0);
    else if (a === b) fsetC(cpu, 0, 0, 0, 1);
    else fsetC(cpu, 1, 0, 0, 0);
  }

  function fldValue(cpu, v) {
    fpuPush(cpu, v);
  }

  function fround(cpu, v) {
    var rc = (cpu.fcw >> 10) & 3;
    if (!isFinite(v)) return v;
    if (rc === 1) return Math.floor(v);
    if (rc === 2) return Math.ceil(v);
    if (rc === 3) return Math.trunc(v);
    var fl = Math.floor(v), df = v - fl;
    if (df > 0.5) return fl + 1;
    if (df < 0.5) return fl;
    return (fl % 2 === 0) ? fl : fl + 1;
  }

  function fpuMemRead(cpu, sz) {
    var v = 0, i;
    for (i = sz - 1; i >= 0; i--) v = v * 256 + segRead(cpu, cpu.eaSeg, (cpu.ea + i) >>> 0, 1);
    return v;
  }

  function fpuMemWriteInt(cpu, sz, v) {
    var i, x = v < 0 ? Math.pow(2, sz * 8) + v : v;
    if (!isFinite(v)) x = 0;
    for (i = 0; i < sz; i++) {
      segWrite(cpu, cpu.eaSeg, (cpu.ea + i) >>> 0, 1, x % 256);
      x = Math.floor(x / 256);
    }
  }

  function fpuMemReadFloat(cpu) {
    FU8F[0] = segRead(cpu, cpu.eaSeg, cpu.ea, 1);
    FU8F[1] = segRead(cpu, cpu.eaSeg, (cpu.ea + 1) >>> 0, 1);
    FU8F[2] = segRead(cpu, cpu.eaSeg, (cpu.ea + 2) >>> 0, 1);
    FU8F[3] = segRead(cpu, cpu.eaSeg, (cpu.ea + 3) >>> 0, 1);
    return FF32[0];
  }

  function fpuMemWriteFloat(cpu, val) {
    FF32[0] = val;
    segWrite(cpu, cpu.eaSeg, cpu.ea, 1, FU8F[0]);
    segWrite(cpu, cpu.eaSeg, (cpu.ea + 1) >>> 0, 1, FU8F[1]);
    segWrite(cpu, cpu.eaSeg, (cpu.ea + 2) >>> 0, 1, FU8F[2]);
    segWrite(cpu, cpu.eaSeg, (cpu.ea + 3) >>> 0, 1, FU8F[3]);
  }

  function fpuMemWriteDouble(cpu, v) {
    FBUF[0] = v;
    segWrite(cpu, cpu.eaSeg, cpu.ea, 4, FU32[0]);
    segWrite(cpu, cpu.eaSeg, (cpu.ea + 4) >>> 0, 4, FU32[1]);
  }

  function fpuMemReadDouble(cpu) {
    FU32[0] = segRead(cpu, cpu.eaSeg, cpu.ea, 4) >>> 0;
    FU32[1] = segRead(cpu, cpu.eaSeg, (cpu.ea + 4) >>> 0, 4) >>> 0;
    return FBUF[0];
  }

  function fpuMemReadN(cpu, off, sz) {
    var v = 0, i;
    for (i = sz - 1; i >= 0; i--) v = v * 256 + segRead(cpu, cpu.eaSeg, (cpu.ea + off + i) >>> 0, 1);
    return v;
  }

  function fpuMemReadExt(cpu) {
    var lo = fpuMemReadN(cpu, 0, 4);
    var hi = fpuMemReadN(cpu, 4, 4);
    var se = fpuMemReadN(cpu, 8, 2);
    return extToDouble(hi, lo, se);
  }

  function extToDouble(hi, lo, se) {
    var sign = (se & 0x8000) ? -1 : 1;
    var exp = se & 0x7FFF;
    var mant = hi * 4294967296 + lo;
    if (exp === 0x7FFF) {
      if (hi === 0x80000000 && lo === 0) return sign * Infinity;
      return NaN;
    }
    if (exp === 0 && mant === 0) return sign * 0;
    if (exp === 0) return sign * mant * Math.pow(2, -16382 - 63);
    return sign * mant * Math.pow(2, exp - 16383 - 63);
  }

  function fpuMemWriteExt(cpu, v) {
    var sign = 0;
    if (v < 0) { sign = 0x8000; v = -v; }
    if (v === 0) {
      segWrite(cpu, cpu.eaSeg, cpu.ea, 4, 0);
      segWrite(cpu, cpu.eaSeg, (cpu.ea + 4) >>> 0, 4, 0);
      segWrite(cpu, cpu.eaSeg, (cpu.ea + 8) >>> 0, 2, sign);
      return;
    }
    if (!isFinite(v)) {
      segWrite(cpu, cpu.eaSeg, cpu.ea, 4, 0);
      segWrite(cpu, cpu.eaSeg, (cpu.ea + 4) >>> 0, 4, 0x80000000);
      segWrite(cpu, cpu.eaSeg, (cpu.ea + 8) >>> 0, 2, sign | 0x7FFF);
      return;
    }
    var e = Math.floor(Math.log(v) / Math.LN2);
    var mant = v / Math.pow(2, e);
    while (mant >= 2) { mant /= 2; e++; }
    while (mant < 1) { mant *= 2; e--; }
    var hi = Math.floor(mant * 2147483648);
    var lo = Math.round((mant * 2147483648 - hi) * 4294967296);
    if (lo >= 4294967296) { lo -= 4294967296; hi += 1; }
    segWrite(cpu, cpu.eaSeg, cpu.ea, 4, lo >>> 0);
    segWrite(cpu, cpu.eaSeg, (cpu.ea + 4) >>> 0, 4, hi >>> 0);
    segWrite(cpu, cpu.eaSeg, (cpu.ea + 8) >>> 0, 2, (sign | (e + 16383)) & 0xFFFF);
  }

  CPU.prototype.fpuOp = function (op) {
    var b = this.fetch8();
    var mod = b >> 6, reg = (b >> 3) & 7, rm = b & 7;
    if (mod === 3) {
      this.fpuRegForm(op, reg, rm);
      return;
    }
    this.eip = (this.eip - 1) >>> 0;
    this.modrm();
    this.fpuMemForm(op, this.reg);
  };

  CPU.prototype.fpuMemForm = function (op, reg) {
    var v;
    switch (op) {
      case 0xD8:
        v = fpuMemReadFloat(this);
        switch (reg) {
          case 0: stSet(this, 0, st(this, 0) + v); return;
          case 1: stSet(this, 0, st(this, 0) * v); return;
          case 2: fcompare(this, st(this, 0), v); return;
          case 3: fcompare(this, st(this, 0), v); fpuPop(this); return;
          case 4: stSet(this, 0, st(this, 0) - v); return;
          case 5: stSet(this, 0, v - st(this, 0)); return;
          case 6: stSet(this, 0, st(this, 0) / v); return;
          default: stSet(this, 0, v / st(this, 0)); return;
        }
      case 0xD9:
        switch (reg) {
          case 0: fpuPush(this, fpuMemReadFloat(this)); return;
          case 2: fpuMemWriteFloat(this, st(this, 0)); return;
          case 3: fpuMemWriteFloat(this, st(this, 0)); fpuPop(this); return;
          case 4: this.fcw = segRead(this, this.eaSeg, this.ea, 2); return;
          case 5: this.fcw = segRead(this, this.eaSeg, this.ea, 2); return;
          case 6: {
            var envSz = this.o32 ? 28 : 14;
            segWrite(this, this.eaSeg, this.ea, 2, this.fcw);
            segWrite(this, this.eaSeg, (this.ea + 2) >>> 0, 2, fswTop(this));
            segWrite(this, this.eaSeg, (this.ea + 4) >>> 0, 2, ftagWord(this));
            for (var ei = 6; ei < envSz; ei += 2) segWrite(this, this.eaSeg, (this.ea + ei) >>> 0, 2, 0);
            return;
          }
          case 7: segWrite(this, this.eaSeg, this.ea, 2, this.fcw); return;
          default: fault(this, 6, 0);
        }
        return;
      case 0xDA: case 0xDE: {
        var m16 = op === 0xDE;
        v = m16 ? sval(fpuMemRead(this, 2), 2) : sval(fpuMemRead(this, 4), 4);
        switch (reg) {
          case 0: stSet(this, 0, st(this, 0) + v); return;
          case 1: stSet(this, 0, st(this, 0) * v); return;
          case 2: fcompare(this, st(this, 0), v); return;
          case 3: fcompare(this, st(this, 0), v); fpuPop(this); return;
          case 4: stSet(this, 0, st(this, 0) - v); return;
          case 5: stSet(this, 0, v - st(this, 0)); return;
          case 6: stSet(this, 0, st(this, 0) / v); return;
          default: stSet(this, 0, v / st(this, 0)); return;
        }
      }
      case 0xDB:
        switch (reg) {
          case 0: fpuPush(this, sval(fpuMemRead(this, 4), 4)); return;
          case 1: fpuMemWriteInt(this, 4, fround(this, st(this, 0))); return;
          case 2: fpuMemWriteInt(this, 4, fround(this, st(this, 0))); return;
          case 3: fpuMemWriteInt(this, 4, fround(this, st(this, 0))); fpuPop(this); return;
          case 5: fpuPush(this, fpuMemReadExt(this)); return;
          case 7: fpuMemWriteExt(this, st(this, 0)); fpuPop(this); return;
          default: fault(this, 6, 0);
        }
        return;
      case 0xDC:
        v = fpuMemReadDouble(this);
        switch (reg) {
          case 0: stSet(this, 0, st(this, 0) + v); return;
          case 1: stSet(this, 0, st(this, 0) * v); return;
          case 2: fcompare(this, st(this, 0), v); return;
          case 3: fcompare(this, st(this, 0), v); fpuPop(this); return;
          case 4: stSet(this, 0, st(this, 0) - v); return;
          case 5: stSet(this, 0, v - st(this, 0)); return;
          case 6: stSet(this, 0, st(this, 0) / v); return;
          default: stSet(this, 0, v / st(this, 0)); return;
        }
      case 0xDD:
        switch (reg) {
          case 0: fpuPush(this, fpuMemReadDouble(this)); return;
          case 2: fpuMemWriteDouble(this, st(this, 0)); return;
          case 3: fpuMemWriteDouble(this, st(this, 0)); fpuPop(this); return;
          case 7: segWrite(this, this.eaSeg, this.ea, 2, fswTop(this)); return;
          default: fault(this, 6, 0);
        }
        return;
      case 0xDF:
        switch (reg) {
          case 0: fpuPush(this, sval(fpuMemRead(this, 2), 2)); return;
          case 2: fpuMemWriteInt(this, 2, fround(this, st(this, 0))); return;
          case 3: fpuMemWriteInt(this, 2, fround(this, st(this, 0))); fpuPop(this); return;
          case 5: {
            var i64lo = fpuMemReadN(this, 0, 4) >>> 0;
            var i64hi = fpuMemReadN(this, 4, 4) | 0;
            var i64 = i64hi * 4294967296 + i64lo;
            fpuPush(this, i64);
            return;
          }
          case 7:
            fpuMemWriteInt(this, 8, fround(this, st(this, 0)));
            fpuPop(this);
            return;
          default: fault(this, 6, 0);
        }
        return;
      default:
        fault(this, 6, 0);
    }
  };

  CPU.prototype.fpuRegForm = function (op, reg, rm) {
    var a, b, v, i;
    if (op === 0xD8) {
      a = st(this, 0); b = st(this, rm);
      switch (reg) {
        case 0: stSet(this, 0, a + b); return;
        case 1: stSet(this, 0, a * b); return;
        case 2: fcompare(this, a, b); return;
        case 3: fcompare(this, a, b); fpuPop(this); return;
        case 4: stSet(this, 0, a - b); return;
        case 5: stSet(this, 0, b - a); return;
        case 6: stSet(this, 0, a / b); return;
        default: stSet(this, 0, b / a); return;
      }
    }
    if (op === 0xDC) {
      a = st(this, 0); b = st(this, rm);
      switch (reg) {
        case 0: stSet(this, rm, b + a); return;
        case 1: stSet(this, rm, b * a); return;
        case 2: fcompare(this, b, a); return;
        case 3: fcompare(this, b, a); fpuPop(this); return;
        case 4: stSet(this, rm, b - a); return;
        case 5: stSet(this, rm, a - b); return;
        case 6: stSet(this, rm, b / a); return;
        default: stSet(this, rm, a / b); return;
      }
    }
    if (op === 0xDE) {
      if (reg === 3 && (rm === 1)) { fcompare(this, st(this, 0), st(this, 1)); fpuPop(this); fpuPop(this); return; }
      a = st(this, 0); b = st(this, rm);
      switch (reg) {
        case 0: stSet(this, rm, b + a); fpuPop(this); return;
        case 1: stSet(this, rm, b * a); fpuPop(this); return;
        case 2: fcompare(this, b, a); fpuPop(this); fpuPop(this); return;
        case 4: stSet(this, rm, b - a); fpuPop(this); return;
        case 5: stSet(this, rm, a - b); fpuPop(this); return;
        case 6: stSet(this, rm, b / a); fpuPop(this); return;
        case 7: stSet(this, rm, a / b); fpuPop(this); return;
        default: fault(this, 6, 0);
      }
      return;
    }
    if (op === 0xD9) {
      if (reg === 0) { fpuPush(this, st(this, rm)); return; }
      if (reg === 1) {
        if (rm === 0) return;
        v = st(this, rm);
        stSet(this, rm, st(this, 0));
        stSet(this, 0, v);
        fsetC(this, 0, 0, 0, 0);
        return;
      }
      if (reg === 2) {
        if (rm !== 0) fault(this, 6, 0);
        return;
      }
      if (reg === 3) { fpuPop(this); return; }
      if (reg === 4) {
        switch (rm) {
          case 0: stSet(this, 0, -st(this, 0)); return;
          case 1: stSet(this, 0, Math.abs(st(this, 0))); return;
          case 4: fcompare(this, st(this, 0), 0); return;
          case 5: {
            var xx = st(this, 0);
            if (isNaN(xx)) fsetC(this, 0, 1, 0, 0);
            else if (isFinite(xx)) fsetC(this, 0, xx < 0 ? 1 : 0, 0, 0);
            else fsetC(this, 0, xx < 0 ? 1 : 0, 1, 0);
            return;
          }
          default: fault(this, 6, 0);
        }
      }
      if (reg === 5) {
        switch (rm) {
          case 0: fpuPush(this, 1); return;
          case 1: fpuPush(this, 3.32192809488736234787); return;
          case 2: fpuPush(this, 1.44269504088896340736); return;
          case 3: fpuPush(this, Math.PI); return;
          case 4: fpuPush(this, 0.30102999566398119521); return;
          case 5: fpuPush(this, 0.69314718055994530942); return;
          case 6: fpuPush(this, 0); return;
          default: fault(this, 6, 0);
        }
        return;
      }
      if (reg === 6) {
        switch (rm) {
          case 0: stSet(this, 0, Math.pow(2, st(this, 0)) - 1); return;
          case 1: {
            var ly = st(this, 1), lx = st(this, 0);
            stSet(this, 1, lx > 0 ? ly * Math.log(lx) / Math.LN2 : NaN);
            fpuPop(this);
            return;
          }
          case 2: stSet(this, 0, Math.tan(st(this, 0))); fpuPush(this, 1); return;
          case 3: {
            var pa = st(this, 1), pb = st(this, 0);
            stSet(this, 1, Math.atan2(pa, pb));
            fpuPop(this);
            return;
          }
          case 4: return;
          case 5: {
            var r1 = st(this, 0), r2 = st(this, 1);
            if (r2 !== 0) stSet(this, 0, r1 - Math.round(r1 / r2) * r2);
            return;
          }
          case 6: this.ftop = (this.ftop + 1) & 7; return;
          default: this.ftop = (this.ftop - 1) & 7; return;
        }
      }
      switch (rm) {
        case 0: {
          var q1 = st(this, 0), q2 = st(this, 1);
          if (q2 !== 0) stSet(this, 0, q1 - Math.trunc(q1 / q2) * q2);
          return;
        }
        case 1: return;
        case 2: stSet(this, 0, Math.sqrt(st(this, 0))); return;
        case 3: return;
        case 4: stSet(this, 0, fround(this, st(this, 0))); return;
        case 5: stSet(this, 0, st(this, 0) * Math.pow(2, Math.trunc(st(this, 1)))); return;
        case 6: stSet(this, 0, Math.sin(st(this, 0))); return;
        default: stSet(this, 0, Math.cos(st(this, 0))); return;
      }
    }
    if (op === 0xDD) {
      switch (reg) {
        case 0: this.ftag[(this.ftop + rm) & 7] = 3; return;
        case 2: stSet(this, rm, st(this, 0)); return;
        case 3: stSet(this, rm, st(this, 0)); fpuPop(this); return;
        case 4: fcompare(this, st(this, 0), st(this, rm)); return;
        case 5: fcompare(this, st(this, 0), st(this, rm)); fpuPop(this); return;
        default: fault(this, 6, 0);
      }
      return;
    }
    if (op === 0xDA) {
      if (reg === 5 && rm === 1) { fcompare(this, st(this, 0), st(this, 1)); fpuPop(this); fpuPop(this); return; }
      fault(this, 6, 0);
      return;
    }
    if (op === 0xDB) {
      var t = (reg << 3) | rm;
      switch (t) {
        case 0x20: case 0x21: case 0x24: case 0x25: return;
        case 0x22: this.fsw = 0; return;
        case 0x23: this.fpuReset(); return;
        case 0x28: case 0x29: case 0x2A: case 0x2B:
        case 0x2C: case 0x2D: case 0x2E: case 0x2F:
          fcompare(this, st(this, 0), st(this, rm));
          this.eflags = (this.eflags & ~(ZF | PF | CF)) |
            ((this.fsw & 0x4000) ? ZF : 0) |
            ((this.fsw & 0x0100) ? CF : 0) |
            ((this.fsw & 0x0400) ? PF : 0);
          if (t >= 0x2C) fpuPop(this);
          return;
        case 0x30: case 0x31: case 0x32: case 0x33:
        case 0x34: case 0x35: case 0x36: case 0x37:
          fcompare(this, st(this, 0), st(this, rm));
          this.eflags = (this.eflags & ~(ZF | PF | CF)) |
            ((this.fsw & 0x4000) ? ZF : 0) |
            ((this.fsw & 0x0100) ? CF : 0) |
            ((this.fsw & 0x0400) ? PF : 0);
          return;
        default: fault(this, 6, 0);
      }
      return;
    }
    if (op === 0xDF) {
      if (reg === 4 && rm === 0) {
        wrReg(this, 0, fswTop(this), 2);
        return;
      }
      fault(this, 6, 0);
      return;
    }
    fault(this, 6, 0);
  };

  /* --------------------------------------------------------- public API -- */

  var REGMAP = (function () {
    var m = {}, i;
    for (i = 0; i < 8; i++) {
      m[REG32[i]] = { i: i, s: 4 };
      m[REG16[i]] = { i: i, s: 2 };
      m[REG8[i]] = { i: i, s: 1 };
    }
    return m;
  })();

  CPU.prototype.getReg = function (name) {
    var n = String(name).toLowerCase();
    if (n === 'eip') return this.eip >>> 0;
    if (n === 'ip') return this.eip & 0xFFFF;
    if (n === 'eflags' || n === 'flags') return this.eflags >>> 0;
    if (n === 'cr0') return this.cr0 >>> 0;
    if (n === 'cr2') return this.cr2 >>> 0;
    if (n === 'cr3') return this.cr3 >>> 0;
    if (n === 'cr4') return this.cr4 >>> 0;
    var r = REGMAP[n];
    if (r) return rdReg(this, r.i, r.s);
    var si = segIndex(n);
    if (si >= 0) return this.segs[si].sel;
    throw new Error('unknown register: ' + name);
  };

  CPU.prototype.setReg = function (name, value) {
    var n = String(name).toLowerCase();
    var v = value | 0;
    if (n === 'eip') { this.eip = v >>> 0; return; }
    if (n === 'ip') { this.eip = (this.eip & 0xFFFF0000) | (v & 0xFFFF); return; }
    if (n === 'eflags' || n === 'flags') { this.eflags = (v | 2) >>> 0; this.refreshFlags(); return; }
    if (n === 'cr0') { writeCR(this, 0, v); return; }
    if (n === 'cr2') { this.cr2 = v >>> 0; return; }
    if (n === 'cr3') { writeCR(this, 3, v); return; }
    if (n === 'cr4') { writeCR(this, 4, v); return; }
    var r = REGMAP[n];
    if (r) { wrReg(this, r.i, v, r.s); return; }
    var si = segIndex(n);
    if (si >= 0) { this.setSeg(si, v & 0xFFFF); return; }
    throw new Error('unknown register: ' + name);
  };

  CPU.prototype.getFlag = function (name) {
    var n = String(name).toLowerCase();
    if (n === 'iopl') return (this.eflags >> 12) & 3;
    var b = FLAGBIT[n];
    if (b === undefined) throw new Error('unknown flag: ' + name);
    return (this.eflags & b) ? 1 : 0;
  };

  CPU.prototype.setFlag = function (name, v) {
    var n = String(name).toLowerCase();
    if (n === 'iopl') {
      this.eflags = (this.eflags & ~IOPL) | ((v & 3) << 12);
      this.refreshFlags();
      return;
    }
    var b = FLAGBIT[n];
    if (b === undefined) throw new Error('unknown flag: ' + name);
    if (v) this.eflags |= b; else this.eflags &= ~b;
    this.eflags |= 2;
    this.refreshFlags();
  };

  CPU.prototype.getSeg = function (reg) {
    var i = segIndex(reg);
    if (i < 0) throw new Error('unknown segment: ' + reg);
    return this.segs[i];
  };

  CPU.prototype.getCR = function (i) {
    if (i < 0 || i > 4) throw new Error('bad control register: ' + i);
    if (i === 0) return this.cr0 >>> 0;
    if (i === 2) return this.cr2 >>> 0;
    if (i === 3) return this.cr3 >>> 0;
    if (i === 4) return this.cr4 >>> 0;
    return 0;
  };

  CPU.prototype.setCR = function (i, v) {
    if (i < 0 || i > 4) throw new Error('bad control register: ' + i);
    if (i === 1) return;
    if (this.inStep) { writeCR(this, i, v); return; }
    try {
      writeCR(this, i, v);
    } catch (e) {
      if (e === this.faultInfo) throw faultError(e);
      throw e;
    }
  };

  CPU.prototype.getDR = function (i) {
    if (i < 0 || i > 7) throw new Error('bad debug register: ' + i);
    return this.dr[i] >>> 0;
  };

  CPU.prototype.setDR = function (i, v) {
    if (i < 0 || i > 7) throw new Error('bad debug register: ' + i);
    this.dr[i] = v | 0;
  };

  Object.defineProperty(CPU.prototype, 'eax', {
    get: function () { return this.r[0] >>> 0; }, set: function (v) { this.r[0] = v | 0; }
  });
  Object.defineProperty(CPU.prototype, 'ecx', {
    get: function () { return this.r[1] >>> 0; }, set: function (v) { this.r[1] = v | 0; }
  });
  Object.defineProperty(CPU.prototype, 'edx', {
    get: function () { return this.r[2] >>> 0; }, set: function (v) { this.r[2] = v | 0; }
  });
  Object.defineProperty(CPU.prototype, 'ebx', {
    get: function () { return this.r[3] >>> 0; }, set: function (v) { this.r[3] = v | 0; }
  });
  Object.defineProperty(CPU.prototype, 'esp', {
    get: function () { return this.r[4] >>> 0; }, set: function (v) { this.r[4] = v | 0; }
  });
  Object.defineProperty(CPU.prototype, 'ebp', {
    get: function () { return this.r[5] >>> 0; }, set: function (v) { this.r[5] = v | 0; }
  });
  Object.defineProperty(CPU.prototype, 'esi', {
    get: function () { return this.r[6] >>> 0; }, set: function (v) { this.r[6] = v | 0; }
  });
  Object.defineProperty(CPU.prototype, 'edi', {
    get: function () { return this.r[7] >>> 0; }, set: function (v) { this.r[7] = v | 0; }
  });
  Object.defineProperty(CPU.prototype, 'cs', { get: function () { return this.segs[CS]; } });
  Object.defineProperty(CPU.prototype, 'ds', { get: function () { return this.segs[DS]; } });
  Object.defineProperty(CPU.prototype, 'es', { get: function () { return this.segs[ES]; } });
  Object.defineProperty(CPU.prototype, 'fs', { get: function () { return this.segs[FS]; } });
  Object.defineProperty(CPU.prototype, 'gs', { get: function () { return this.segs[GS]; } });
  Object.defineProperty(CPU.prototype, 'ss', { get: function () { return this.segs[SS]; } });


  return { CPU: CPU };
});
