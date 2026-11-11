(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * i486DX PC device model: 8259A PIC pair, 8254 PIT, 8042 keyboard controller,
   * CMOS/RTC, VGA (mode 3 + mode 13h), ATA PIO master disk, 16550A serial,
   * 8237 DMA register model, 8272A floppy stub, port 0x92 A20/fast reset.
   *
   * MEMORY MAP
   *   0x00000000-0x0009FFFF  base RAM
   *   0x000A0000-0x000AFFFF  VGA graphics memory (mode 13h: 320x200 linear at 0xA0000;
   *                          mode 3: unused plane, reads 0x00)
   *   0x000B0000-0x000B7FFF  VGA monochrome window, not aliased here (reads 0x00)
   *   0x000B8000-0x000B8F9F  VGA text buffer, one word per cell (attr<<8 | char)
   *   0x000B9000-0x000BFFFF  remainder of the VGA aperture (reads 0x00)
   *   0x000C0000-0x000EFFFF  open bus (option ROM space, reads 0xFF)
   *   0x000F0000-0x000FFFFF  BIOS ROM (set by machine.js through bus.setROM)
   *   0xFFFFFFF0-0xFFFFFFFF  reset-vector alias of the top 16 ROM bytes
   *
   * PORT MAP
   *   0x0000-0x000F  8237 DMA channel 0-3 address/count, status, mask, mode
   *   0x0020/0x0021  8259A master: command port / data port (ICW2-4, OCW1)
   *   0x0040-0x0043  8254 PIT: counters 0-2 / mode-control (mode 3 latch command)
   *   0x0060/0x0064  8042 data port / status (read) + command (write)
   *   0x0070/0x0071  CMOS index (bit 7 = NMI disable) / CMOS data
   *   0x0080-0x008F  8237 DMA page registers (0x81 = floppy channel 2 page)
   *   0x0092         system control A: bit 0 fast reset, bit 1 A20 gate
   *   0x00A0/0x00A1  8259A slave
   *   0x00C0-0x00DF  8237 second controller: not modelled, open bus
   *   0x01F0-0x01F7  ATA primary command block (PIO), 0x1F0 is the 16-bit data port
   *   0x03C0/0x03C1  VGA attribute controller index+data / data read
   *   0x03C2/0x03CC  VGA miscellaneous output (write) / read
   *   0x03C4/0x03C5  VGA sequencer index/data
   *   0x03C6-0x03C9  VGA DAC pixel mask / read index / write index / data
   *   0x03CE/0x03CF  VGA graphics controller index/data
   *   0x03D4/0x03D5  VGA CRTC index/data (cursor 0x0A-0x0F, start address 0x0C/0x0D)
   *   0x03DA         VGA input status register 1 (display-enable / retrace polling)
   *   0x03F0-0x03F5  8272A floppy controller (register-compatible stub, no drive)
   *   0x03F6         ATA alternate status (read) / device control (write)
   *   0x03F7         8272A configuration control register (DIR/CCR)
   *   0x03F8-0x03FF  16550A COM1: RBR/THR/DLL, IER/DLM, IIR/FCR, LCR, MCR, LSR, MSR, SCR
   *   0x00CF8-0x00CFF PCI configuration: not a 486 feature, reads 0xFF
   *
   * IRQ MAP: 0 PIT, 1 keyboard, 2 cascade to slave, 4 COM1, 6 floppy, 14 ATA.
   * The RTC periodic/alarm interrupt (IRQ8) is not generated (status C only).
   */

  var IRQ_PIT = 0;
  var IRQ_KEYBOARD = 1;
  var IRQ_CASCADE = 2;
  var IRQ_SERIAL = 4;
  var IRQ_FLOPPY = 6;
  var IRQ_ATA = 14;

  var VECTOR_MASTER = 0x20;
  var VECTOR_SLAVE = 0x70;
  var PIT_CLOCK_HZ = 1193182;

  function hex(v, width) {
    var s = (v >>> 0).toString(16).toUpperCase();
    while (width && s.length < width) s = '0' + s;
    return s;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /* Devices own their port ranges, so a second install() rebinds them instead of
     leaving the handlers of a discarded device set behind. */
  function regPort(bus, port, handler) {
    bus.io.addPort(port, handler, true);
    return handler;
  }

  /* ============================== 8259A PIC ============================== */

  function Chip8259(name) {
    this.name = name;
    this.irr = 0;
    this.isr = 0;
    this.imr = 0xFF;
    this.vectorBase = 0;
    this.initStep = 0;
    this.single = false;
    this.levelTriggered = false;
    this.needsIcw4 = false;
    this.uPM = false;
    this.aeoi = false;
    this.buffered = false;
    this.sfnm = false;
    this.readISR = false;
    this.pollMode = false;
    this.specialMask = false;
    this.autoRotate = false;
    this.rotateBase = 7;
    this.cascadeValue = 0;
    this.lastEoi = -1;
    this.ackCount = 0;
    this.spuriousCount = 0;
  }

  Chip8259.prototype.reset = function () {
    this.irr = 0;
    this.isr = 0;
    this.imr = 0xFF;
    this.initStep = 0;
    this.rotateBase = 7;
    this.readISR = false;
    this.pollMode = false;
    this.specialMask = false;
    this.autoRotate = false;
    this.uPM = false;
    this.aeoi = false;
    this.lastEoi = -1;
  };

  /* Lower ranks are served first; rank 0 is the request just above the
     rotating lowest-priority level (7 when the chip is freshly initialised). */
  Chip8259.prototype.rank = function (bit) {
    return (bit - this.rotateBase - 1) & 7;
  };

  Chip8259.prototype.highestPending = function () {
    var cand = this.specialMask ? this.irr : (this.irr & ~this.imr);
    cand &= 0xFF;
    if (cand === 0) return -1;
    var topIsrRank = 8;
    for (var b = 0; b < 8; b++) {
      if ((this.isr & (1 << b)) !== 0) {
        var r = this.rank(b);
        if (r < topIsrRank) topIsrRank = r;
      }
    }
    var best = -1;
    var bestRank = 8;
    for (var i = 0; i < 8; i++) {
      if ((cand & (1 << i)) === 0) continue;
      var rank = this.rank(i);
      if (rank < bestRank && rank < topIsrRank) { bestRank = rank; best = i; }
    }
    return best;
  };

  Chip8259.prototype.pendingMask = function () {
    return (this.irr & ~this.imr) & 0xFF;
  };

  Chip8259.prototype.request = function (bit) {
    this.irr = (this.irr | (1 << bit)) & 0xFF;
  };

  Chip8259.prototype.release = function (bit) {
    this.irr = (this.irr & ~(1 << bit)) & 0xFF;
  };

  Chip8259.prototype.nonSpecificEoi = function () {
    var top = -1;
    var topRank = 8;
    for (var b = 0; b < 8; b++) {
      if ((this.isr & (1 << b)) === 0) continue;
      var r = this.rank(b);
      if (r < topRank) { topRank = r; top = b; }
    }
    if (top >= 0) {
      this.isr = (this.isr & ~(1 << top)) & 0xFF;
      this.lastEoi = top;
    }
  };

  Chip8259.prototype.specificEoi = function (bit) {
    if ((this.isr & (1 << bit)) !== 0) {
      this.isr = (this.isr & ~(1 << bit)) & 0xFF;
      this.lastEoi = bit;
    }
  };

  Chip8259.prototype.writeCmd = function (v) {
    v &= 0xFF;
    if ((v & 0x10) !== 0) {
      this.initStep = 1;
      this.needsIcw4 = (v & 0x01) !== 0;
      this.single = (v & 0x02) !== 0;
      this.levelTriggered = (v & 0x08) !== 0;
      this.irr = 0;
      this.isr = 0;
      this.readISR = false;
      this.pollMode = false;
      this.specialMask = false;
      this.autoRotate = false;
      this.rotateBase = 7;
      this.aeoi = false;
      return;
    }
    if ((v & 0x08) !== 0) {
      if ((v & 0x02) !== 0) this.readISR = (v & 0x01) !== 0;
      this.pollMode = (v & 0x04) !== 0;
      if ((v & 0x40) !== 0) this.specialMask = (v & 0x20) !== 0;
      return;
    }
    var op = v & 0xE0;
    var level = v & 0x07;
    if (op === 0x00) { this.autoRotate = false; return; }
    if (op === 0x40) return;
    if (op === 0x20) { this.nonSpecificEoi(); return; }
    if (op === 0x60) { this.specificEoi(level); return; }
    if (op === 0x80 || op === 0xC0) { this.rotateBase = level; return; }
    if (op === 0xA0) {
      this.nonSpecificEoi();
      if (this.lastEoi >= 0) this.rotateBase = this.lastEoi;
      return;
    }
    if (op === 0xE0) {
      this.specificEoi(level);
      this.rotateBase = level;
      return;
    }
  };

  Chip8259.prototype.writeData = function (v) {
    v &= 0xFF;
    if (this.initStep === 1) {
      this.vectorBase = v & 0xF8;
      this.initStep = 2;
      if (this.single) this.initStep = this.needsIcw4 ? 3 : 0;
      return;
    }
    if (this.initStep === 2) {
      this.cascadeValue = v;
      this.initStep = this.needsIcw4 ? 3 : 0;
      return;
    }
    if (this.initStep === 3) {
      this.uPM = (v & 0x01) !== 0;
      this.aeoi = (v & 0x02) !== 0;
      this.buffered = (v & 0x08) !== 0;
      this.sfnm = (v & 0x10) !== 0;
      this.initStep = 0;
      return;
    }
    this.imr = v & 0xFF;
  };

  Chip8259.prototype.readCmd = function () {
    if (this.pollMode) {
      this.pollMode = false;
      var bit = this.highestPending();
      if (bit < 0) return 0x00;
      this.isr = (this.isr | (1 << bit)) & 0xFF;
      this.irr = (this.irr & ~(1 << bit)) & 0xFF;
      return 0x80 | bit;
    }
    if (this.readISR) return this.isr;
    return this.irr;
  };

  Chip8259.prototype.readData = function () {
    return this.imr & 0xFF;
  };

  function PIC(bus) {
    this.bus = bus;
    this.master = new Chip8259('master');
    this.slave = new Chip8259('slave');
    this.master.vectorBase = VECTOR_MASTER;
    this.slave.vectorBase = VECTOR_SLAVE;
    this.cascadeLine = IRQ_CASCADE;
    this.spuriousCount = 0;
    this.lastSpurious = 0;
    this.ackCount = 0;
    this.cascadeHits = 0;
    var self = this;
    regPort(bus, 0x20, {
      read: function (port, width) { return self.master.readCmd(); },
      write: function (port, width, v) { self.master.writeCmd(v); }
    });
    regPort(bus, 0x21, {
      read: function (port, width) { return self.master.readData(); },
      write: function (port, width, v) { self.master.writeData(v); self.syncCascade(); }
    });
    regPort(bus, 0xA0, {
      read: function (port, width) { return self.slave.readCmd(); },
      write: function (port, width, v) { self.slave.writeCmd(v); self.syncCascade(); }
    });
    regPort(bus, 0xA1, {
      read: function (port, width) { return self.slave.readData(); },
      write: function (port, width, v) { self.slave.writeData(v); self.syncCascade(); }
    });
  }

  PIC.prototype.reset = function () {
    this.master.reset();
    this.slave.reset();
    this.master.vectorBase = VECTOR_MASTER;
    this.slave.vectorBase = VECTOR_SLAVE;
    this.spuriousCount = 0;
    this.lastSpurious = 0;
    this.ackCount = 0;
    this.cascadeHits = 0;
  };

  /* The slave's INT output drives the master's IRQ2 input as a level. */
  PIC.prototype.syncCascade = function () {
    if (this.slave.pendingMask() !== 0) this.master.request(IRQ_CASCADE);
    else this.master.release(IRQ_CASCADE);
  };

  PIC.prototype.request = function (line) {
    line &= 15;
    if (line < 8) {
      this.master.request(line);
    } else {
      this.slave.request(line - 8);
      this.syncCascade();
    }
    return this;
  };

  PIC.prototype.release = function (line) {
    line &= 15;
    if (line < 8) {
      this.master.release(line);
    } else {
      this.slave.release(line - 8);
      this.syncCascade();
    }
    return this;
  };

  PIC.prototype.masked = function (line) {
    line &= 15;
    return line < 8
      ? (this.master.imr & (1 << line)) !== 0
      : (this.slave.imr & (1 << (line - 8))) !== 0;
  };

  PIC.prototype.pending = function () {
    return this.master.highestPending() >= 0;
  };

  PIC.prototype.irr = function () {
    return ((this.slave.irr & ~this.slave.imr) << 8) | (this.master.irr & ~this.master.imr);
  };

  PIC.prototype.isr = function () {
    return ((this.slave.isr << 8) | this.master.isr) >>> 0;
  };

  PIC.prototype.ack = function () {
    var m = this.master;
    var s = this.slave;
    var mbit = m.highestPending();
    if (mbit < 0) return null;
    if (mbit === this.cascadeLine) {
      var sbit = s.highestPending();
      if (sbit < 0) {
        /* The cascade line was asserted but the slave has nothing in service:
           the master answers with the IRQ7 vector and does not set ISR. */
        m.irr = (m.irr & ~(1 << this.cascadeLine)) & 0xFF;
        this.lastSpurious = 7;
        this.spuriousCount++;
        return (m.vectorBase + 7) & 0xFF;
      }
      m.isr = (m.isr | (1 << this.cascadeLine)) & 0xFF;
      m.irr = (m.irr & ~(1 << this.cascadeLine)) & 0xFF;
      s.isr = (s.isr | (1 << sbit)) & 0xFF;
      s.irr = (s.irr & ~(1 << sbit)) & 0xFF;
      s.ackCount++;
      this.cascadeHits++;
      this.lastSpurious = 0;
      this.ackCount++;
      this.syncCascade();
      return (s.vectorBase + sbit) & 0xFF;
    }
    m.isr = (m.isr | (1 << mbit)) & 0xFF;
    m.irr = (m.irr & ~(1 << mbit)) & 0xFF;
    m.ackCount++;
    this.lastSpurious = 0;
    this.ackCount++;
    return (m.vectorBase + mbit) & 0xFF;
  };

  /* Spurious acknowledge of the slave's IRQ7 input (vector 0x77). Real
     hardware returns the IRQ7 vector and leaves ISR bit 7 clear. */
  PIC.prototype.ackSlaveSpurious = function () {
    var s = this.slave;
    s.irr = (s.irr & ~(1 << 7)) & 0xFF;
    this.lastSpurious = 15;
    this.spuriousCount++;
    this.syncCascade();
    return (s.vectorBase + 7) & 0xFF;
  };

  /* ============================== 8254 PIT =============================== */

  function PITCounter() {
    this.reload = 0;
    this.value = 0;
    this.remaining = 0;
    this.mode = 0;
    this.rw = 3;
    this.bcd = false;
    this.enabled = false;
    this.writeStage = 0;
    this.readStage = 0;
    this.latched = -1;
    this.latchStage = 0;
    this.out = 0;
    this.fireCount = 0;
  }

  function PIT(bus) {
    this.bus = bus;
    this.clockHz = PIT_CLOCK_HZ;
    this.cpuHz = PIT_CLOCK_HZ;
    this.counters = [new PITCounter(), new PITCounter(), new PITCounter()];
    this.ticks = 0;
    this.frac = 0;
    this.irq0Count = 0;
    this.modeWrites = 0;
    this.onIrq0 = null;
    var self = this;
    regPort(bus, 0x43, {
      read: function (port, width) { return 0xFF; },
      write: function (port, width, v) { self.writeControl(v); }
    });
    for (var i = 0; i < 3; i++) this.registerCounter(i);
  }

  PIT.prototype.registerCounter = function (index) {
    var self = this;
    regPort(this.bus, 0x40 + index, {
      read: function (port, width) { return self.readCounter(index); },
      write: function (port, width, v) { self.writeCounter(index, v & 0xFF); }
    });
  };

  PIT.prototype.reset = function () {
    for (var i = 0; i < 3; i++) this.counters[i] = new PITCounter();
    this.ticks = 0;
    this.frac = 0;
    this.irq0Count = 0;
    this.modeWrites = 0;
  };

  Object.defineProperty(PIT.prototype, 'frequency', {
    get: function () { return this.clockHz; },
    set: function (v) { if (v > 0) { this.clockHz = v; this.cpuHz = v; } }
  });

  PIT.prototype.divider = function (index) {
    var c = this.counters[index];
    return c.reload > 0 ? c.reload : 65536;
  };

  PIT.prototype.counterFrequency = function (index) {
    return this.clockHz / this.divider(index);
  };

  PIT.prototype.writeControl = function (v) {
    v &= 0xFF;
    var ch = (v >>> 6) & 3;
    if (ch === 3) return;
    var rw = (v >>> 4) & 3;
    var c = this.counters[ch];
    if (rw === 0) {
      c.latched = c.enabled ? c.value : (c.reload > 0 ? c.reload : 65536);
      c.latchStage = 0;
      return;
    }
    c.rw = rw;
    c.mode = (v >>> 1) & 7;
    c.bcd = (v & 1) !== 0;
    c.writeStage = 0;
    c.readStage = 0;
    c.latched = -1;
    c.enabled = false;
    c.remaining = 0;
    c.out = 0;
    this.modeWrites++;
  };

  PIT.prototype.start = function (c) {
    if (c.reload <= 0) c.reload = 65536;
    c.remaining = c.reload;
    c.value = c.reload;
    c.enabled = true;
    c.out = (c.mode === 2 || c.mode === 3) ? 1 : 0;
  };

  PIT.prototype.writeCounter = function (index, v) {
    var c = this.counters[index];
    if (c.rw === 0) return;
    if (c.rw === 1) { c.reload = v & 0xFF; this.start(c); return; }
    if (c.rw === 2) { c.reload = (v & 0xFF) << 8; this.start(c); return; }
    if (c.writeStage === 0) {
      c.reload = v & 0xFF;
      c.writeStage = 1;
      return;
    }
    c.reload = (c.reload & 0xFF) | ((v & 0xFF) << 8);
    c.writeStage = 0;
    this.start(c);
  };

  PIT.prototype.readCounter = function (index) {
    var c = this.counters[index];
    if (c.latched >= 0) {
      var lv;
      if (c.latchStage === 0) {
        lv = c.latched & 0xFF;
        c.latchStage = 1;
      } else {
        lv = (c.latched >>> 8) & 0xFF;
        c.latched = -1;
        c.latchStage = 0;
      }
      return lv & 0xFF;
    }
    if (c.rw === 1) return c.value & 0xFF;
    if (c.rw === 2) return (c.value >>> 8) & 0xFF;
    var v;
    if (c.readStage === 0) { v = c.value & 0xFF; c.readStage = 1; }
    else { v = (c.value >>> 8) & 0xFF; c.readStage = 0; }
    return v & 0xFF;
  };

  PIT.prototype.getOut = function (index) {
    return this.counters[index].out & 1;
  };

  PIT.prototype.advance = function (cycles) {
    if (!(cycles > 0)) return 0;
    var total = this.frac + (cycles * this.clockHz) / this.cpuHz;
    var ticks = Math.floor(total);
    this.frac = total - ticks;
    if (ticks <= 0) return 0;
    this.ticks += ticks;
    for (var i = 0; i < 3; i++) this.runCounter(i, ticks);
    return ticks;
  };

  PIT.prototype.runCounter = function (index, ticks) {
    var c = this.counters[index];
    if (!c.enabled) return;
    var div = c.reload > 0 ? c.reload : 65536;
    var t = ticks;
    var guard = 0;
    while (t > 0 && c.enabled) {
      if (c.remaining <= 0) c.remaining = div;
      /* Whole periods in one step: a large cycle delta must not walk tick by
         tick, and must not be dropped when the safety guard trips. */
      if ((c.mode === 2 || c.mode === 3) && c.remaining === div && t >= div) {
        var periods = Math.floor(t / div);
        t -= periods * div;
        c.fireCount += periods;
        this.fire(periods);
        continue;
      }
      var before = c.remaining;
      var step = c.remaining < t ? c.remaining : t;
      c.remaining -= step;
      t -= step;
      if (c.mode === 3) {
        var half = Math.ceil((c.reload > 0 ? c.reload : 65536) / 2);
        if (before > half && c.remaining <= half) c.out ^= 1;
      }
      c.value = c.remaining;
      if (c.remaining === 0) {
        c.out ^= 1;
        c.fireCount++;
        if (index === 0) this.fire();
        if (c.mode === 2 || c.mode === 3) {
          c.remaining = c.reload > 0 ? c.reload : 65536;
          c.value = c.remaining;
        } else {
          c.enabled = false;
        }
      }
      guard++;
      if (guard > 200000) break;
    }
  };

  PIT.prototype.fire = function (count) {
    this.irq0Count += count > 0 ? count : 1;
    if (this.onIrq0) this.onIrq0();
  };

  /* ============================== 8042 KBC ============================== */

  var SCANCODE_ASCII = {
    0x01: 27, 0x02: 49, 0x03: 50, 0x04: 51, 0x05: 52, 0x06: 53, 0x07: 54,
    0x08: 55, 0x09: 56, 0x0A: 57, 0x0B: 48, 0x0C: 45, 0x0D: 61, 0x0E: 8,
    0x0F: 9,
    0x10: 113, 0x11: 119, 0x12: 101, 0x13: 114, 0x14: 116, 0x15: 121,
    0x16: 117, 0x17: 105, 0x18: 111, 0x19: 112, 0x1A: 91, 0x1B: 93,
    0x1C: 13, 0x1D: 0,
    0x1E: 97, 0x1F: 115, 0x20: 100, 0x21: 102, 0x22: 103, 0x23: 104,
    0x24: 106, 0x25: 107, 0x26: 108, 0x27: 59, 0x28: 39, 0x29: 96,
    0x2A: 0, 0x2B: 92,
    0x2C: 122, 0x2D: 120, 0x2E: 99, 0x2F: 118, 0x30: 98, 0x31: 110,
    0x32: 109, 0x33: 44, 0x34: 46, 0x35: 47, 0x36: 0, 0x37: 42,
    0x38: 0, 0x39: 32,
    0x3A: 0, 0x3B: 0, 0x3C: 0, 0x3D: 0, 0x3E: 0, 0x3F: 0, 0x40: 0,
    0x41: 0, 0x42: 0, 0x43: 0, 0x44: 0, 0x45: 0, 0x46: 0,
    0x47: 55, 0x48: 56, 0x49: 57, 0x4A: 45, 0x4B: 52, 0x4C: 53,
    0x4D: 54, 0x4E: 43, 0x4F: 49, 0x50: 50, 0x51: 51, 0x52: 48,
    0x53: 46, 0x57: 0, 0x58: 0
  };

  var SCANCODE_ASCII_SHIFT = {
    0x02: 33, 0x03: 64, 0x04: 35, 0x05: 36, 0x06: 37, 0x07: 94, 0x08: 38,
    0x09: 42, 0x0A: 40, 0x0B: 41, 0x0C: 95, 0x0D: 43,
    0x10: 81, 0x11: 87, 0x12: 69, 0x13: 82, 0x14: 84, 0x15: 89, 0x16: 85,
    0x17: 73, 0x18: 79, 0x19: 80, 0x1A: 123, 0x1B: 125,
    0x1E: 65, 0x1F: 83, 0x20: 68, 0x21: 70, 0x22: 71, 0x23: 72,
    0x24: 74, 0x25: 75, 0x26: 76, 0x27: 58, 0x28: 34, 0x29: 126,
    0x2B: 124,
    0x2C: 90, 0x2D: 88, 0x2E: 67, 0x2F: 86, 0x30: 66, 0x31: 78,
    0x32: 77, 0x33: 60, 0x34: 62, 0x35: 63
  };

  function scancodeToAscii(code, shift) {
    code &= 0x7F;
    if (shift) {
      var s = SCANCODE_ASCII_SHIFT[code];
      if (s !== undefined) return s;
    }
    var v = SCANCODE_ASCII[code];
    return v === undefined ? 0 : v;
  }

  function Keyboard(bus) {
    this.bus = bus;
    this.cmdByte = 0x45;
    this.outQueue = [];
    this.lastByte = 0;
    this.cmdParam = -1;
    this.outputPort = 0xA5;
    this.inputPort = 0x00;
    this.irqUp = null;
    this.irqDown = null;
    this.irqLevel = false;
    this.bytesQueued = 0;
    this.keyEvents = 0;
    this.lastScancode = 0;
    var self = this;
    regPort(bus, 0x60, {
      read: function (port, width) { return self.readData(); },
      write: function (port, width, v) { self.writeData(v & 0xFF); }
    });
    regPort(bus, 0x64, {
      read: function (port, width) { return self.readStatus(); },
      write: function (port, width, v) { self.writeCommand(v & 0xFF); }
    });
  }

  Keyboard.prototype.reset = function () {
    this.cmdByte = 0x45;
    this.outQueue.length = 0;
    this.lastByte = 0;
    this.cmdParam = -1;
    this.outputPort = 0xA5;
    this.bytesQueued = 0;
    this.keyEvents = 0;
    this.lastScancode = 0;
    this.updateIrq();
  };

  Keyboard.prototype.readStatus = function () {
    var s = 0x04;
    if (this.outQueue.length > 0) s |= 0x01;
    if ((this.cmdByte & 0x10) !== 0) s |= 0x10;
    return s & 0xFF;
  };

  Keyboard.prototype.updateIrq = function () {
    var want = this.outQueue.length > 0 && (this.cmdByte & 0x01) !== 0;
    if (want && !this.irqLevel) {
      this.irqLevel = true;
      if (this.irqUp) this.irqUp(IRQ_KEYBOARD);
    } else if (!want && this.irqLevel) {
      this.irqLevel = false;
      if (this.irqDown) this.irqDown(IRQ_KEYBOARD);
    }
  };

  Keyboard.prototype.queue = function (byte) {
    this.outQueue.push(byte & 0xFF);
    if (this.outQueue.length > 256) this.outQueue.shift();
    this.bytesQueued++;
    this.updateIrq();
  };

  Keyboard.prototype.readData = function () {
    if (this.outQueue.length > 0) this.lastByte = this.outQueue.shift();
    this.updateIrq();
    return this.lastByte & 0xFF;
  };

  Keyboard.prototype.writeData = function (v) {
    if (this.cmdParam === 0x60) {
      this.cmdByte = v & 0xFF;
      this.cmdParam = -1;
      this.updateIrq();
      return;
    }
    if (this.cmdParam === 0xD1) { this.outputPort = v & 0xFF; this.cmdParam = -1; return; }
    if (this.cmdParam === 0xD2 || this.cmdParam === 0xD3) {
      this.queue(v & 0xFF);
      this.cmdParam = -1;
      return;
    }
    if (this.cmdParam === 0xD4) { this.queue(0xFA); this.cmdParam = -1; return; }
    this.cmdParam = -1;
    if (v === 0xEE) { this.queue(0xEE); return; }
    if (v === 0xFF) { this.reset(); this.queue(0xFA); this.queue(0xAA); return; }
    if (v === 0xFE) { this.queue(0xFA); return; }
    if (v === 0xF0 || v === 0xED || v === 0xF2 || v === 0xF3 || v === 0xF4 ||
        v === 0xF5 || v === 0xF6 || v === 0xE8 || v === 0xE9 || v === 0xEB ||
        v === 0xF7) {
      this.queue(0xFA);
      return;
    }
    this.queue(0xFA);
  };

  Keyboard.prototype.writeCommand = function (v) {
    switch (v & 0xFF) {
      case 0x20: this.queue(this.cmdByte); break;
      case 0x60: this.cmdParam = 0x60; break;
      case 0xA7: this.cmdByte |= 0x20; break;
      case 0xA8: this.cmdByte &= ~0x20; break;
      case 0xAA: this.queue(this.selfTestOk === false ? 0xFC : 0x55); break;
      case 0xAB: this.queue(0x00); break;
      case 0xAD: this.cmdByte |= 0x10; break;
      case 0xAE: this.cmdByte &= ~0x10; break;
      case 0xC0: this.queue(this.inputPort & 0xFF); break;
      case 0xD0: this.queue(this.outputPort & 0xFF); break;
      case 0xD1: this.cmdParam = 0xD1; break;
      case 0xD2: this.cmdParam = 0xD2; break;
      case 0xD3: this.cmdParam = 0xD3; break;
      case 0xD4: this.cmdParam = 0xD4; break;
      case 0xFE:
      case 0xFF:
        this.reset();
        this.queue(0xFA);
        this.queue(0xAA);
        break;
      default:
        break;
    }
  };

  Keyboard.prototype.press = function (code) {
    code &= 0x7F;
    this.lastScancode = code;
    this.keyEvents++;
    this.queue(code);
  };

  Keyboard.prototype.release = function (code) {
    code &= 0x7F;
    this.lastScancode = code;
    this.keyEvents++;
    this.queue(code | 0x80);
  };

  Keyboard.prototype.inject = function (code, down) {
    if (down) this.press(code);
    else this.release(code);
  };

  Keyboard.prototype.toAscii = function (code, shift) {
    return scancodeToAscii(code, shift);
  };

  Keyboard.prototype.pending = function () {
    return this.outQueue.length;
  };

  /* ============================ CMOS / RTC ============================== */

  function toBcd(v) {
    v &= 0xFF;
    return (((v / 10) | 0) << 4) | (v % 10);
  }

  function fromBcd(v) {
    return ((v >>> 4) * 10) + (v & 0x0F);
  }

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function CMOS(bus) {
    this.bus = bus;
    this.ram = new Uint8Array(128);
    this.index = 0;
    this.nmiDisabled = false;
    this.autoTick = true;
    this.baseMs = 0;
    this.elapsedMs = 0;
    this.reads = 0;
    this.writes = 0;
    this.ramMB = bus.ramMB;
    this.initRegisters(bus.ramMB);
    var self = this;
    regPort(bus, 0x70, {
      read: function (port, width) { return self.readIndexPort(); },
      write: function (port, width, v) { self.writeIndexPort(v & 0xFF); }
    });
    regPort(bus, 0x71, {
      read: function (port, width) { return self.readData(); },
      write: function (port, width, v) { self.writeData(v & 0xFF); }
    });
  }

  CMOS.prototype.initRegisters = function (ramMB) {
    this.ram.fill(0);
    this.ram[0x0A] = 0x26;
    this.ram[0x0B] = 0x02;
    this.ram[0x0D] = 0x80;
    this.ram[0x0F] = 0x00;
    this.ram[0x10] = 0x00;
    this.ram[0x12] = 0xF0;
    this.ram[0x14] = 0x20;
    var aboveKB = (ramMB > 1 ? ramMB - 1 : 0) * 1024;
    this.ram[0x17] = aboveKB & 0xFF;
    this.ram[0x18] = (aboveKB >>> 8) & 0xFF;
    this.ram[0x30] = aboveKB & 0xFF;
    this.ram[0x31] = (aboveKB >>> 8) & 0xFF;
    this.ram[0x32] = 0x20;
    var blocks = Math.floor(aboveKB / 64);
    this.ram[0x34] = blocks & 0xFF;
    this.ram[0x35] = (blocks >>> 8) & 0xFF;
    for (var i = 0x37; i <= 0x3F; i++) this.ram[i] = 0x00;
  };

  CMOS.prototype.reset = function () {
    this.index = 0;
    this.nmiDisabled = false;
    this.autoTick = true;
    this.baseMs = 0;
    this.elapsedMs = 0;
    this.reads = 0;
    this.writes = 0;
    this.initRegisters(this.bus.ramMB);
  };

  CMOS.prototype.nowMs = function () {
    if (this.autoTick) return Date.now();
    return this.baseMs + this.elapsedMs;
  };

  CMOS.prototype.setTime = function (t) {
    this.autoTick = false;
    this.baseMs = Date.UTC(t.year, (t.month === undefined ? 1 : t.month) - 1,
      t.day === undefined ? 1 : t.day, t.hour || 0, t.minute || 0, t.second || 0);
    this.elapsedMs = 0;
    return this;
  };

  CMOS.prototype.advance = function (seconds) {
    this.elapsedMs += seconds * 1000;
    return this;
  };

  CMOS.prototype.timeFields = function () {
    var d = new Date(this.nowMs());
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      weekday: d.getUTCDay() + 1,
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      dayName: DAY_NAMES[d.getUTCDay()]
    };
  };

  CMOS.prototype.binaryMode = function () {
    return (this.ram[0x0B] & 0x04) !== 0;
  };

  CMOS.prototype.hour24 = function () {
    return (this.ram[0x0B] & 0x02) !== 0;
  };

  CMOS.prototype.updateInProgress = function () {
    return (this.ram[0x0A] & 0x80) !== 0;
  };

  CMOS.prototype.encode = function (v) {
    return this.binaryMode() ? (v & 0xFF) : toBcd(v);
  };

  CMOS.prototype.readField = function (index) {
    var t = this.timeFields();
    var hour = t.hour;
    var pm = false;
    if (!this.hour24()) {
      pm = hour >= 12;
      hour = hour % 12;
      if (hour === 0) hour = 12;
    }
    var v;
    switch (index) {
      case 0x00: v = this.encode(t.second); break;
      case 0x02: v = this.encode(t.minute); break;
      case 0x04:
        v = this.encode(hour);
        if (!this.hour24() && pm && !this.binaryMode()) v |= 0x80;
        break;
      case 0x06: v = this.encode(t.weekday); break;
      case 0x07: v = this.encode(t.day); break;
      case 0x08: v = this.encode(t.month); break;
      case 0x09: v = this.encode(t.year % 100); break;
      default: v = 0;
    }
    return v & 0xFF;
  };

  CMOS.prototype.readData = function () {
    this.reads++;
    var i = this.index & 0x7F;
    if (i < 0x0A) return this.readField(i);
    if (i === 0x0A) return this.ram[0x0A] & 0x7F;
    if (i === 0x0C) {
      var v = this.ram[0x0C] & 0xFF;
      this.ram[0x0C] = 0x00;
      return v;
    }
    return this.ram[i] & 0xFF;
  };

  CMOS.prototype.writeData = function (v) {
    this.writes++;
    var i = this.index & 0x7F;
    if (i < 0x0A) return;
    if (i === 0x0C) return;
    this.ram[i] = v & 0xFF;
  };

  CMOS.prototype.readIndexPort = function () {
    return ((this.index & 0x7F) | (this.nmiDisabled ? 0x80 : 0x00)) & 0xFF;
  };

  CMOS.prototype.writeIndexPort = function (v) {
    this.index = v & 0x7F;
    this.nmiDisabled = (v & 0x80) !== 0;
  };

  CMOS.prototype.getRegister = function (index) {
    var save = this.index;
    this.index = index & 0x7F;
    var v = this.readData();
    this.index = save;
    return v;
  };

  /* ================================ VGA ================================= */

  var CGA_PALETTE = [
    0, 0, 0, 0, 0, 170, 0, 170, 0, 0, 170, 170,
    170, 0, 0, 170, 0, 170, 170, 85, 0, 170, 170, 170,
    85, 85, 85, 85, 85, 255, 85, 255, 85, 85, 255, 255,
    255, 85, 85, 255, 85, 255, 255, 255, 85, 255, 255, 255
  ];

  function VGA(bus) {
    this.bus = bus;
    this.mode = 3;
    this.text = new Uint16Array(80 * 25);
    this.pixels = new Uint8Array(320 * 200);
    this.crtc = new Uint8Array(32);
    this.seq = new Uint8Array(8);
    this.gdc = new Uint8Array(16);
    this.attr = new Uint8Array(32);
    this.palette = new Uint8Array(256 * 3);
    this.crtcIndex = 0;
    this.seqIndex = 0;
    this.gdcIndex = 0;
    this.attrIndex = 0;
    this.attrDataMode = false;
    this.dacWriteIndex = 0;
    this.dacReadIndex = 0;
    this.dacSub = 0;
    this.dacMask = 0xFF;
    this.misc = 0x63;
    this.status3da = 0x00;
    this.dirty = true;
    this.frames = 0;
    this.writes = 0;
    this.onModeChange = null;
    this.onWrite = null;
    this._frameW = 0;
    this._frameH = 0;
    this._frameData = null;
    this.reset();
    var self = this;
    bus.mapRead(0xA0000, 0x20000, function (pa, width) { return self.readMem(pa); });
    bus.mapWrite(0xA0000, 0x20000, function (pa, width, v) { self.writeMem(pa, v); });
    regPort(bus, 0x3C0, {
      read: function () { return self.readAttrIndex(); },
      write: function (port, width, v) { self.writeAttr(v & 0xFF); }
    });
    regPort(bus, 0x3C1, {
      read: function () { return self.attr[self.attrIndex & 0x1F] & 0xFF; },
      write: function (port, width, v) { self.writeAttr(v & 0xFF); }
    });
    regPort(bus, 0x3C2, {
      read: function () { return self.misc & 0xFF; },
      write: function (port, width, v) { self.misc = v & 0xFF; }
    });
    regPort(bus, 0x3C4, {
      read: function () { return self.seqIndex & 0xFF; },
      write: function (port, width, v) { self.seqIndex = v & 0x07; }
    });
    regPort(bus, 0x3C5, {
      read: function () { return self.seq[self.seqIndex & 0x07] & 0xFF; },
      write: function (port, width, v) { self.writeSequencer(v & 0xFF); }
    });
    regPort(bus, 0x3C6, {
      read: function () { return self.dacMask & 0xFF; },
      write: function (port, width, v) { self.dacMask = v & 0xFF; }
    });
    regPort(bus, 0x3C7, {
      read: function () { return self.dacReadIndex & 0xFF; },
      write: function (port, width, v) { self.dacReadIndex = v & 0xFF; self.dacSub = 0; }
    });
    regPort(bus, 0x3C8, {
      read: function () { return self.dacWriteIndex & 0xFF; },
      write: function (port, width, v) { self.dacWriteIndex = v & 0xFF; self.dacSub = 0; }
    });
    regPort(bus, 0x3C9, {
      read: function () { return self.readDac(); },
      write: function (port, width, v) { self.writeDac(v & 0xFF); }
    });
    regPort(bus, 0x3CA, {
      read: function () { return 0x00; },
      write: function () { }
    });
    regPort(bus, 0x3CC, {
      read: function () { return self.misc & 0xFF; },
      write: function () { }
    });
    regPort(bus, 0x3CE, {
      read: function () { return self.gdcIndex & 0xFF; },
      write: function (port, width, v) { self.gdcIndex = v & 0x0F; }
    });
    regPort(bus, 0x3CF, {
      read: function () { return self.gdc[self.gdcIndex & 0x0F] & 0xFF; },
      write: function (port, width, v) { self.gdc[self.gdcIndex & 0x0F] = v & 0xFF; }
    });
    regPort(bus, 0x3D4, {
      read: function () { return self.crtcIndex & 0xFF; },
      write: function (port, width, v) { self.crtcIndex = v & 0x1F; }
    });
    regPort(bus, 0x3D5, {
      read: function () { return self.crtc[self.crtcIndex & 0x1F] & 0xFF; },
      write: function (port, width, v) { self.writeCrtc(v & 0xFF); }
    });
    regPort(bus, 0x3DA, {
      read: function () { return self.readStatus(); },
      write: function (port, width, v) { self.status3da = (self.status3da & 0xF0) | (v & 0x0F); }
    });
  }

  VGA.prototype.reset = function () {
    this.mode = 3;
    this.crtc.fill(0);
    this.seq.fill(0);
    this.gdc.fill(0);
    this.attr.fill(0);
    this.crtcIndex = 0;
    this.seqIndex = 0;
    this.gdcIndex = 0;
    this.attrIndex = 0;
    this.attrDataMode = false;
    this.dacWriteIndex = 0;
    this.dacReadIndex = 0;
    this.dacSub = 0;
    this.dacMask = 0xFF;
    this.misc = 0x63;
    this.status3da = 0x00;
    this.seq[0x02] = 0x03;
    this.seq[0x04] = 0x02;
    this.gdc[0x05] = 0x10;
    this.gdc[0x06] = 0x0E;
    this.crtc[0x0A] = 0x0D;
    this.crtc[0x0B] = 0x0E;
    this.crtc[0x13] = 80;
    this.crtc[0x14] = 0x40;
    this.resetPalette();
    this.clearWindow(0x07);
    this.pixels.fill(0);
    this.dirty = true;
  };

  VGA.prototype.resetPalette = function () {
    var i;
    for (i = 0; i < 48; i++) this.palette[i] = CGA_PALETTE[i];
    for (i = 16; i < 256; i++) {
      var r = ((i >>> 5) & 7) * 36;
      var g = ((i >>> 2) & 7) * 36;
      var b = (i & 3) * 85;
      this.palette[i * 3] = r;
      this.palette[i * 3 + 1] = g;
      this.palette[i * 3 + 2] = b;
    }
  };

  VGA.prototype.setPalette = function (index, r, g, b) {
    index &= 0xFF;
    this.palette[index * 3] = clamp(r | 0, 0, 255);
    this.palette[index * 3 + 1] = clamp(g | 0, 0, 255);
    this.palette[index * 3 + 2] = clamp(b | 0, 0, 255);
    this.dirty = true;
  };

  VGA.prototype.getPalette = function (index) {
    index &= 0xFF;
    return {
      r: this.palette[index * 3],
      g: this.palette[index * 3 + 1],
      b: this.palette[index * 3 + 2]
    };
  };

  VGA.prototype.setMode = function (mode) {
    var m = (mode === 0x13 || mode === 19) ? 0x13 : 3;
    this.mode = m;
    this.crtc[0x0C] = 0;
    this.crtc[0x0D] = 0;
    this.crtc[0x0E] = 0;
    this.crtc[0x0F] = 0;
    if (m === 0x13) {
      this.pixels.fill(0);
    } else {
      this.clearWindow(0x07);
    }
    this.dirty = true;
    if (this.onModeChange) this.onModeChange(m);
    return m;
  };

  Object.defineProperty(VGA.prototype, 'startAddress', {
    get: function () { return ((this.crtc[0x0C] << 8) | this.crtc[0x0D]) & 0xFFFF; }
  });

  Object.defineProperty(VGA.prototype, 'cursorLocation', {
    get: function () { return ((this.crtc[0x0E] << 8) | this.crtc[0x0F]) & 0xFFFF; }
  });

  Object.defineProperty(VGA.prototype, 'cursor', {
    get: function () {
      var loc = (this.cursorLocation - this.startAddress + 2000) % 2000;
      return { x: loc % 80, y: (loc / 80) | 0 };
    },
    set: function (v) { if (v) this.setCursor(v.x, v.y); }
  });

  Object.defineProperty(VGA.prototype, 'cursorEnabled', {
    get: function () { return (this.crtc[0x0A] & 0x20) === 0; }
  });

  VGA.prototype.setCursor = function (x, y) {
    x = clamp(x | 0, 0, 79);
    y = clamp(y | 0, 0, 24);
    var loc = (this.startAddress + y * 80 + x) & 0xFFFF;
    this.crtc[0x0E] = (loc >>> 8) & 0xFF;
    this.crtc[0x0F] = loc & 0xFF;
    this.dirty = true;
  };

  VGA.prototype.cellIndex = function (x, y) {
    return (this.startAddress + y * 80 + x) % 2000;
  };

  VGA.prototype.writeChar = function (ch, attr, x, y) {
    if (x === undefined || y === undefined) {
      var c = this.cursor;
      x = c.x;
      y = c.y;
    }
    if (x < 0 || x > 79 || y < 0 || y > 24) return;
    var value = (((attr === undefined ? 0x07 : attr) & 0xFF) << 8) | (ch & 0xFF);
    this.text[this.cellIndex(x, y)] = value;
    this.dirty = true;
  };

  VGA.prototype.readChar = function (x, y) {
    var cell = this.text[this.cellIndex(x, y)];
    return { ch: cell & 0xFF, attr: (cell >>> 8) & 0xFF };
  };

  VGA.prototype.clearWindow = function (attr) {
    var value = (((attr === undefined ? 0x07 : attr) & 0xFF) << 8) | 0x20;
    for (var i = 0; i < this.text.length; i++) this.text[i] = value;
    this.dirty = true;
  };

  VGA.prototype.clear = function (attr) {
    this.clearWindow(attr === undefined ? 0x07 : attr);
    this.pixels.fill(0);
    this.dirty = true;
  };

  VGA.prototype.scrollUp = function (lines, attr) {
    lines = lines | 0;
    if (lines <= 0 || lines >= 25) { this.clearWindow(attr); return; }
    this.text.copyWithin(0, lines * 80, 2000);
    var value = (((attr === undefined ? 0x07 : attr) & 0xFF) << 8) | 0x20;
    for (var i = (25 - lines) * 80; i < 2000; i++) this.text[i] = value;
    this.dirty = true;
  };

  VGA.prototype.scrollDown = function (lines, attr) {
    lines = lines | 0;
    if (lines <= 0 || lines >= 25) { this.clearWindow(attr); return; }
    this.text.copyWithin(lines * 80, 0, (25 - lines) * 80);
    var value = (((attr === undefined ? 0x07 : attr) & 0xFF) << 8) | 0x20;
    for (var i = 0; i < lines * 80; i++) this.text[i] = value;
    this.dirty = true;
  };

  VGA.prototype.getLine = function (y) {
    y = clamp(y | 0, 0, 24);
    var start = this.startAddress;
    var s = '';
    for (var x = 0; x < 80; x++) {
      var ch = this.text[(start + y * 80 + x) % 2000] & 0xFF;
      s += String.fromCharCode(ch === 0 ? 0x20 : ch);
    }
    return s.replace(/ +$/, '');
  };

  VGA.prototype.getScreenText = function () {
    var out = [];
    for (var y = 0; y < 25; y++) out.push(this.getLine(y));
    return out;
  };

  VGA.prototype.writePixel = function (x, y, color) {
    x = x | 0;
    y = y | 0;
    if (x < 0 || x > 319 || y < 0 || y > 199) return;
    this.pixels[y * 320 + x] = color & 0xFF;
    this.dirty = true;
  };

  VGA.prototype.readPixel = function (x, y) {
    x = x | 0;
    y = y | 0;
    if (x < 0 || x > 319 || y < 0 || y > 199) return 0;
    return this.pixels[y * 320 + x];
  };

  VGA.prototype.readMem = function (pa) {
    pa = pa >>> 0;
    if (this.mode === 0x13) {
      var off = pa - 0xA0000;
      if (off >= 0 && off < 64000) return this.pixels[off] & 0xFF;
      return 0x00;
    }
    var o = pa - 0xB8000;
    if (o >= 0 && o < 4000) {
      var cell = this.text[(o >>> 1) % 2000];
      return (o & 1) !== 0 ? (cell >>> 8) & 0xFF : cell & 0xFF;
    }
    return 0x00;
  };

  VGA.prototype.writeMem = function (pa, v) {
    pa = pa >>> 0;
    v &= 0xFF;
    this.writes++;
    if (this.mode === 0x13) {
      var off = pa - 0xA0000;
      if (off >= 0 && off < 64000) {
        this.pixels[off] = v;
        this.dirty = true;
      }
      return;
    }
    var o = pa - 0xB8000;
    if (o >= 0 && o < 4000) {
      var idx = (o >>> 1) % 2000;
      var cell = this.text[idx];
      this.text[idx] = (o & 1) !== 0 ? ((v << 8) | (cell & 0xFF)) : ((cell & 0xFF00) | v);
      this.dirty = true;
      return;
    }
  };

  VGA.prototype.readStatus = function () {
    this.status3da ^= 0x09;
    return this.status3da & 0xFF;
  };

  VGA.prototype.writeCrtc = function (v) {
    var i = this.crtcIndex & 0x1F;
    this.crtc[i] = v & 0xFF;
    this.dirty = true;
  };

  VGA.prototype.writeSequencer = function (v) {
    var i = this.seqIndex & 0x07;
    this.seq[i] = v & 0xFF;
    /* Chain-4 memory mode is what separates 256-colour mode 13h from the
       planar text modes; the BIOS programs it through 0x3C4 index 4. */
    if (i === 0x04) {
      var chain4 = (v & 0x08) !== 0;
      if (chain4 && this.mode !== 0x13) this.setMode(0x13);
      else if (!chain4 && this.mode === 0x13) this.setMode(3);
    }
  };

  VGA.prototype.writeAttr = function (v) {
    if (!this.attrDataMode) {
      this.attrIndex = v & 0x1F;
      this.attrDataMode = true;
      return;
    }
    this.attrDataMode = false;
    this.attr[this.attrIndex] = v & 0xFF;
  };

  VGA.prototype.readAttrIndex = function () {
    return this.attrIndex & 0xFF;
  };

  VGA.prototype.writeDac = function (v) {
    v &= 0x3F;
    var idx = this.dacWriteIndex & 0xFF;
    this.palette[idx * 3 + this.dacSub] = (v << 2) | (v >>> 4);
    this.dacSub++;
    if (this.dacSub >= 3) {
      this.dacSub = 0;
      this.dacWriteIndex = (this.dacWriteIndex + 1) & 0xFF;
    }
    this.dirty = true;
  };

  VGA.prototype.readDac = function () {
    var idx = this.dacReadIndex & 0xFF;
    var v = this.palette[idx * 3 + this.dacSub] >>> 2;
    this.dacSub++;
    if (this.dacSub >= 3) {
      this.dacSub = 0;
      this.dacReadIndex = (this.dacReadIndex + 1) & 0xFF;
    }
    return v & 0x3F;
  };

  function cssColor(r, g, b) {
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  VGA.prototype.render = function (canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    var ctx = canvas.getContext('2d');
    if (!ctx) return false;
    var w = canvas.width > 0 ? canvas.width : 640;
    var h = canvas.height > 0 ? canvas.height : 400;
    this.frames++;
    if (this.mode === 0x13) this.renderGraphics(ctx, w, h);
    else this.renderText(ctx, w, h);
    this.dirty = false;
    return true;
  };

  VGA.prototype.renderText = function (ctx, w, h) {
    var cw = w / 80;
    var ch = h / 25;
    if (typeof ctx.fillRect === 'function') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.textBaseline = 'top';
    ctx.font = Math.max(6, Math.round(ch * 0.92)) + 'px monospace';
    var start = this.startAddress;
    for (var y = 0; y < 25; y++) {
      for (var x = 0; x < 80; x++) {
        var cell = this.text[(start + y * 80 + x) % 2000];
        var code = cell & 0xFF;
        var attr = (cell >>> 8) & 0xFF;
        var bg = (attr >>> 4) & 0x0F;
        var fg = attr & 0x0F;
        var px = x * cw;
        var py = y * ch;
        if (bg !== 0 && typeof ctx.fillRect === 'function') {
          var bc = this.getPalette(bg);
          ctx.fillStyle = cssColor(bc.r, bc.g, bc.b);
          ctx.fillRect(px, py, cw, ch);
        }
        if (code > 0x20 && typeof ctx.fillText === 'function' && (attr & 0x80) === 0) {
          var fc = this.getPalette(fg);
          ctx.fillStyle = cssColor(fc.r, fc.g, fc.b);
          ctx.fillText(String.fromCharCode(code), px, py);
        }
      }
    }
    if (this.cursorEnabled && typeof ctx.fillRect === 'function') {
      var cur = this.cursor;
      var cc = this.getPalette(0x0F);
      ctx.fillStyle = cssColor(cc.r, cc.g, cc.b);
      ctx.fillRect(cur.x * cw, (cur.y + 0.7) * ch, cw, ch * 0.3);
    }
  };

  VGA.prototype.buildFrame = function (w, h) {
    if (this._frameW === w && this._frameH === h && this._frameData !== null) return this._frameData;
    var data = new Uint8ClampedArray(w * h * 4);
    var sx = new Uint16Array(w);
    var sy = new Uint16Array(h);
    var i;
    for (i = 0; i < w; i++) sx[i] = Math.min(319, ((i * 320 / w) | 0));
    for (i = 0; i < h; i++) sy[i] = Math.min(199, ((i * 200 / h) | 0));
    for (var y = 0; y < h; y++) {
      var srcRow = sy[y] * 320;
      var dstRow = y * w * 4;
      for (var x = 0; x < w; x++) {
        var idx = this.pixels[srcRow + sx[x]];
        var o = dstRow + x * 4;
        data[o] = this.palette[idx * 3];
        data[o + 1] = this.palette[idx * 3 + 1];
        data[o + 2] = this.palette[idx * 3 + 2];
        data[o + 3] = 255;
      }
    }
    this._frameW = w;
    this._frameH = h;
    this._frameData = data;
    return data;
  };

  VGA.prototype.renderGraphics = function (ctx, w, h) {
    ctx.imageSmoothingEnabled = false;
    var data = this.buildFrame(w, h);
    if (typeof ctx.createImageData === 'function' && typeof ctx.putImageData === 'function') {
      var img = ctx.createImageData(w, h);
      if (img && img.data && img.data.length === w * h * 4) {
        if (typeof img.data.set === 'function') img.data.set(data);
        else for (var i = 0; i < data.length; i++) img.data[i] = data[i];
        ctx.putImageData(img, 0, 0);
        return;
      }
    }
    if (typeof ctx.fillRect === 'function') {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var o = (y * w + x) * 4;
          if (data[o + 3] === 0) continue;
          ctx.fillStyle = cssColor(data[o], data[o + 1], data[o + 2]);
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  };

  /* ============================ ATA PIO disk ============================ */

  var ATA_BSY = 0x80;
  var ATA_DRDY = 0x40;
  var ATA_DF = 0x20;
  var ATA_DRQ = 0x08;
  var ATA_ERR = 0x01;
  var ERR_ABRT = 0x04;
  var ERR_IDNF = 0x10;
  var ATA_HEADS = 16;
  var ATA_SPT = 255;

  function putAtaString(words, start, text, chars) {
    for (var i = 0; i < chars; i += 2) {
      var hi = i < text.length ? text.charCodeAt(i) : 0x20;
      var lo = i + 1 < text.length ? text.charCodeAt(i + 1) : 0x20;
      words[start + (i >> 1)] = (hi << 8) | lo;
    }
  }

  function ATA(bus) {
    this.bus = bus;
    this.image = new Uint8Array(0);
    this.sectors = 0;
    this.dirty = false;
    this.geometry = { cyl: 0, heads: ATA_HEADS, spt: ATA_SPT };
    this.feature = 0;
    this.error = 0;
    this.secCount = 0;
    this.lbaLow = 0;
    this.lbaMid = 0;
    this.lbaHigh = 0;
    this.devHead = 0xA0;
    this.status = ATA_DRDY;
    this.command = 0;
    this.deviceControl = 0;
    this.drq = false;
    this.buf = new Uint16Array(256);
    this.bufPos = 0;
    this.bufLen = 256;
    this.writeMode = false;
    this.pendingSectors = 0;
    this.lba = 0;
    this.pendingCommand = 0;
    this.irqPending = false;
    this.irqLevel = false;
    this.irqUp = null;
    this.irqDown = null;
    this.commandCount = 0;
    this.irqCount = 0;
    this.reads = 0;
    this.writes = 0;
    var self = this;
    var handler = function (reg) {
      return {
        read: function (port, width) { return self.readReg(reg, width); },
        write: function (port, width, v) { self.writeReg(reg, width, v); }
      };
    };
    for (var r = 0; r < 8; r++) regPort(bus, 0x1F0 + r, handler(r));
    regPort(bus, 0x3F6, {
      read: function () { return self.status & 0xFF; },
      write: function (port, width, v) { self.writeDeviceControl(v & 0xFF); }
    });
    regPort(bus, 0x3F7, {
      read: function () { return 0x00; },
      write: function () { }
    });
  }

  ATA.prototype.reset = function () {
    this.feature = 0;
    this.error = 0;
    this.secCount = 0;
    this.lbaLow = 0;
    this.lbaMid = 0;
    this.lbaHigh = 0;
    this.devHead = 0xA0;
    this.status = ATA_DRDY;
    this.command = 0;
    this.deviceControl = 0;
    this.drq = false;
    this.bufPos = 0;
    this.writeMode = false;
    this.pendingSectors = 0;
    this.pendingCommand = 0;
    this.irqPending = false;
    if (this.irqLevel) {
      this.irqLevel = false;
      if (this.irqDown) this.irqDown(IRQ_ATA);
    }
    this.dirty = false;
  };

  ATA.prototype.setImage = function (bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    this.image = u8;
    this.sectors = Math.floor(u8.length / 512);
    this.computeGeometry();
    this.dirty = false;
    return this;
  };

  ATA.prototype.computeGeometry = function () {
    var cyl;
    if (this.sectors <= 0) cyl = 0;
    else cyl = Math.max(1, Math.floor(this.sectors / (ATA_HEADS * ATA_SPT)));
    cyl = clamp(cyl, 0, 16383);
    this.geometry = { cyl: cyl, heads: ATA_HEADS, spt: ATA_SPT };
  };

  ATA.prototype.identify = function () {
    var w = new Uint16Array(256);
    var geo = this.geometry;
    w[0] = 0x0040;
    w[1] = geo.cyl & 0xFFFF;
    w[3] = geo.heads & 0xFFFF;
    w[6] = geo.spt & 0xFFFF;
    putAtaString(w, 10, 'HYN486000000000001', 20);
    putAtaString(w, 23, 'V1.0', 8);
    putAtaString(w, 27, 'HYN486 HDD', 40);
    w[47] = 0x0000;
    w[49] = 0x0200;
    w[51] = 0x0200;
    w[53] = 0x0007;
    w[54] = geo.cyl & 0xFFFF;
    w[55] = geo.heads & 0xFFFF;
    w[56] = geo.spt & 0xFFFF;
    w[57] = this.sectors & 0xFFFF;
    w[58] = (this.sectors >>> 16) & 0xFFFF;
    w[59] = 0x0000;
    w[60] = this.sectors & 0xFFFF;
    w[61] = (this.sectors >>> 16) & 0xFFFF;
    w[64] = 0x0001;
    w[66] = 0x0078;
    w[67] = 0x00B4;
    w[68] = 0x0078;
    w[80] = 0x0003;
    w[82] = 0x4000;
    return w;
  };

  ATA.prototype.readReg = function (reg, width) {
    switch (reg) {
      case 0: return this.readData(width);
      case 1: return this.error & 0xFF;
      case 2: return this.secCount & 0xFF;
      case 3: return this.lbaLow & 0xFF;
      case 4: return this.lbaMid & 0xFF;
      case 5: return this.lbaHigh & 0xFF;
      case 6: return this.devHead & 0xFF;
      case 7: return this.readStatus();
      default: return 0xFF;
    }
  };

  ATA.prototype.writeReg = function (reg, width, v) {
    if (reg === 0) { this.writeData(width, v); return; }
    v &= 0xFF;
    switch (reg) {
      case 1: this.feature = v; return;
      case 2: this.secCount = v; return;
      case 3: this.lbaLow = v; return;
      case 4: this.lbaMid = v; return;
      case 5: this.lbaHigh = v; return;
      case 6: this.devHead = v; return;
      case 7: this.writeCommand(v); return;
      default: return;
    }
  };

  ATA.prototype.readStatus = function () {
    var s = this.status & 0xFF;
    if (this.irqPending) {
      this.irqPending = false;
      if (this.irqLevel) {
        this.irqLevel = false;
        if (this.irqDown) this.irqDown(IRQ_ATA);
      }
    }
    if (this.pendingCommand !== 0) this.complete();
    return s;
  };

  ATA.prototype.writeCommand = function (cmd) {
    this.command = cmd & 0xFF;
    this.error = 0;
    this.drq = false;
    this.pendingCommand = this.command;
    this.status = ATA_BSY | ATA_DRDY;
    if (this.command === 0x08) {
      this.pendingCommand = 0;
      this.status = ATA_DRDY;
      this.error = 0x01;
    }
  };

  ATA.prototype.writeDeviceControl = function (v) {
    this.deviceControl = v & 0xFF;
    if ((v & 0x04) !== 0) {
      this.pendingCommand = 0;
      this.status = ATA_DRDY;
      this.error = 0x01;
      this.drq = false;
    }
  };

  ATA.prototype.poll = function () {
    if (this.pendingCommand !== 0) this.complete();
    return this.status & 0xFF;
  };

  ATA.prototype.complete = function () {
    var cmd = this.pendingCommand;
    this.pendingCommand = 0;
    this.commandCount++;
    this.drq = false;
    this.error = 0;
    if ((this.devHead & 0x10) !== 0) { this.fail(ERR_ABRT); return; }
    switch (cmd) {
      case 0xEC: this.identifyCommand(); break;
      case 0x20:
      case 0x21: this.readCommand(); break;
      case 0x30:
      case 0x31: this.writeStart(); break;
      case 0x40:
      case 0x41: this.verifyCommand(); break;
      case 0x90: this.error = 0x01; this.status = ATA_DRDY; break;
      case 0x91: this.initParameters(); break;
      case 0xE7: this.dirty = false; this.done(); break;
      case 0xC6:
      case 0xEF: this.done(); break;
      case 0xE0:
      case 0xE1:
      case 0xE5:
      case 0xE6: this.done(); break;
      case 0x10: this.done(); break;
      default: this.fail(ERR_ABRT); break;
    }
  };

  ATA.prototype.done = function () {
    this.drq = false;
    this.status = ATA_DRDY;
    this.raiseIrq();
  };

  ATA.prototype.fail = function (code) {
    this.drq = false;
    this.error = code & 0xFF;
    this.status = ATA_DRDY | ATA_ERR;
    this.raiseIrq();
  };

  ATA.prototype.raiseIrq = function () {
    this.irqPending = true;
    this.irqCount++;
    if (!this.irqLevel) {
      this.irqLevel = true;
      if (this.irqUp) this.irqUp(IRQ_ATA);
    }
  };

  ATA.prototype.currentLba = function () {
    if ((this.devHead & 0x40) !== 0) {
      return ((((this.devHead & 0x0F) << 24) | (this.lbaHigh << 16) |
        (this.lbaMid << 8) | this.lbaLow) >>> 0);
    }
    var cyl = (this.lbaHigh << 8) | this.lbaMid;
    var head = this.devHead & 0x0F;
    var sect = this.lbaLow === 0 ? 1 : this.lbaLow;
    return ((cyl * this.geometry.heads) + head) * this.geometry.spt + (sect - 1);
  };

  ATA.prototype.rangeOk = function (lba, count) {
    if (!(lba >= 0)) return false;
    if (count <= 0) return false;
    if (this.sectors <= 0) return false;
    return lba + count <= this.sectors;
  };

  ATA.prototype.loadSector = function (lba) {
    var off = lba * 512;
    for (var i = 0; i < 256; i++) {
      this.buf[i] = this.image[off + i * 2] | (this.image[off + i * 2 + 1] << 8);
    }
    this.bufPos = 0;
  };

  ATA.prototype.commitSector = function () {
    var off = this.lba * 512;
    if (off < 0 || off + 512 > this.image.length) return;
    for (var i = 0; i < 256; i++) {
      this.image[off + i * 2] = this.buf[i] & 0xFF;
      this.image[off + i * 2 + 1] = (this.buf[i] >>> 8) & 0xFF;
    }
    this.lba++;
    this.writes++;
  };

  ATA.prototype.identifyCommand = function () {
    var words = this.identify();
    for (var i = 0; i < 256; i++) this.buf[i] = words[i];
    this.bufPos = 0;
    this.pendingSectors = 0;
    this.writeMode = false;
    this.drq = true;
    this.status = ATA_DRDY | ATA_DRQ;
  };

  ATA.prototype.readCommand = function () {
    var count = this.secCount === 0 ? 256 : this.secCount;
    var lba = this.currentLba();
    if (!this.rangeOk(lba, count)) { this.fail(ERR_IDNF); return; }
    this.lba = lba;
    this.pendingSectors = count - 1;
    this.writeMode = false;
    this.loadSector(lba);
    this.lba = lba + 1;
    this.reads++;
    this.drq = true;
    this.status = ATA_DRDY | ATA_DRQ;
  };

  ATA.prototype.writeStart = function () {
    var count = this.secCount === 0 ? 256 : this.secCount;
    var lba = this.currentLba();
    if (!this.rangeOk(lba, count)) { this.fail(ERR_IDNF); return; }
    this.lba = lba;
    this.pendingSectors = count - 1;
    this.writeMode = true;
    this.bufPos = 0;
    this.drq = true;
    this.status = ATA_DRDY | ATA_DRQ;
  };

  ATA.prototype.verifyCommand = function () {
    var count = this.secCount === 0 ? 256 : this.secCount;
    if (!this.rangeOk(this.currentLba(), count)) { this.fail(ERR_IDNF); return; }
    this.done();
  };

  ATA.prototype.initParameters = function () {
    var heads = (this.devHead & 0x0F) + 1;
    var spt = this.secCount === 0 ? 256 : this.secCount;
    this.geometry = { cyl: this.geometry.cyl, heads: heads, spt: spt };
    this.done();
  };

  ATA.prototype.readData = function (width) {
    if (this.pendingCommand !== 0) this.complete();
    if (!this.drq || this.writeMode) return width === 1 ? 0x00 : 0x0000;
    var v = this.buf[this.bufPos] & 0xFFFF;
    this.bufPos++;
    if (this.bufPos >= 256) this.sectorDone();
    if (width === 2) return v;
    if (width === 4) return (v | (this.buf[this.bufPos % 256] << 16)) >>> 0;
    return v & 0xFF;
  };

  ATA.prototype.writeData = function (width, v) {
    if (this.pendingCommand !== 0) this.complete();
    if (!this.drq || !this.writeMode) return;
    this.buf[this.bufPos] = v & 0xFFFF;
    this.bufPos++;
    if (this.bufPos >= 256) this.sectorDone();
  };

  ATA.prototype.sectorDone = function () {
    this.bufPos = 0;
    if (this.writeMode) {
      this.commitSector();
      this.dirty = true;
      if (this.pendingSectors > 0) {
        this.pendingSectors--;
        this.drq = true;
        this.status = ATA_DRDY | ATA_DRQ;
        return;
      }
    } else if (this.pendingSectors > 0) {
      this.pendingSectors--;
      this.loadSector(this.lba);
      this.lba++;
      this.drq = true;
      this.status = ATA_DRDY | ATA_DRQ;
      return;
    }
    this.drq = false;
    this.status = ATA_DRDY;
    this.raiseIrq();
  };

  ATA.prototype.readSector = function (lba) {
    var off = lba * 512;
    if (off < 0 || off + 512 > this.image.length) return null;
    return this.image.subarray(off, off + 512);
  };

  ATA.prototype.writeSector = function (lba, data) {
    var off = lba * 512;
    if (off < 0 || off + 512 > this.image.length) return false;
    for (var i = 0; i < 512; i++) this.image[off + i] = data[i] & 0xFF;
    this.dirty = true;
    return true;
  };

  /* ========================= 16550A serial port ========================= */

  function Serial(bus) {
    this.bus = bus;
    this.output = '';
    this.outputLimit = 2000;
    this.rxQueue = [];
    this.rxLimit = 4096;
    this.rbr = 0;
    this.dll = 0x0C;
    this.dlm = 0x00;
    this.ier = 0x00;
    this.fcr = 0x00;
    this.lcr = 0x03;
    this.mcr = 0x00;
    this.lsr = 0x60;
    this.msr = 0xB0;
    this.scr = 0x00;
    this.threPending = true;
    this.modemPending = false;
    this.irqLevel = false;
    this.irqUp = null;
    this.irqDown = null;
    this.onByte = null;
    this.host = null;
    this.byteCount = 0;
    this.irqCount = 0;
    var self = this;
    var handler = function (reg) {
      return {
        read: function (port, width) { return self.readReg(reg, width); },
        write: function (port, width, v) { self.writeReg(reg, width, v & 0xFF); }
      };
    };
    for (var r = 0; r < 8; r++) regPort(bus, 0x3F8 + r, handler(r));
  }

  Serial.prototype.reset = function () {
    this.output = '';
    this.rxQueue.length = 0;
    this.rbr = 0;
    this.dll = 0x0C;
    this.dlm = 0x00;
    this.ier = 0x00;
    this.fcr = 0x00;
    this.lcr = 0x03;
    this.mcr = 0x00;
    this.lsr = 0x60;
    this.msr = 0xB0;
    this.scr = 0x00;
    this.threPending = true;
    this.modemPending = false;
    this.byteCount = 0;
    this.irqCount = 0;
    this.updateIrq();
  };

  Serial.prototype.dlab = function () {
    return (this.lcr & 0x80) !== 0;
  };

  Serial.prototype.updateLsrr = function () {
    this.lsr = 0x60 | (this.rxQueue.length > 0 ? 0x01 : 0x00);
  };

  Serial.prototype.iirByte = function () {
    var fifo = (this.fcr & 0x01) !== 0 ? 0xC0 : 0x00;
    if ((this.ier & 0x04) !== 0 && (this.lsr & 0x1E) !== 0) return (fifo | 0x06) & 0xFF;
    if ((this.ier & 0x01) !== 0 && (this.lsr & 0x01) !== 0) return (fifo | 0x04) & 0xFF;
    if ((this.ier & 0x02) !== 0 && this.threPending) return (fifo | 0x02) & 0xFF;
    if ((this.ier & 0x08) !== 0 && this.modemPending) return (fifo | 0x00) & 0xFF;
    return 0x01;
  };

  Serial.prototype.updateIrq = function () {
    var active = (this.iirByte() & 0x01) === 0;
    if (active && !this.irqLevel) {
      this.irqLevel = true;
      this.irqCount++;
      if (this.irqUp) this.irqUp(IRQ_SERIAL);
    } else if (!active && this.irqLevel) {
      this.irqLevel = false;
      if (this.irqDown) this.irqDown(IRQ_SERIAL);
    }
  };

  Serial.prototype.emit = function (byte) {
    this.output += String.fromCharCode(byte & 0xFF);
    if (this.output.length > this.outputLimit) {
      this.output = this.output.slice(this.output.length - this.outputLimit);
    }
    this.byteCount++;
    if (this.onByte) this.onByte(byte & 0xFF);
    if (this.host && typeof this.host.onSerial === 'function') {
      this.host.onSerial(String.fromCharCode(byte & 0xFF));
    }
  };

  Serial.prototype.transmit = function (byte) {
    this.emit(byte);
    if ((this.mcr & 0x10) !== 0) this.receive(byte);
    this.threPending = true;
    this.updateIrq();
  };

  Serial.prototype.writeText = function (s) {
    for (var i = 0; i < s.length; i++) this.transmit(s.charCodeAt(i) & 0xFF);
    return this;
  };

  Serial.prototype.receive = function (byte) {
    if (this.rxQueue.length >= this.rxLimit) this.rxQueue.shift();
    this.rxQueue.push(byte & 0xFF);
    this.updateLsrr();
    this.updateIrq();
  };

  Serial.prototype.feed = function (s) {
    for (var i = 0; i < s.length; i++) this.receive(s.charCodeAt(i) & 0xFF);
    return this;
  };

  Serial.prototype.clear = function () {
    this.output = '';
    this.byteCount = 0;
    return this;
  };

  Serial.prototype.readRbr = function () {
    var v = this.rxQueue.length > 0 ? this.rxQueue.shift() : 0;
    this.rbr = v & 0xFF;
    this.updateLsrr();
    this.updateIrq();
    return this.rbr;
  };

  Serial.prototype.readReg = function (reg) {
    switch (reg) {
      case 0: return this.dlab() ? (this.dll & 0xFF) : this.readRbr();
      case 1: return this.dlab() ? (this.dlm & 0xFF) : (this.ier & 0xFF);
      case 2: {
        var v = this.iirByte();
        if ((v & 0x0E) === 0x02) this.threPending = false;
        this.updateIrq();
        return v;
      }
      case 3: return this.lcr & 0xFF;
      case 4: return this.mcr & 0xFF;
      case 5: return this.lsr & 0xFF;
      case 6: return this.msr & 0xFF;
      case 7: return this.scr & 0xFF;
      default: return 0xFF;
    }
  };

  Serial.prototype.writeReg = function (reg, width, v) {
    switch (reg) {
      case 0:
        if (this.dlab()) this.dll = v & 0xFF;
        else this.transmit(v & 0xFF);
        return;
      case 1:
        if (this.dlab()) this.dlm = v & 0xFF;
        else { this.ier = v & 0x0F; this.updateIrq(); }
        return;
      case 2:
        this.fcr = v & 0xFF;
        if ((v & 0x02) !== 0) this.rxQueue.length = 0;
        if ((v & 0x04) !== 0) this.threPending = true;
        this.updateLsrr();
        this.updateIrq();
        return;
      case 3: this.lcr = v & 0xFF; return;
      case 4: this.mcr = v & 0xFF; return;
      case 5: return;
      case 6: return;
      case 7: this.scr = v & 0xFF; return;
      default: return;
    }
  };

  /* ========================= 8237 DMA registers ========================= */

  var DMA_PAGE_PORTS = [0x87, 0x83, 0x81, 0x82, 0x8F, 0x8B, 0x89, 0x8A];

  function DMA(bus) {
    this.bus = bus;
    this.channels = [];
    for (var i = 0; i < 4; i++) {
      this.channels.push({
        address: 0, count: 0, page: 0, mode: 0, mask: true, flip: 0
      });
    }
    this.command = 0;
    this.status = 0;
    this.request = 0;
    this.maskRegister = 0x0F;
    this.pageRegisters = new Uint8Array(16);
    this.writes = 0;
    this.reads = 0;
    var self = this;
    var handler = function (reg) {
      return {
        read: function (port, width) { return self.readReg(reg); },
        write: function (port, width, v) { self.writeReg(reg, v & 0xFF); }
      };
    };
    for (var p = 0; p < 16; p++) regPort(bus, p, handler(p));
    for (var q = 0; q < 16; q++) {
      var port = 0x80 + q;
      regPort(bus, port, handler(0x80 + q));
    }
  }

  DMA.prototype.reset = function () {
    for (var i = 0; i < 4; i++) {
      var c = this.channels[i];
      c.address = 0;
      c.count = 0;
      c.page = 0;
      c.mode = 0;
      c.mask = true;
      c.flip = 0;
    }
    this.command = 0;
    this.status = 0;
    this.request = 0;
    this.maskRegister = 0x0F;
    this.pageRegisters.fill(0);
  };

  DMA.prototype.masterClear = function () {
    this.command = 0;
    this.status = 0;
    this.request = 0;
    this.maskRegister = 0x0F;
    for (var i = 0; i < 4; i++) {
      this.channels[i].flip = 0;
      this.channels[i].mask = true;
    }
  };

  DMA.prototype.readReg = function (reg) {
    this.reads++;
    if (reg < 8) {
      var c = this.channels[reg >> 1];
      var isCount = (reg & 1) !== 0;
      var v = isCount ? c.count : c.address;
      var out = c.flip === 0 ? (v & 0xFF) : ((v >>> 8) & 0xFF);
      c.flip ^= 1;
      return out & 0xFF;
    }
    if (reg === 8) return this.status & 0xFF;
    if (reg >= 0x80) return this.pageRegisters[reg - 0x80] & 0xFF;
    return 0xFF;
  };

  DMA.prototype.writeReg = function (reg, v) {
    this.writes++;
    if (reg < 8) {
      var c = this.channels[reg >> 1];
      var isCount = (reg & 1) !== 0;
      if (isCount) {
        if (c.flip === 0) c.count = (c.count & 0xFF00) | v;
        else c.count = (c.count & 0x00FF) | (v << 8);
      } else {
        if (c.flip === 0) c.address = (c.address & 0xFF00) | v;
        else c.address = (c.address & 0x00FF) | (v << 8);
      }
      c.flip ^= 1;
      return;
    }
    if (reg >= 0x80) {
      this.pageRegisters[reg - 0x80] = v & 0xFF;
      var pageChannel = DMA_PAGE_PORTS.indexOf(reg);
      if (pageChannel >= 0 && pageChannel < 4) this.channels[pageChannel].page = v & 0xFF;
      return;
    }
    switch (reg) {
      case 8: this.command = v; return;
      case 9: this.request = v; return;
      case 10: {
        var ch = v & 3;
        if ((v & 0x04) !== 0) {
          this.channels[ch].mask = true;
          this.maskRegister |= (1 << ch);
        } else {
          this.channels[ch].mask = false;
          this.maskRegister &= ~(1 << ch);
        }
        return;
      }
      case 11: this.channels[v & 3].mode = v; return;
      case 12: for (var i = 0; i < 4; i++) this.channels[i].flip = 0; return;
      case 13: this.masterClear(); return;
      case 14: this.maskRegister = 0;
        for (var j = 0; j < 4; j++) this.channels[j].mask = false;
        return;
      case 15:
        this.maskRegister = v & 0x0F;
        for (var k = 0; k < 4; k++) this.channels[k].mask = (this.maskRegister & (1 << k)) !== 0;
        return;
      default: return;
    }
  };

  DMA.prototype.getChannel = function (index) {
    return this.channels[index & 3];
  };

  /* ========================= 8272A floppy stub ========================== */

  function Floppy(bus) {
    this.bus = bus;
    this.supported = false;
    this.msr = 0x80;
    this.dor = 0x00;
    this.ccr = 0x00;
    this.dsr = 0x00;
    this.rate = 0x00;
    this.tdr = 0x00;
    this.dir = 0x00;
    this.fifo = [];
    this.lastFifo = 0x00;
    this.commands = 0;
    this.irqUp = null;
    this.irqLevel = false;
    var self = this;
    var handler = function (reg) {
      return {
        read: function (port, width) { return self.readReg(reg); },
        write: function (port, width, v) { self.writeReg(reg, v & 0xFF); }
      };
    };
    /* 0x3F6 belongs to the ATA alternate status on an AT-class machine, so the
       controller keeps the DIR register at 0x3F7 only. */
    for (var r = 0; r < 8; r++) {
      if (r !== 6) regPort(bus, 0x3F0 + r, handler(r));
    }
  }

  Floppy.prototype.reset = function () {
    this.msr = 0x80;
    this.dor = 0x00;
    this.ccr = 0x00;
    this.dsr = 0x00;
    this.rate = 0x00;
    this.tdr = 0x00;
    this.dir = 0x00;
    this.fifo.length = 0;
    this.lastFifo = 0x00;
    this.commands = 0;
    if (this.irqLevel) {
      this.irqLevel = false;
    }
  };

  Floppy.prototype.readReg = function (reg) {
    switch (reg) {
      case 0: return 0x00;
      case 1: return 0x00;
      case 2: return this.dor & 0xFF;
      case 3: return this.tdr & 0xFF;
      case 4: return 0x80;
      case 5: {
        if (this.fifo.length > 0) this.lastFifo = this.fifo.shift();
        return this.lastFifo & 0xFF;
      }
      case 6: return this.dir & 0xFF;
      case 7: return this.ccr & 0xFF;
      default: return 0xFF;
    }
  };

  Floppy.prototype.writeReg = function (reg, v) {
    switch (reg) {
      case 0: this.rate = v; return;
      case 1: return;
      case 2:
        this.dor = v;
        if ((v & 0x04) === 0) this.fifo.length = 0;
        return;
      case 3: this.tdr = v; return;
      case 4: this.dsr = v; return;
      case 5: this.command(v); return;
      case 6: this.dir = v; return;
      case 7: this.ccr = v; return;
      default: return;
    }
  };

  /* Every command finishes immediately: there is no drive, so reads fail
     with an abnormal-termination status block instead of hanging. */
  Floppy.prototype.command = function (cmd) {
    this.commands++;
    this.fifo.length = 0;
    var upper = cmd & 0x1F;
    if (upper === 0x03 || upper === 0x0F || upper === 0x04 || upper === 0x12 ||
        upper === 0x13 || upper === 0x14 || upper === 0x18 || upper === 0x19) {
      return;
    }
    if (upper === 0x08) {
      this.fifo.push(0x80);
      this.fifo.push(0x00);
      this.raiseIrq();
      return;
    }
    if (upper === 0x07) {
      this.fifo.push(0x00);
      this.fifo.push(0x00);
      this.fifo.push(0x00);
      this.fifo.push(0x00);
      this.fifo.push(0x00);
      this.fifo.push(0x00);
      this.fifo.push(0x00);
      this.raiseIrq();
      return;
    }
    this.fifo.push(0x40);
    this.fifo.push(0x04);
    this.fifo.push(0x00);
    this.fifo.push(0x00);
    this.fifo.push(0x00);
    this.fifo.push(0x01);
    this.fifo.push(0x02);
    this.raiseIrq();
  };

  Floppy.prototype.raiseIrq = function () {
    if ((this.dor & 0x08) === 0) return;
    this.irqLevel = true;
    if (this.irqUp) this.irqUp(IRQ_FLOPPY);
  };

  /* ============================ installation ============================ */

  function installPciStub(bus) {
    var stub = {
      writes: 0,
      read: function (port, width) {
        return width === 4 ? 0xFFFFFFFF : width === 2 ? 0xFFFF : 0xFF;
      },
      write: function () { stub.writes++; }
    };
    for (var p = 0xCF8; p <= 0xCFF; p++) regPort(bus, p, { read: stub.read, write: stub.write });
    return stub;
  }

  function install(bus, host) {
    if (!bus) throw new Error('I486.Devices.install needs a bus');
    host = host || {};
    var dev = {};
    var raise = function (line) {
      dev.pic.request(line);
      if (typeof host.onIrq === 'function') host.onIrq(line);
    };
    var lower = function (line) { dev.pic.release(line); };

    dev.pic = new PIC(bus);
    dev.pit = new PIT(bus);
    dev.keyboard = new Keyboard(bus);
    dev.cmos = new CMOS(bus);
    dev.vga = new VGA(bus);
    dev.ata = new ATA(bus);
    dev.serial = new Serial(bus);
    dev.dma = new DMA(bus);
    dev.floppy = new Floppy(bus);

    dev.pit.onIrq0 = function () { raise(IRQ_PIT); };
    dev.keyboard.irqUp = function () { raise(IRQ_KEYBOARD); };
    dev.keyboard.irqDown = function () { lower(IRQ_KEYBOARD); };
    dev.serial.irqUp = function () { raise(IRQ_SERIAL); };
    dev.serial.irqDown = function () { lower(IRQ_SERIAL); };
    dev.serial.host = host;
    dev.ata.irqUp = function () { raise(IRQ_ATA); };
    dev.ata.irqDown = function () { lower(IRQ_ATA); };
    dev.floppy.irqUp = function () { raise(IRQ_FLOPPY); };
    dev.vga.onModeChange = function (mode) {
      if (typeof host.onVideoMode === 'function') host.onVideoMode(mode);
      if (typeof host.onScreen === 'function') host.onScreen();
    };
    dev.pci = installPciStub(bus);

    var port92 = 0x02;
    regPort(bus, 0x92, {
      read: function () { return port92 & 0xFF; },
      write: function (port, width, v) {
        port92 = v & 0xFF;
        bus.setA20((port92 & 0x02) !== 0);
        if ((port92 & 0x01) !== 0) {
          dev.reset();
          if (typeof host.onReset === 'function') host.onReset();
        }
      }
    });
    dev.port92 = {
      get value() { return port92; },
      setA20: function (on) {
        if (on) port92 |= 0x02; else port92 &= ~0x02;
        bus.setA20(on === true);
      }
    };

    bus.setA20(true);

    dev.reset = function () {
      dev.pic.reset();
      dev.pit.reset();
      dev.keyboard.reset();
      dev.cmos.reset();
      dev.vga.reset();
      dev.ata.reset();
      dev.serial.reset();
      dev.dma.reset();
      dev.floppy.reset();
      port92 = 0x02;
      bus.setA20(true);
    };

    return dev;
  }

  return {
    Devices: {
      install: install,
      SCANCODE_ASCII: SCANCODE_ASCII,
      SCANCODE_ASCII_SHIFT: SCANCODE_ASCII_SHIFT,
      scancodeToAscii: scancodeToAscii,
      CGA_PALETTE: CGA_PALETTE,
      IRQ_PIT: IRQ_PIT,
      IRQ_KEYBOARD: IRQ_KEYBOARD,
      IRQ_CASCADE: IRQ_CASCADE,
      IRQ_SERIAL: IRQ_SERIAL,
      IRQ_FLOPPY: IRQ_FLOPPY,
      IRQ_ATA: IRQ_ATA,
      PIC: PIC,
      PIT: PIT,
      Keyboard: Keyboard,
      CMOS: CMOS,
      VGA: VGA,
      ATA: ATA,
      Serial: Serial,
      DMA: DMA,
      Floppy: Floppy
    }
  };
});
