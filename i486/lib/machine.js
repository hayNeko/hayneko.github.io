'use strict';

/* HY486 machine: bus + devices + CPU + self-written BIOS ROM. Runs headless in
   Node; only vga.render(canvas) needs a DOM and that belongs to the UI.

   halt() is a hard stop: run(), step() and runUntil() execute nothing until
   resume() clears it, while the CPU state (including a CPU parked in HLT) is
   left untouched. */


(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BIOS_BASE = 0xF0000;
  var FLAT_GDT = 0x9800;          /* 24 bytes of scratch RAM below the EBDA */
  var CYCLE_BATCH = 64;           /* PIT is advanced in batches, not per instruction */
  var REAL_CR0 = 0x00000010;      /* ET only: real mode, paging off */
  var PROT_CR0 = 0x00000011;      /* PE | ET */

  var biosCache = null;

  function globals() {
    return typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
  }

  function sibling(name) {
    var ns = globals().I486;
    return ns ? ns[name] : undefined;
  }

  function need(name) {
    var mod = sibling(name);
    if (!mod) throw new Error('I486.' + name + ' is not loaded; require the module first');
    return mod;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data && data.buffer instanceof ArrayBuffer) return new Uint8Array(data.buffer, data.byteOffset, data.length);
    if (Array.isArray(data)) return Uint8Array.from(data);
    throw new Error('expected a byte array');
  }

  function romError(built) {
    if (built && built.errors && built.errors.length) {
      return built.errors.slice(0, 4).map(function (e) {
        return 'line ' + e.line + ': ' + e.message;
      }).join('; ');
    }
    return 'no bytes';
  }

  /* The ROM image is identical for every machine, so assemble it once. */
  function buildRom() {
    if (biosCache) return biosCache;
    var built = need('BIOS').build(need('Assembler'));
    if (!built || !built.bytes || !built.bytes.length) {
      throw new Error('BIOS assembly failed: ' + romError(built));
    }
    biosCache = built;
    return built;
  }

  /* Assemble a caller supplied BIOS source (contract option { bios: source }). */
  function buildRomFrom(source) {
    var assembler = need('Assembler');
    var origin = 0xF0000;
    var built = assembler.assemble(source, { bits: 16, origin: origin });
    if (!built || built.ok !== true || !built.bytes || !built.bytes.length) {
      throw new Error('BIOS assembly failed: ' + romError(built));
    }
    return { ok: true, bytes: built.bytes, symbols: built.symbols, errors: built.errors, listing: built.listing, origin: origin };
  }

  /* ------------------------------------------------------------- machine -- */

  function Machine(opts) {
    opts = opts || {};
    var ramMB = opts.ramMB === undefined ? 32 : opts.ramMB;
    if (!(ramMB > 0)) ramMB = 32;

    var Bus = need('Bus');
    var Devices = need('Devices');
    var CPU = need('CPU');

    this.ramMB = ramMB;
    this.bus = new Bus({ ramMB: ramMB });
    this.cpu = new CPU(this.bus);
    if (opts.rom) this.rom = opts.rom;
    else if (typeof opts.bios === 'string' && opts.bios !== need('BIOS').source) this.rom = buildRomFrom(opts.bios);
    else this.rom = buildRom();

    this.instructions = 0;
    this.onFault = null;
    this.onScreen = null;
    this.onSerial = null;

    var self = this;
    this.host = {
      onIrq: function (line) { if (typeof self.onIrq === 'function') self.onIrq(line); },
      onScreen: function () { if (typeof self.onScreen === 'function') self.onScreen(self.dev.vga); },
      onVideoMode: function (mode) { self.videoModeChanges++; },
      onSerial: function (ch) { if (typeof self.onSerial === 'function') self.onSerial(ch); },
      onReset: function () { self.reboot(); }
    };
    this.dev = Devices.install(this.bus, this.host);
    this.pic = this.dev.pic;
    this.pit = this.dev.pit;
    this.keyboard = this.dev.keyboard;
    this.cmos = this.dev.cmos;
    this.vga = this.dev.vga;
    this.ata = this.dev.ata;
    this.serial = this.dev.serial;

    this._pendingVector = -1;
    this._cycleAcc = 0;
    this._diskImage = null;
    this._lastFaultKey = '';
    this._lastCpuError = null;
    this._stopped = false;
    this.videoModeChanges = 0;

    this.powerOn();
  }

  Object.defineProperty(Machine.prototype, 'screen', {
    get: function () { return this.vga; }
  });

  Object.defineProperty(Machine.prototype, 'disk', {
    get: function () { return this.ata.image; }
  });

  Object.defineProperty(Machine.prototype, 'halted', {
    get: function () { return this.cpu.halted; }
  });

  Machine.prototype.powerOn = function () {
    this.bus.ram.fill(0);
    this.bus.reset();
    this.dev.reset();
    this.bus.setROM(BIOS_BASE, this.rom.bytes);
    if (this._diskImage) this.ata.setImage(this._diskImage);
    this.cpu.reset();
    this.instructions = 0;
    this._pendingVector = -1;
    this._cycleAcc = 0;
    this._lastFaultKey = '';
    this._stopped = false;
    this.videoModeChanges = 0;
    return this;
  };

  /* A warm reboot keeps RAM but restarts POST from the reset vector. */
  Machine.prototype.reboot = function () {
    this.dev.reset();
    this.bus.setROM(BIOS_BASE, this.rom.bytes);
    if (this._diskImage) this.ata.setImage(this._diskImage);
    this.cpu.reset();
    this.instructions = 0;
    this._pendingVector = -1;
    this._cycleAcc = 0;
    this._lastFaultKey = '';
    this._stopped = false;
    return this;
  };

  Machine.prototype.boot = function () {
    return this.reboot();
  };

  /* Freeze the machine: run() and step() refuse to execute anything until
     resume() is called, so a UI stop button cannot be outrun by a step-based
     loop.  The CPU, PIC and PIT are left exactly as they are. */
  Machine.prototype.halt = function () {
    this._stopped = true;
    return this;
  };

  /* Release a halt().  cpu.halted is deliberately not touched: a CPU sitting in
     HLT stays there until an interrupt arrives, exactly like real hardware. */
  Machine.prototype.resume = function () {
    this._stopped = false;
    return this;
  };

  Machine.prototype.loadDiskImage = function (bytes) {
    var u8 = toBytes(bytes);
    this._diskImage = u8;
    this.ata.setImage(u8);
    return this.ata;
  };

  Machine.prototype.serialOutput = function () {
    return this.serial.output;
  };

  Machine.prototype.setKey = function (scancode, down) {
    scancode = scancode & 0x7F;
    if (down === false) this.keyboard.release(scancode);
    else this.keyboard.press(scancode);
    return this;
  };

  /* --------------------------------------------------------- interrupts -- */

  /* Deliver one acked vector. A shadowed or IF=0 interrupt is not lost: the
     vector stays queued and is retried at the next instruction boundary. */
  Machine.prototype._deliver = function (vec) {
    try {
      return this.cpu.serviceInterrupt(vec) === true;
    } catch (err) {
      this._lastCpuError = err;
      return true;
    }
  };

  Machine.prototype._pumpIrq = function () {
    var cpu = this.cpu;
    if (cpu.tripleFault) return;
    if (this._pendingVector >= 0) {
      if (this._deliver(this._pendingVector)) this._pendingVector = -1;
      return;
    }
    if (!(cpu.halted || cpu.canInterrupt())) return;
    /* The 8042 asserts IRQ1 once per byte.  The 8259 runs edge triggered here,
       so a byte that is still queued after the previous one was read needs a
       fresh edge or it would sit in the controller forever. */
    if (this.keyboard.pending() > 0) this.pic.request(1);
    var vec = this.pic.ack();
    if (vec === null) return;
    if (!this._deliver(vec)) this._pendingVector = vec;
  };

  /* ---------------------------------------------------------- execution -- */

  Machine.prototype.step = function () {
    var cpu = this.cpu;
    if (this._stopped) return 0;
    if (cpu.tripleFault) {
      this._reportFault();
      return 0;
    }
    this._pumpIrq();
    var cycles = cpu.step();
    this.instructions++;
    this._cycleAcc += cycles;
    if (this._cycleAcc >= CYCLE_BATCH) {
      this.pit.advance(this._cycleAcc);
      this._cycleAcc = 0;
    }
    if (cpu.tripleFault) this._reportFault();
    else this._reportException();
    return cycles;
  };

  Machine.prototype.run = function (n) {
    var executed = 0;
    n = n | 0;
    while (executed < n) {
      if (this.cpu.tripleFault || this._stopped) break;
      this.step();
      executed++;
    }
    return executed;
  };

  Machine.prototype.runUntil = function (addr, maxSteps) {
    var limit = maxSteps === undefined ? 2000000 : maxSteps;
    addr = addr >>> 0;
    for (var i = 0; i < limit; i++) {
      if (this._stopped || this.cpu.tripleFault) return 'halt';
      this.step();
      if (this._atAddress(addr)) return 'hit';
      if (this.cpu.halted || this.cpu.tripleFault) return 'halt';
    }
    return 'limit';
  };

  Machine.prototype._atAddress = function (addr) {
    var cpu = this.cpu;
    if ((cpu.eip >>> 0) === addr) return true;
    return (((cpu.cs.base + cpu.eip) >>> 0) === addr);
  };

  Machine.prototype._reportFault = function () {
    if (typeof this.onFault !== 'function') return;
    var key = 'triple';
    if (key === this._lastFaultKey) return;
    this._lastFaultKey = key;
    var ex = this.cpu.lastException;
    this.onFault({ tripleFault: true, vector: ex ? ex.vector : 8, errorCode: ex ? ex.errorCode : 0, eip: this.cpu.eip });
  };

  Machine.prototype._reportException = function () {
    var ex = this.cpu.lastException;
    if (!ex || typeof this.onFault !== 'function') return;
    var key = ex.vector + ':' + ex.eip;
    if (key === this._lastFaultKey) return;
    this._lastFaultKey = key;
    this.onFault({ tripleFault: false, vector: ex.vector, errorCode: ex.errorCode, eip: ex.eip });
  };

  /* ------------------------------------------------------------ programs -- */

  Machine.prototype._enterReal = function () {
    var cpu = this.cpu;
    cpu.setReg('cr0', REAL_CR0);
    cpu.setReg('cs', 0);
    cpu.setReg('ds', 0);
    cpu.setReg('es', 0);
    cpu.setReg('ss', 0);
    cpu.setReg('fs', 0);
    cpu.setReg('gs', 0);
  };

  /* Null, 32-bit code at 0x08 and 32-bit data at 0x10, both flat. */
  Machine.prototype._writeFlatGdt = function () {
    var words = [0x00000000, 0x00000000, 0x0000FFFF, 0x00CF9A00,
      0x0000FFFF, 0x00CF9200, 0x00000000, 0x00000000];
    for (var i = 0; i < words.length; i++) {
      this.bus.write32(FLAT_GDT + i * 4, words[i]);
    }
  };

  /* A program that takes over the machine has to start from an unhalted CPU:
     POST leaves the ROM monitor blocked inside INT 16h's HLT. */
  Machine.prototype._releaseProcessor = function () {
    this.cpu.halted = false;
    this.cpu.tripleFault = false;
    this.cpu.intShadow = 0;
    this._pendingVector = -1;
    this._lastFaultKey = '';
    this._stopped = false;
    this.instructions = 0;
    return this;
  };

  Machine.prototype.loadProgram = function (bytes, opts) {
    opts = opts || {};
    var mode = opts.mode || 'com16';
    var u8 = toBytes(bytes);
    var cpu = this.cpu;
    var info = { mode: mode, length: u8.length };
    this._releaseProcessor();

    if (mode === 'flat32') {
      var flatOrg = opts.org === undefined ? 0x100000 : (opts.org >>> 0);
      this.bus.setBytes(flatOrg, u8);
      this._writeFlatGdt();
      cpu.gdtr.base = FLAT_GDT;
      cpu.gdtr.limit = 0x17;
      cpu.setReg('cr0', PROT_CR0);
      cpu.setReg('cs', 0x08);
      cpu.setReg('ds', 0x10);
      cpu.setReg('es', 0x10);
      cpu.setReg('ss', 0x10);
      cpu.setReg('fs', 0x10);
      cpu.setReg('gs', 0x10);
      var sp = opts.stack === undefined ? 0x00100100 : opts.stack;
      cpu.setReg('esp', sp);
      cpu.setReg('ebp', 0);
      cpu.setReg('eip', flatOrg);
      cpu.setReg('eflags', 0x00000002);
      info.org = flatOrg;
      info.entry = flatOrg;
      info.bits = 32;
      return info;
    }

    this._enterReal();
    cpu.setReg('eax', 0); cpu.setReg('ebx', 0); cpu.setReg('ecx', 0); cpu.setReg('edx', 0);
    cpu.setReg('esi', 0); cpu.setReg('edi', 0); cpu.setReg('ebp', 0);

    if (mode === 'boot16') {
      var bootOrg = opts.org === undefined ? 0x7C00 : (opts.org >>> 0);
      this.bus.setBytes(bootOrg, u8);
      cpu.setReg('ss', 0);
      cpu.setReg('esp', 0x7C00);
      cpu.setReg('eip', bootOrg);
      cpu.setReg('eflags', 0x0202);
      info.org = bootOrg;
      info.entry = bootOrg;
      info.bits = 16;
      return info;
    }

    if (mode !== 'com16') throw new Error('unknown loadProgram mode: ' + mode);
    var org = opts.org === undefined ? 0x100 : (opts.org >>> 0);
    this.bus.setBytes(org, u8);
    cpu.setReg('esp', 0xFFFE);
    cpu.setReg('eip', org);
    cpu.setReg('eflags', 0x0202);
    info.org = org;
    info.entry = org;
    info.bits = 16;
    return info;
  };

  /* --------------------------------------------------------------- state -- */

  Machine.prototype.state = function () {
    var cpu = this.cpu;
    var pe = (cpu.cr0 & 1) !== 0;
    var mode = pe ? (((cpu.eflags & 0x00020000) !== 0) ? 'v86' : 'protected') : 'real';
    var ex = cpu.lastException;
    return {
      mode: mode,
      eip: cpu.eip >>> 0,
      cs: cpu.cs.sel & 0xFFFF,
      csBase: cpu.cs.base >>> 0,
      ds: cpu.getReg('ds'),
      ss: cpu.getReg('ss'),
      sp: cpu.getReg('sp'),
      eflags: cpu.eflags >>> 0,
      if: (cpu.eflags & 0x200) !== 0,
      halted: cpu.halted === true,
      stopped: this._stopped === true,
      tripleFault: cpu.tripleFault === true,
      cycles: cpu.cycles >>> 0,
      instructions: this.instructions,
      cr0: cpu.cr0 >>> 0,
      pe: pe,
      videoMode: this.vga.mode,
      diskSectors: this.ata.sectors,
      pendingVector: this._pendingVector,
      lastException: ex ? { vector: ex.vector, errorCode: ex.errorCode, eip: ex.eip } : null,
      linear: (cpu.cs.base + cpu.eip) >>> 0
    };
  };

  Machine.prototype.getScreenText = function () {
    return this.vga.getScreenText();
  };

  return { Machine: Machine };
});
