'use strict';

/* Suite for I486.Bus and I486.Devices. Standalone:
     node i486/test/devices.test.cjs
   It is also required by run-all.cjs, which calls harness.run() itself. */

var harness = require('./harness.cjs');
var Bus = require('../lib/bus.js').Bus;
var Devices = require('../lib/devices.js').Devices;

var eq = harness.eq;
var assert = harness.assert;
var bytes = harness.bytes;
var near = harness.near;

function rig(opts) {
  var bus = new Bus(opts || { ramMB: 4 });
  var dev = Devices.install(bus, {});
  return { bus: bus, dev: dev, io: bus.io };
}

function programPic(io, masterMask, slaveMask) {
  io.out8(0x20, 0x11);
  io.out8(0x21, 0x20);
  io.out8(0x21, 0x04);
  io.out8(0x21, 0x01);
  io.out8(0xA0, 0x11);
  io.out8(0xA1, 0x70);
  io.out8(0xA1, 0x02);
  io.out8(0xA1, 0x01);
  io.out8(0x21, masterMask === undefined ? 0xE8 : masterMask);
  io.out8(0xA1, slaveMask === undefined ? 0x00 : slaveMask);
}

function fakeCanvas(width, height) {
  var ops = [];
  var ctx = {
    fillStyle: '',
    font: '',
    textBaseline: '',
    imageSmoothingEnabled: true,
    fillRect: function (x, y, w, h) { ops.push(['fillRect', x, y, w, h, this.fillStyle]); },
    fillText: function (t, x, y) { ops.push(['fillText', t, x, y, this.fillStyle]); },
    clearRect: function () { ops.push(['clearRect']); },
    createImageData: function (w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData: function (img, x, y) { ops.push(['putImageData', img.width, img.height, x, y]); }
  };
  return {
    width: width,
    height: height,
    ops: ops,
    ctx: ctx,
    getContext: function (kind) { return kind === '2d' ? ctx : null; }
  };
}

function ataIdentify(io, dev) {
  io.out8(0x1F6, 0xE0);
  io.out8(0x1F7, 0xEC);
  var busy = io.in8(0x1F7);
  var ready = io.in8(0x1F7);
  var words = [];
  for (var i = 0; i < 256; i++) words.push(io.in16(0x1F0));
  return { busy: busy, ready: ready, words: words };
}

function ataWordsToString(words, start, count) {
  var s = '';
  for (var i = 0; i < count; i += 2) {
    var w = words[start + (i >> 1)];
    s += String.fromCharCode((w >>> 8) & 0xFF) + String.fromCharCode(w & 0xFF);
  }
  return s;
}

/* --------------------------------- bus --------------------------------- */

harness.suite('bus', function () {
  harness.test('ram byte/word/dword little endian', function () {
    var bus = new Bus({ ramMB: 4 });
    bus.write8(0x1000, 0x12);
    eq(bus.read8(0x1000), 0x12, 'byte');
    bus.write16(0x2000, 0xBEEF);
    eq(bus.read8(0x2000), 0xEF, 'low byte');
    eq(bus.read8(0x2001), 0xBE, 'high byte');
    eq(bus.read16(0x2000), 0xBEEF, 'word');
    bus.write32(0x3000, 0xDEADBEEF);
    eq(bus.read32(0x3000) >>> 0, 0xDEADBEEF, 'dword');
    eq(bus.ram[0x3000], 0xEF, 'ram view');
    eq(bus.ram[0x3003], 0xDE, 'ram view high');
    eq(bus.read8(0x100000), 0x00, 'high ram');
    bus.write8(0x100000, 0x5A);
    eq(bus.read8(0x100000), 0x5A, 'high ram write');
    bus.write32(0x3FFFFC, 0x01020304);
    eq(bus.read8(0x3FFFFC), 0x04, 'last ram byte');
    eq(bus.read32(0x3FFFFC) >>> 0, 0x01020304, 'last ram dword');
  });

  harness.test('unaligned accesses split into bytes', function () {
    var bus = new Bus({ ramMB: 4 });
    bus.write32(0x4001, 0x11223344);
    eq(bus.read8(0x4001), 0x44, 'b0');
    eq(bus.read8(0x4002), 0x33, 'b1');
    eq(bus.read8(0x4004), 0x11, 'b3');
    eq(bus.read16(0x4001), 0x3344, 'word at odd');
    eq(bus.read32(0x4001) >>> 0, 0x11223344, 'dword at odd');
    bus.write16(0x5003, 0xAABB);
    eq(bus.read8(0x5003), 0xBB);
    eq(bus.read8(0x5004), 0xAA);
    eq(bus.read16(0x5003), 0xAABB);
  });

  harness.test('device hole is not ram', function () {
    var bus = new Bus({ ramMB: 4 });
    eq(bus.read8(0xA0000), 0xFF, 'vga aperture without a device is open bus');
    eq(bus.read8(0xC0000), 0xFF, 'open bus');
    eq(bus.read8(0xEFFFF), 0xFF, 'open bus top');
    bus.write8(0xC0000, 0x42);
    eq(bus.read8(0xC0000), 0xFF, 'unmapped write ignored');
    eq(bus.ram[0xC0000], 0x00, 'ram not touched in the hole');
    assert(bus.errorLog.length > 0, 'unmapped write logged');
  });

  harness.test('rom is readable and write protected', function () {
    var bus = new Bus({ ramMB: 4 });
    var rom = new Uint8Array(0x10000);
    for (var i = 0; i < rom.length; i++) rom[i] = i & 0xFF;
    rom[0xFFF0] = 0xEA;
    bus.setROM(0xF0000, rom);
    eq(bus.read8(0xF0000), 0x00);
    eq(bus.read8(0xF0001), 0x01);
    eq(bus.read8(0xFFFFF), 0xFF);
    bus.write8(0xF0000, 0x99);
    eq(bus.read8(0xF0000), 0x00, 'rom write ignored');
    eq(bus.read8(0xFFFFFFF0), 0xEA, 'reset vector aliases rom');
    assert(bus.errorLog.length > 0, 'rom write logged');
  });

  harness.test('mmio handlers win over ram', function () {
    var bus = new Bus({ ramMB: 4 });
    var written = [];
    bus.mapRead(0x1000, 0x10, function (pa, width) { return (0xA0 + (pa & 0x0F)) & 0xFF; });
    bus.mapWrite(0x1000, 0x10, function (pa, width, v) { written.push([pa, v]); });
    eq(bus.read8(0x1004), 0xA4, 'mmio read');
    bus.write8(0x1004, 0x77);
    eq(written.length, 1, 'mmio write captured');
    eq(written[0][0], 0x1004);
    eq(written[0][1], 0x77);
    eq(bus.read8(0x1004), 0xA4, 'ram unchanged under mmio');
    eq(bus.read8(0x1010), 0x00, 'outside the map is ram');
    bus.write8(0x1010, 0x33);
    eq(bus.read8(0x1010), 0x33);
    var hi = 0;
    bus.mapRead(0x200000, 4, function () { hi++; return 0x5A; });
    eq(bus.read8(0x200000), 0x5A, 'high mmio');
    eq(hi, 1);
    bus.mapRead(0x1000, 0x10, function () { return 0x3C; });
    eq(bus.read8(0x1004), 0x3C, 're-mapping a base replaces the handler');
    eq(bus.readMaps.length, 2, 'no duplicate maps');
  });

  harness.test('a20 gate masks bit 20', function () {
    var bus = new Bus({ ramMB: 4 });
    eq(bus.a20, true, 'a20 on at power on');
    bus.write8(0x100010, 0x99);
    bus.setA20(false);
    eq(bus.a20, false);
    bus.write8(0x100010, 0x77);
    eq(bus.read8(0x10), 0x77, 'masked write landed low');
    eq(bus.read8(0x100010), 0x77, 'reading through the mask');
    bus.setA20(true);
    bus.write8(0x100010, 0x55);
    eq(bus.read8(0x10), 0x77, 'unmasked write stays high');
    eq(bus.read8(0x100010), 0x55);
    eq(bus.setA20(0), false, 'setA20(0) disables');
    bus.setA20(true);
  });

  harness.test('getBytes and setBytes', function () {
    var bus = new Bus({ ramMB: 4 });
    bus.setBytes(0x6000, [1, 2, 3, 4, 5]);
    bytes(bus.getBytes(0x6000, 5), [1, 2, 3, 4, 5]);
    eq(bus.read8(0x6004), 5);
    var u8 = new Uint8Array([9, 8, 7]);
    bus.setBytes(0x6100, u8);
    bytes(bus.getBytes(0x6100, 3), [9, 8, 7]);
    eq(bus.getBytes(0xC0000, 2)[0], 0xFF, 'getBytes across open bus');
  });

  harness.test('error log is capped at 200 entries', function () {
    var bus = new Bus({ ramMB: 4 });
    for (var i = 0; i < 300; i++) bus.write8(0xC0000 + i * 0x1000, 0x11);
    assert(bus.errorLog.length <= 200, 'cap respected, got ' + bus.errorLog.length);
    assert(bus.errorLog.length > 0, 'log has entries');
    bus.log('x');
    assert(bus.errorLog[bus.errorLog.length - 1] === 'x', 'newest last');
  });

  harness.test('top of the address space and rom arrays', function () {
    var bus = new Bus({ ramMB: 2 });
    eq(bus.read8(0xFFFFFFFF), 0xFF, 'top byte');
    eq(bus.read32(0xFFFFFFFE) >>> 0, 0x0000FFFF, 'wide access wraps at 4GB');
    eq(bus.read32(0xFFFFF000) >>> 0, 4294967295, 'fully inside open bus');
    eq(bus.read16(0xFFFFFFF), 0xFFFF, 'word at the top');
    eq(bus.getBytes(0xFFFFFE, 4).length, 4, 'getBytes at the top');
    bus.setROM(0xF0000, [1, 2, 3, 4]);
    eq(bus.read8(0xF0000), 1, 'plain array rom');
    eq(bus.read8(0xF0003), 4);
    eq(bus.read8(0xF0004), 0xFF, 'past the end of the rom');
    bus.write16(0xE0000, 0x1234);
    bus.write32(0xD0000, 0xABCDEF01);
    eq(bus.read8(0xD0000), 0xFF, 'writes to open bus are ignored');
  });

  harness.test('port space: widths, first-wins, diagnostics', function () {
    var bus = new Bus({ ramMB: 4 });
    var io = bus.io;
    var last = 0;
    io.addPort(0x300, {
      read: function (port, width) { return width === 1 ? 0xAB : 0xABCD; },
      write: function (port, width, v) { last = v; }
    });
    eq(io.in8(0x300), 0xAB, 'in8');
    eq(io.in16(0x300), 0xABCD, 'in16');
    io.out8(0x300, 0x12);
    eq(last, 0x12, 'out8');
    io.out16(0x300, 0x3456);
    eq(last, 0x3456, 'out16');
    assert(io.ports.has(0x300), 'port listed');
    var second = { read: function () { return 0x11; }, write: function () { } };
    io.addPort(0x300, second);
    eq(io.in8(0x300), 0xAB, 'first registration wins');
    io.addPort(0x300, second, true);
    eq(io.in8(0x300), 0x11, 'forced re-registration');
    eq(io.in8(0x301), 0xFF, 'unhandled read');
    eq(io.in16(0x301), 0xFFFF, 'unhandled word read');
    eq(io.in32(0x301) >>> 0, 4294967295, 'unhandled dword read');
    eq(bus.unhandledPorts.get(0x301) >= 1, true, 'diagnostic counted');
    eq(io.in8(0x77), 0xFF);
    eq(bus.unhandledPorts.get(0x77), 1, 'counted once for one access');
    assert(bus.errorLog.length > 0, 'unmapped port logged');
    io.removePort(0x300);
    eq(io.in8(0x300), 0xFF, 'removed');
  });
});

/* --------------------------------- pic --------------------------------- */

harness.suite('pic 8259A', function () {
  harness.test('icw init and vector ack', function () {
    var r = rig();
    var io = r.io;
    programPic(io);
    eq(io.in8(0x21), 0xE8, 'master imr');
    eq(io.in8(0xA1), 0x00, 'slave imr');
    r.dev.pic.request(4);
    eq(r.dev.pic.ack(), 0x24, 'IRQ4 vector');
    eq(r.dev.pic.isr(), 0x10, 'ISR bit 4');
    io.out8(0x20, 0x0B);
    eq(io.in8(0x20), 0x10, 'OCW3 read ISR');
    io.out8(0x20, 0x0A);
    eq(io.in8(0x20), 0x00, 'OCW3 read IRR is empty after ack');
    io.out8(0x20, 0x20);
    io.out8(0x20, 0x0B);
    eq(io.in8(0x20), 0x00, 'EOI cleared ISR');
    eq(r.dev.pic.ack(), null, 'nothing pending');
  });

  harness.test('masking blocks ack', function () {
    var r = rig();
    programPic(r.io, 0xFF);
    r.dev.pic.request(0);
    eq(r.dev.pic.ack(), null, 'masked request not delivered');
    eq((r.dev.pic.master.irr & 1), 1, 'IRR latched even when masked');
    r.io.out8(0x21, 0xFE);
    eq(r.dev.pic.ack(), 0x20, 'delivered once unmasked');
    eq(r.dev.pic.isr(), 0x01);
  });

  harness.test('cascade through IRQ2 to the slave', function () {
    var r = rig();
    var io = r.io;
    programPic(io);
    r.dev.pic.request(14);
    eq(r.dev.pic.master.irr & 0x04, 0x04, 'cascade line asserted');
    eq(r.dev.pic.ack(), 0x76, 'slave vector for IRQ14');
    eq(r.dev.pic.master.isr, 0x04, 'master ISR2');
    eq(r.dev.pic.slave.isr, 0x40, 'slave ISR6');
    io.out8(0xA0, 0x0B);
    eq(io.in8(0xA0), 0x40, 'slave ISR readback');
    io.out8(0xA0, 0x20);
    eq(r.dev.pic.slave.isr, 0x00, 'slave EOI');
    io.out8(0x21, 0xFF);
    eq(r.dev.pic.ack(), null, 'master still in service until EOI');
    io.out8(0x20, 0x20);
    eq(r.dev.pic.master.isr, 0x00, 'master EOI');
  });

  harness.test('specific EOI and rotation', function () {
    var r = rig();
    var io = r.io;
    programPic(io, 0xE8);
    r.dev.pic.request(0);
    r.dev.pic.request(4);
    eq(r.dev.pic.ack(), 0x20, 'IRQ0 first');
    r.dev.pic.request(4);
    io.out8(0x20, 0x60);
    eq(r.dev.pic.master.isr, 0x00, 'specific EOI for level 0');
    r.dev.pic.release(0);
    eq(r.dev.pic.ack(), 0x24, 'IRQ4 next');
    io.out8(0x20, 0x64);
    eq(r.dev.pic.master.isr, 0x00, 'specific EOI for level 4');
    r.dev.pic.release(4);
    io.out8(0x20, 0xC0);
    r.dev.pic.request(0);
    r.dev.pic.request(1);
    eq(r.dev.pic.ack(), 0x21, 'rotated priority serves IRQ1 first');
  });

  harness.test('spurious IRQ7 and IRQ15 vectors', function () {
    var r = rig();
    var io = r.io;
    programPic(io, 0xFB, 0xFF);
    r.dev.pic.master.request(2);
    eq(r.dev.pic.ack(), 0x27, 'spurious IRQ7 vector');
    eq(r.dev.pic.master.isr, 0x00, 'no ISR bit for a spurious ack');
    eq(r.dev.pic.lastSpurious, 7, 'flagged');
    eq(r.dev.pic.spuriousCount, 1);
    eq(r.dev.pic.ackSlaveSpurious(), 0x77, 'spurious IRQ15 vector');
    eq(r.dev.pic.slave.isr, 0x00);
    eq(r.dev.pic.lastSpurious, 15);
  });

  harness.test('poll mode performs an implicit ack', function () {
    var r = rig();
    var io = r.io;
    programPic(io, 0xEA);
    r.dev.pic.request(4);
    io.out8(0x20, 0x0C);
    eq(io.in8(0x20), 0x84, 'poll byte: INT set, level 4');
    eq(r.dev.pic.master.isr, 0x10, 'ISR marked by poll');
    eq(r.dev.pic.master.irr & 0x10, 0x00, 'IRR cleared by poll');
    io.out8(0x20, 0x20);
  });

  harness.test('level and edge requests follow the line', function () {
    var r = rig();
    programPic(r.io, 0xEA);
    r.dev.pic.request(4);
    eq(r.dev.pic.master.pendingMask(), 0x10);
    r.dev.pic.release(4);
    eq(r.dev.pic.master.pendingMask(), 0x00, 'release clears IRR');
    r.dev.pic.request(0);
    eq(r.dev.pic.pending(), true);
    eq(r.dev.pic.irr(), 0x01);
    r.dev.pic.release(0);
    eq(r.dev.pic.pending(), false);
    eq(r.dev.pic.masked(0), false, 'line 0 unmasked');
    eq(r.dev.pic.masked(1), true, 'line 1 masked');
  });
});

/* --------------------------------- pit --------------------------------- */

harness.suite('pit 8254', function () {
  harness.test('divider to frequency and irq0 rate', function () {
    var r = rig();
    var io = r.io;
    eq(r.dev.pit.clockHz, 1193182, 'base clock');
    io.out8(0x43, 0x36);
    io.out8(0x40, 1193 & 0xFF);
    io.out8(0x40, (1193 >>> 8) & 0xFF);
    eq(r.dev.pit.divider(0), 1193);
    near(r.dev.pit.counterFrequency(0), 1000, 1, 'divider 1193 is about 1 kHz');
    eq(r.dev.pit.irq0Count, 0);
    r.dev.pit.advance(1192);
    eq(r.dev.pit.irq0Count, 0, 'no tick before the period ends');
    r.dev.pit.advance(1);
    eq(r.dev.pit.irq0Count, 1, 'one tick per period');
    r.dev.pit.advance(1193);
    eq(r.dev.pit.irq0Count, 2, 'periodic');
  });

  harness.test('divider 0 means 65536', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x43, 0x36);
    io.out8(0x40, 0x00);
    io.out8(0x40, 0x00);
    eq(r.dev.pit.divider(0), 65536, 'reload 0 means 65536');
    near(r.dev.pit.counterFrequency(0), 18.2065, 0.001, '18.2 Hz');
    r.dev.pit.advance(65535);
    eq(r.dev.pit.irq0Count, 0);
    r.dev.pit.advance(1);
    eq(r.dev.pit.irq0Count, 1);
  });

  harness.test('counter latch protocol', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x43, 0x36);
    io.out8(0x40, 0xA9);
    io.out8(0x40, 0x04);
    r.dev.pit.advance(500);
    io.out8(0x43, 0x00);
    var lo = io.in8(0x40);
    var hi = io.in8(0x40);
    eq(lo, 693 & 0xFF, 'latched low byte');
    eq(hi, 693 >>> 8, 'latched high byte');
    r.dev.pit.advance(100);
    io.out8(0x43, 0x00);
    eq(io.in8(0x40), 593 & 0xFF, 'fresh latch after more ticks');
    eq(io.in8(0x40), 593 >>> 8);
  });

  harness.test('mode 3 square wave output toggles', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x43, 0x36);
    io.out8(0x40, 0x10);
    io.out8(0x40, 0x00);
    eq(r.dev.pit.getOut(0), 1, 'starts high');
    r.dev.pit.advance(8);
    eq(r.dev.pit.getOut(0), 0, 'toggled at the half period');
    r.dev.pit.advance(8);
    eq(r.dev.pit.getOut(0), 1, 'toggled back at the end');
    eq(r.dev.pit.irq0Count, 1);
  });

  harness.test('mode 2 rate generator pulses every period', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x43, 0x34);
    io.out8(0x40, 2);
    io.out8(0x40, 0);
    eq(r.dev.pit.counters[0].mode, 2);
    eq(r.dev.pit.divider(0), 2);
    r.dev.pit.advance(2);
    eq(r.dev.pit.irq0Count, 1);
    r.dev.pit.advance(4);
    eq(r.dev.pit.irq0Count, 3, 'two more periods');
  });

  harness.test('mode 0 fires once then stops', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x43, 0x30);
    io.out8(0x40, 5);
    io.out8(0x40, 0);
    r.dev.pit.advance(5);
    eq(r.dev.pit.irq0Count, 1);
    r.dev.pit.advance(50);
    eq(r.dev.pit.irq0Count, 1, 'one shot');
    eq(r.dev.pit.counters[0].enabled, false);
  });

  harness.test('readback of a programmed counter', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x43, 0x34);
    io.out8(0x40, 0x34);
    io.out8(0x40, 0x12);
    eq(r.dev.pit.divider(0), 0x1234);
    eq(io.in8(0x40), 0x34, 'lsb then msb');
    eq(io.in8(0x40), 0x12);
    io.out8(0x43, 0x1A);
    eq(io.in8(0x40), 0x34, 'lsb only mode');
    io.out8(0x43, 0x2A);
    eq(io.in8(0x40), 0x12, 'msb only mode');
  });

  harness.test('large cycle deltas are accounted in bulk', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x43, 0x36);
    io.out8(0x40, 100);
    io.out8(0x40, 0);
    eq(r.dev.pit.advance(1000000), 1000000, 'ticks consumed');
    eq(r.dev.pit.irq0Count, 10000, 'ten thousand periods in one step');
    eq(r.dev.pit.counters[0].enabled, true, 'still running');
    eq(r.dev.pit.counters[0].fireCount, 10000);
  });

  harness.test('irq0 reaches the pic', function () {
    var r = rig();
    var io = r.io;
    programPic(io, 0xEA);
    io.out8(0x43, 0x36);
    io.out8(0x40, 10);
    io.out8(0x40, 0);
    r.dev.pit.advance(10);
    eq(r.dev.pic.master.pendingMask() & 0x01, 0x01, 'irq0 pending');
    eq(r.dev.pic.ack(), 0x20, 'timer vector');
    io.out8(0x20, 0x20);
    eq(r.dev.pit.ticks, 10, 'input ticks tracked');
    eq(r.dev.pit.advance(0), 0, 'no ticks for 0 cycles');
  });
});

/* ------------------------------- keyboard ------------------------------- */

harness.suite('keyboard 8042', function () {
  harness.test('scancode queue and irq1', function () {
    var r = rig();
    var io = r.io;
    programPic(io, 0xE8);
    eq(r.dev.keyboard.readStatus(), 0x04, 'SYS set, no output at reset');
    r.dev.keyboard.press(0x1E);
    eq(r.dev.keyboard.readStatus(), 0x05, 'OBF after a make code');
    eq(io.in8(0x60), 0x1E, 'make code read');
    eq(r.dev.keyboard.readStatus(), 0x04, 'OBF cleared');
    eq(r.dev.pic.master.irr & 0x02, 0x00, 'irq1 released after the read');
    r.dev.keyboard.release(0x1E);
    eq(io.in8(0x60), 0x9E, 'break code');
    r.dev.keyboard.press(0x20);
    eq(r.dev.pic.master.pendingMask() & 0x02, 0x02, 'irq1 asserted');
    eq(r.dev.pic.ack(), 0x21, 'keyboard vector');
    eq(io.in8(0x60), 0x20);
    io.out8(0x20, 0x20);
  });

  harness.test('controller self test and command byte', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x64, 0xAA);
    eq(io.in8(0x60), 0x55, 'self test passed');
    io.out8(0x64, 0xAB);
    eq(io.in8(0x60), 0x00, 'interface test');
    io.out8(0x64, 0x20);
    eq(io.in8(0x60), 0x45, 'read command byte');
    io.out8(0x64, 0x60);
    io.out8(0x60, 0x44);
    io.out8(0x64, 0x20);
    eq(io.in8(0x60), 0x44, 'write command byte');
    r.dev.keyboard.press(0x1E);
    eq(r.dev.pic.master.irr & 0x02, 0x00, 'irq1 disabled by command byte bit 0');
    eq(r.dev.keyboard.readStatus() & 0x01, 0x01, 'byte still queued');
    eq(io.in8(0x60), 0x1E);
  });

  harness.test('keyboard enable/disable and echo', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x64, 0xAD);
    eq(r.dev.keyboard.readStatus() & 0x10, 0x10, 'INH set by 0xAD');
    io.out8(0x64, 0xAE);
    eq(r.dev.keyboard.readStatus() & 0x10, 0x00, 'INH cleared by 0xAE');
    io.out8(0x60, 0xEE);
    eq(io.in8(0x60), 0xEE, 'echo');
    io.out8(0x60, 0xF0);
    eq(io.in8(0x60), 0xFA, 'ack for set/get scancode');
    io.out8(0x64, 0xFF);
    eq(io.in8(0x60), 0xFA, 'reset ack');
    eq(io.in8(0x60), 0xAA, 'BAT ok');
  });

  harness.test('scancode to ascii table', function () {
    var r = rig();
    var kb = r.dev.keyboard;
    eq(kb.toAscii(0x1E, false), 97, 'a');
    eq(kb.toAscii(0x1E, true), 65, 'A');
    eq(kb.toAscii(0x02, false), 49, '1');
    eq(kb.toAscii(0x02, true), 33, '!');
    eq(kb.toAscii(0x39, false), 32, 'space');
    eq(kb.toAscii(0x1C, false), 13, 'enter');
    eq(kb.toAscii(0x0E, false), 8, 'backspace');
    eq(kb.toAscii(0x9E, false), 97, 'break code maps to make');
    eq(kb.toAscii(0x2A, false), 0, 'shift is not printable');
    eq(Devices.SCANCODE_ASCII[0x1E], 97, 'table exported');
    eq(Devices.scancodeToAscii(0x10, true), 81, 'helper exported');
    eq(kb.pending(), 0, 'queue empty');
  });

  harness.test('reset clears the queue', function () {
    var r = rig();
    r.dev.keyboard.press(0x1E);
    r.dev.keyboard.press(0x20);
    eq(r.dev.keyboard.pending(), 2);
    r.dev.keyboard.reset();
    eq(r.dev.keyboard.pending(), 0);
    eq(r.dev.keyboard.readStatus(), 0x04);
  });
});

/* -------------------------------- cmos --------------------------------- */

harness.suite('cmos rtc', function () {
  harness.test('bcd time fields', function () {
    var r = rig();
    var io = r.io;
    var cmos = r.dev.cmos;
    cmos.setTime({ year: 2024, month: 6, day: 15, hour: 12, minute: 30, second: 45 });
    io.out8(0x70, 0x00);
    eq(io.in8(0x71), 0x45, 'seconds BCD');
    io.out8(0x70, 0x02);
    eq(io.in8(0x71), 0x30, 'minutes BCD');
    io.out8(0x70, 0x04);
    eq(io.in8(0x71), 0x12, 'hours BCD 24h');
    io.out8(0x70, 0x07);
    eq(io.in8(0x71), 0x15, 'day BCD');
    io.out8(0x70, 0x08);
    eq(io.in8(0x71), 0x06, 'month BCD');
    io.out8(0x70, 0x09);
    eq(io.in8(0x71), 0x24, 'year BCD');
    io.out8(0x70, 0x06);
    eq(io.in8(0x71), 0x07, 'weekday 1..7');
    io.out8(0x70, 0x32);
    eq(io.in8(0x71), 0x20, 'century');
  });

  harness.test('status registers and memory size', function () {
    var r = rig();
    var io = r.io;
    io.out8(0x70, 0x0A);
    var a = io.in8(0x71);
    eq(a & 0x80, 0x00, 'UIP clear');
    eq(r.dev.cmos.updateInProgress(), false);
    io.out8(0x70, 0x0B);
    eq(io.in8(0x71) & 0x02, 0x02, '24 hour mode');
    io.out8(0x70, 0x0D);
    eq(io.in8(0x71), 0x80, 'battery valid');
    io.out8(0x70, 0x12);
    eq(io.in8(0x71), 0xF0, 'hard disk type');
    io.out8(0x70, 0x14);
    eq(io.in8(0x71), 0x20, 'equipment byte: 80 column, no floppy');
    io.out8(0x70, 0x10);
    eq(io.in8(0x71), 0x00, 'no floppy drive configured');
    io.out8(0x70, 0x17);
    eq(io.in8(0x71), 3072 & 0xFF, 'memory above 1MB low');
    io.out8(0x70, 0x18);
    eq(io.in8(0x71), 3072 >>> 8, 'memory above 1MB high');
    io.out8(0x70, 0x30);
    eq(io.in8(0x71), 3072 & 0xFF, 'extended memory low');
    io.out8(0x70, 0x31);
    eq(io.in8(0x71), 3072 >>> 8);
    io.out8(0x70, 0x34);
    eq(io.in8(0x71), 3072 / 64, 'extended memory in 64K blocks');
  });

  harness.test('time rollover is calendar correct', function () {
    var r = rig();
    var io = r.io;
    var cmos = r.dev.cmos;
    cmos.setTime({ year: 2024, month: 6, day: 15, hour: 12, minute: 30, second: 45 });
    cmos.advance(30);
    eq(cmos.getRegister(0x00), 0x15, 'seconds wrapped');
    eq(cmos.getRegister(0x02), 0x31, 'minute carried');
    cmos.setTime({ year: 2023, month: 12, day: 31, hour: 23, minute: 59, second: 59 });
    cmos.advance(1);
    eq(cmos.getRegister(0x09), 0x24, 'year rolled');
    eq(cmos.getRegister(0x08), 0x01, 'month rolled');
    eq(cmos.getRegister(0x07), 0x01, 'day rolled');
    eq(cmos.getRegister(0x04), 0x00, 'hour rolled');
    eq(cmos.getRegister(0x02), 0x00);
    eq(cmos.getRegister(0x00), 0x00);
    cmos.setTime({ year: 2024, month: 2, day: 28, hour: 23, minute: 59, second: 59 });
    cmos.advance(1);
    eq(cmos.getRegister(0x07), 0x29, 'leap day');
    eq(cmos.getRegister(0x08), 0x02);
    var f = cmos.timeFields();
    eq(f.year, 2024);
    eq(f.month, 2);
    eq(f.day, 29);
    eq(f.dayName, 'Thu');
  });

  harness.test('12 hour and binary modes', function () {
    var r = rig();
    var cmos = r.dev.cmos;
    cmos.setTime({ year: 2024, month: 6, day: 15, hour: 13, minute: 5, second: 9 });
    r.io.out8(0x71 - 1, 0x0B);
    r.io.out8(0x71, 0x00);
    eq(cmos.getRegister(0x04), 0x81, '1 PM with the PM bit');
    eq(cmos.getRegister(0x02), 0x05);
    r.io.out8(0x70, 0x0B);
    r.io.out8(0x71, 0x06);
    eq(cmos.binaryMode(), true);
    eq(cmos.getRegister(0x04), 13, 'binary hours');
    eq(cmos.getRegister(0x00), 9, 'binary seconds');
    eq(cmos.getRegister(0x09), 24, 'binary year');
  });

  harness.test('cmos ram, nmi bit and status C', function () {
    var r = rig();
    var io = r.io;
    var cmos = r.dev.cmos;
    io.out8(0x70, 0x40);
    io.out8(0x71, 0xAB);
    eq(cmos.getRegister(0x40), 0xAB, 'ram byte');
    io.out8(0x70, 0x80);
    eq(io.in8(0x70) & 0x80, 0x80, 'nmi disable readback');
    eq(cmos.nmiDisabled, true);
    cmos.ram[0x0C] = 0x40;
    eq(cmos.getRegister(0x0C), 0x40, 'status C');
    eq(cmos.getRegister(0x0C), 0x00, 'status C cleared on read');
    io.out8(0x70, 0x00);
    eq(cmos.nmiDisabled, false);
    eq(cmos.getRegister(0x0F), 0x00, 'shutdown byte');
  });
});

/* --------------------------------- vga --------------------------------- */

harness.suite('vga', function () {
  harness.test('text mode buffer and helpers', function () {
    var r = rig();
    var vga = r.dev.vga;
    eq(vga.text.length, 2000, 'one word per cell');
    vga.setMode(3);
    eq(vga.mode, 3, 'mode 3');
    eq(vga.getLine(0), '', 'screen cleared by a mode set');
    vga.writeChar(0x48, 0x0F, 0, 0);
    vga.writeChar(0x49, 0x0F, 1, 0);
    eq(vga.getLine(0), 'HI');
    eq(vga.getScreenText().length, 25);
    eq(vga.getScreenText()[0], 'HI');
    eq(vga.text[0] & 0xFF, 0x48, 'char in the low byte');
    eq(vga.text[0] >>> 8, 0x0F, 'attribute in the high byte');
    vga.writeChar(0x21, 0x1F, 79, 24);
    eq(vga.getLine(24), ' '.repeat(79) + '!', 'last cell');
    eq(vga.readChar(0, 0).ch, 0x48);
    eq(vga.readChar(0, 0).attr, 0x0F);
    vga.writeChar(0x2A, 0x07, 100, 0);
    eq(vga.getLine(0), 'HI', 'out of range write ignored');
  });

  harness.test('text memory window at 0xB8000', function () {
    var r = rig();
    var bus = r.bus;
    var vga = r.dev.vga;
    vga.setMode(3);
    bus.write8(0xB8000, 0x41);
    bus.write8(0xB8001, 0x1E);
    eq(vga.text[0] & 0xFF, 0x41, 'char through memory');
    eq(vga.text[0] >>> 8, 0x1E, 'attr through memory');
    eq(bus.read8(0xB8000), 0x41, 'read back');
    eq(bus.read8(0xB8001), 0x1E);
    bus.write16(0xB8002, 0x0742);
    eq(vga.text[1] & 0xFF, 0x42, 'word write');
    eq(vga.text[1] >>> 8, 0x07);
    eq(bus.read16(0xB8002), 0x0742);
    bus.write8(0xB0000, 0x99);
    eq(vga.text[0] & 0xFF, 0x41, 'mono window does not alias text');
    eq(bus.read8(0xB0000), 0x00);
  });

  harness.test('crtc cursor and start address', function () {
    var r = rig();
    var io = r.io;
    var vga = r.dev.vga;
    vga.setMode(3);
    vga.setCursor(5, 3);
    eq(vga.cursorLocation, 5 + 3 * 80, 'cursor location register');
    eq(vga.cursor.x, 5, 'cursor x');
    eq(vga.cursor.y, 3, 'cursor y');
    io.out8(0x3D4, 0x0E);
    eq(io.in8(0x3D5), (5 + 3 * 80) >>> 8, 'CRTC 0x0E');
    io.out8(0x3D4, 0x0F);
    eq(io.in8(0x3D5), (5 + 3 * 80) & 0xFF, 'CRTC 0x0F');
    eq(vga.cursorEnabled, true);
    io.out8(0x3D4, 0x0A);
    io.out8(0x3D5, 0x2D);
    eq(vga.cursorEnabled, false, 'cursor disabled by bit 5');
    vga.setCursor(200, -5);
    eq(vga.cursor.x, 79, 'clamped');
    eq(vga.cursor.y, 0);
    vga.writeChar(0x58, 0x07, 0, 1);
    io.out8(0x3D4, 0x0C);
    io.out8(0x3D5, 0x00);
    io.out8(0x3D4, 0x0D);
    io.out8(0x3D5, 80);
    eq(vga.startAddress, 80, 'start address');
    eq(vga.getLine(0), 'X', 'view follows the start address');
    vga.setCursor(3, 2);
    eq(vga.cursorLocation, 80 + 2 * 80 + 3, 'cursor location is absolute');
    eq(vga.cursor.x, 3, 'cursor x relative to the start address');
    eq(vga.cursor.y, 2, 'cursor y relative to the start address');
  });

  harness.test('scroll helpers', function () {
    var r = rig();
    var vga = r.dev.vga;
    vga.setMode(3);
    vga.writeChar(0x41, 0x07, 0, 0);
    vga.writeChar(0x42, 0x07, 0, 1);
    vga.writeChar(0x43, 0x07, 0, 2);
    vga.scrollUp(1, 0x07);
    eq(vga.getLine(0), 'B');
    eq(vga.getLine(1), 'C');
    eq(vga.getLine(2), '');
    eq(vga.getLine(24), '', 'bottom line blanked');
    vga.scrollDown(1, 0x07);
    eq(vga.getLine(0), '');
    eq(vga.getLine(1), 'B');
    vga.clear(0x1F);
    eq(vga.text[0], (0x1F << 8) | 0x20, 'clear fills with blanks');
    eq(vga.getLine(0), '');
  });

  harness.test('mode 13h pixels and palette', function () {
    var r = rig();
    var bus = r.bus;
    var vga = r.dev.vga;
    eq(vga.pixels.length, 64000);
    vga.setMode(0x13);
    eq(vga.mode, 0x13);
    bus.write8(0xA0000 + 100 * 320 + 50, 7);
    eq(vga.readPixel(50, 100), 7, 'framebuffer write');
    eq(bus.read8(0xA0000 + 100 * 320 + 50), 7, 'read back through the bus');
    vga.writePixel(0, 0, 0xAB);
    eq(bus.read8(0xA0000), 0xAB, 'pixel helper');
    eq(vga.text[0] & 0xFF, 0x20, 'text buffer untouched in graphics mode');
    vga.writePixel(320, 0, 1);
    eq(vga.readPixel(320, 0), 0, 'out of range pixel');
    eq(vga.getPalette(1).r, 0, 'default cga blue r');
    eq(vga.getPalette(1).g, 0, 'default cga blue g');
    eq(vga.getPalette(1).b, 170, 'default cga blue b');
    eq(vga.getPalette(15).r, 255, 'default cga white');
    vga.setPalette(1, 255, 0, 0);
    eq(vga.getPalette(1).r, 255);
    eq(vga.getPalette(1).b, 0);
    r.io.out8(0x3C8, 16);
    r.io.out8(0x3C9, 63);
    r.io.out8(0x3C9, 0);
    r.io.out8(0x3C9, 0);
    eq(vga.getPalette(16).r, 255, 'dac write scales 6 bit to 8 bit');
    eq(vga.getPalette(17).g, 144, 'mode 13 default table entry 17');
    eq(vga.getPalette(17).b, 85, 'mode 13 default table entry 17 blue');
  });

  harness.test('mode switching through the sequencer', function () {
    var r = rig();
    var io = r.io;
    var vga = r.dev.vga;
    vga.setMode(3);
    io.out8(0x3C4, 0x04);
    io.out8(0x3C5, 0x0E);
    eq(vga.mode, 0x13, 'chain-4 selects mode 13h');
    io.out8(0x3C5, 0x02);
    eq(vga.mode, 3, 'odd/even selects text mode');
    eq(io.in8(0x3C6), 0xFF, 'dac mask');
    io.out8(0x3C6, 0x0F);
    eq(io.in8(0x3C6), 0x0F);
    eq(io.in8(0x3CC) & 0x63, 0x63, 'misc output read');
    var s1 = io.in8(0x3DA);
    var s2 = io.in8(0x3DA);
    assert(s1 !== s2, 'status register toggles for polling loops');
  });

  harness.test('render text mode into a canvas', function () {
    var r = rig();
    var vga = r.dev.vga;
    vga.setMode(3);
    vga.writeChar(0x41, 0x1F, 0, 0);
    vga.writeChar(0x42, 0x0E, 1, 0);
    vga.dirty = true;
    var canvas = fakeCanvas(640, 400);
    eq(vga.render(canvas), true, 'render ok');
    eq(vga.dirty, false, 'dirty cleared');
    var texts = canvas.ops.filter(function (o) { return o[0] === 'fillText'; });
    eq(texts.length, 2, 'two glyphs drawn');
    eq(texts[0][1], 'A');
    eq(texts[1][1], 'B');
    eq(typeof vga.render(null), 'boolean');
    eq(vga.render(null), false, 'null canvas');
    eq(vga.render({}), false, 'object without getContext');
    var noCtx = { width: 10, height: 10, getContext: function () { return null; } };
    eq(vga.render(noCtx), false, 'null 2d context');
  });

  harness.test('render tolerates a minimal 2d context', function () {
    var r = rig();
    var vga = r.dev.vga;
    var ops = 0;
    var bare = {
      width: 64,
      height: 32,
      getContext: function () { return { fillRect: function () { ops++; } }; }
    };
    vga.setMode(3);
    vga.writeChar(0x21, 0x1F, 0, 0);
    eq(vga.render(bare), true, 'renders with fillRect only');
    assert(ops > 0, 'drew something');
    vga.setMode(0x13);
    ops = 0;
    eq(vga.render(bare), true, 'graphics without createImageData');
    eq(ops >= 64 * 32, true, 'per pixel rect fallback covers the canvas');
  });

  harness.test('render mode 13h scales to the canvas', function () {
    var r = rig();
    var vga = r.dev.vga;
    vga.setMode(0x13);
    vga.writePixel(0, 0, 15);
    vga.writePixel(319, 199, 4);
    var small = fakeCanvas(320, 200);
    eq(vga.render(small), true);
    var puts = small.ops.filter(function (o) { return o[0] === 'putImageData'; });
    eq(puts.length, 1, 'one blit');
    eq(puts[0][1], 320);
    eq(puts[0][2], 200);
    eq(small.ctx.imageSmoothingEnabled, false, 'smoothing disabled');
    var big = fakeCanvas(640, 400);
    eq(vga.render(big), true);
    var puts2 = big.ops.filter(function (o) { return o[0] === 'putImageData'; });
    eq(puts2[0][1], 640, 'scaled width');
    eq(puts2[0][2], 400, 'scaled height');
    var frame = vga.buildFrame(4, 4);
    eq(frame.length, 64, 'rgba frame buffer');
    eq(frame[3], 255, 'opaque');
    eq(frame[0], vga.palette[15 * 3], 'top left pixel colour');
  });
});

/* --------------------------------- ata --------------------------------- */

harness.suite('ata pio disk', function () {
  function setup(sectors) {
    var r = rig();
    var img = new Uint8Array(512 * (sectors || 300));
    img.fill(0xAA);
    img[0] = 0x11;
    img[1] = 0x22;
    r.dev.ata.setImage(img);
    return r;
  }

  harness.test('identify device word table', function () {
    var r = setup(65536);
    var io = r.io;
    var ata = r.dev.ata;
    eq(ata.sectors, 65536, 'sector count from the image');
    eq(ata.geometry.heads, 16);
    eq(ata.geometry.spt, 255);
    eq(ata.geometry.cyl, 16, '65536 sectors is 16 cylinders');
    var result = ataIdentify(io, ata);
    var w = result.words;
    eq(result.busy & 0x80, 0x80, 'BSY right after the command');
    eq(result.ready & 0x80, 0x00, 'BSY cleared once the data is ready');
    eq(result.ready & 0x08, 0x08, 'DRQ set');
    eq(result.ready & 0x40, 0x40, 'DRDY set');
    eq(w[0], 0x0040, 'word 0 fixed device');
    eq(w[1], 16, 'word 1 cylinders');
    eq(w[3], 16, 'word 3 heads');
    eq(w[6], 255, 'word 6 sectors per track');
    eq(ataWordsToString(w, 27, 20).replace(/ +$/, ''), 'HYN486 HDD', 'model string');
    assert(ataWordsToString(w, 10, 20).length === 20, 'serial is 20 chars');
    eq(w[49] & 0x0200, 0x0200, 'LBA supported');
    eq(w[60], 65536 & 0xFFFF, 'word 60 LBA count low');
    eq(w[61], (65536 >>> 16) & 0xFFFF, 'word 61 LBA count high');
    eq(w[57], 65536 & 0xFFFF, 'word 57 capacity low');
    eq(w[80] & 0x0003, 0x0003, 'ATA-1 and ATA-2 major version');
    eq(w[82] & 0x4000, 0x4000, 'command set word present');
    eq(w[47], 0x0000, 'no read/write multiple');
    eq(ata.irqCount, 1, 'irq14 after the transfer');
    eq(ata.readStatus() & 0x08, 0x00, 'DRQ cleared after 256 words');
  });

  harness.test('read sector through the data port', function () {
    var r = setup(300);
    var io = r.io;
    programPic(io, 0xE8);
    io.out8(0x1F6, 0xE0);
    io.out8(0x1F2, 1);
    io.out8(0x1F3, 0);
    io.out8(0x1F4, 0);
    io.out8(0x1F5, 0);
    io.out8(0x1F7, 0x20);
    eq(io.in8(0x1F7) & 0x80, 0x80, 'busy');
    eq(io.in8(0x1F7) & 0x48, 0x48, 'drdy+drq');
    eq(io.in16(0x1F0), 0x2211, 'first word');
    var sum = 0;
    for (var i = 1; i < 256; i++) sum += io.in16(0x1F0);
    eq(sum, 0xAAAA * 255, 'remaining words');
    eq(r.dev.ata.irqCount, 1, 'irq14 at the end of the transfer');
    eq(r.dev.pic.master.irr & 0x04, 0x04, 'cascade line asserted');
    eq(r.dev.pic.slave.irr & 0x40, 0x40, 'slave irr bit 6');
    eq(r.dev.pic.ack(), 0x76, 'IRQ14 vector');
    io.out8(0xA0, 0x20);
    io.out8(0x20, 0x20);
    eq(io.in8(0x1F7) & 0x08, 0x00, 'DRQ cleared');
    eq(r.dev.pic.master.irr & 0x04, 0x00, 'status read lowers IRQ14');
  });

  harness.test('write sector then read it back', function () {
    var r = setup(300);
    var io = r.io;
    var ata = r.dev.ata;
    io.out8(0x1F6, 0xE0);
    io.out8(0x1F2, 1);
    io.out8(0x1F3, 1);
    io.out8(0x1F4, 0);
    io.out8(0x1F5, 0);
    io.out8(0x1F7, 0x30);
    eq(io.in8(0x1F7) & 0x80, 0x80, 'busy after WRITE SECTORS');
    eq(io.in8(0x1F7) & 0x08, 0x08, 'DRQ for the host to send data');
    for (var i = 0; i < 256; i++) io.out16(0x1F0, 0x1000 + i);
    eq(ata.dirty, true, 'dirty flag set');
    eq(ata.image[512], 0x00, 'low byte written');
    eq(ata.image[513], 0x10, 'high byte written');
    eq(ata.image[1022], 0xFF, 'last byte of the sector');
    eq(ata.image[1023], 0x10);
    eq(io.in8(0x1F7) & 0x08, 0x00, 'DRQ cleared after the transfer');
    io.out8(0x1F2, 1);
    io.out8(0x1F3, 1);
    io.out8(0x1F7, 0x20);
    io.in8(0x1F7);
    var first = io.in16(0x1F0);
    var count = 1;
    for (var j = 1; j < 256; j++) { io.in16(0x1F0); count++; }
    eq(first, 0x1000, 'read after write');
    eq(count, 256);
    eq(ata.readSector(1)[0], 0x00, 'host helper sees the image');
    eq(ata.readSector(1)[1], 0x10);
    eq(ata.readSector(9999), null, 'out of range helper');
  });

  harness.test('error handling for bad commands and ranges', function () {
    var r = setup(300);
    var io = r.io;
    var ata = r.dev.ata;
    io.out8(0x1F6, 0xE0);
    io.out8(0x1F7, 0xC8);
    eq(io.in8(0x1F7) & 0x80, 0x80, 'busy');
    var st = io.in8(0x1F7);
    eq(st & 0x01, 0x01, 'ERR set on an unsupported opcode');
    eq(io.in8(0x1F1), 0x04, 'ABRT error code');
    eq(ata.dirty, false);
    io.out8(0x1F6, 0xE0);
    io.out8(0x1F2, 1);
    io.out8(0x1F3, 0xF0);
    io.out8(0x1F4, 0xFF);
    io.out8(0x1F5, 0x0F);
    io.out8(0x1F7, 0x20);
    io.in8(0x1F7);
    eq(io.in8(0x1F7) & 0x01, 0x01, 'out of range read fails');
    eq(io.in8(0x1F1), 0x10, 'IDNF error code');
    io.out8(0x1F6, 0xB0);
    io.out8(0x1F7, 0xEC);
    io.in8(0x1F7);
    eq(io.in8(0x1F7) & 0x01, 0x01, 'device 1 is absent');
    eq(io.in8(0x1F1), 0x04, 'ABRT for the missing slave');
  });

  harness.test('sector count 0 means 256 sectors', function () {
    var r = setup(300);
    var io = r.io;
    var ata = r.dev.ata;
    io.out8(0x1F6, 0xE0);
    io.out8(0x1F2, 0);
    io.out8(0x1F3, 0);
    io.out8(0x1F4, 0);
    io.out8(0x1F5, 0);
    io.out8(0x1F7, 0x20);
    io.in8(0x1F7);
    eq(ata.pendingSectors, 255, '256 sectors queued');
    for (var s = 0; s < 2; s++) {
      for (var i = 0; i < 256; i++) io.in16(0x1F0);
    }
    eq(ata.pendingSectors, 253, 'two sectors consumed');
    eq(ata.lba, 3, 'LBA advanced');
  });

  harness.test('chs addressing and other commands', function () {
    var r = setup(300);
    var io = r.io;
    var ata = r.dev.ata;
    io.out8(0x1F6, 0x00);
    io.out8(0x1F2, 1);
    io.out8(0x1F3, 1);
    io.out8(0x1F4, 0);
    io.out8(0x1F5, 0);
    io.out8(0x1F7, 0x20);
    io.in8(0x1F7);
    eq(io.in16(0x1F0), 0x2211, 'CHS sector 1 maps to LBA 0');
    io.out8(0x1F6, 0xA0);
    io.out8(0x1F7, 0xEF);
    io.in8(0x1F7);
    eq(io.in8(0x1F7) & 0x01, 0x00, 'SET FEATURES accepted');
    eq(io.in8(0x1F1), 0x00);
    io.out8(0x1F2, 0x01);
    io.out8(0x1F6, 0xA0);
    io.out8(0x1F7, 0x91);
    io.in8(0x1F7);
    eq(ata.geometry.heads, 1, 'INITIALIZE DEVICE PARAMETERS heads');
    eq(ata.geometry.spt, 1, 'and sectors per track');
    var irqBefore = ata.irqCount;
    io.out8(0x1F7, 0x08);
    io.in8(0x1F7);
    eq(io.in8(0x1F7) & 0x40, 0x40, 'DEVICE RESET leaves DRDY');
    eq(ata.irqCount, irqBefore, 'DEVICE RESET does not interrupt');
    eq(io.in8(0x3F6), ata.status & 0xFF, 'alternate status mirrors status');
    ata.setImage(new Uint8Array(1024));
    eq(ata.sectors, 2, 'setImage recomputes the geometry');
    eq(ata.geometry.cyl, 1, 'tiny images get one cylinder');
  });
});

/* -------------------------------- serial ------------------------------- */

harness.suite('serial 16550a', function () {
  harness.test('transmit and register semantics', function () {
    var r = rig();
    var io = r.io;
    var serial = r.dev.serial;
    serial.writeText('HY486');
    eq(serial.output, 'HY486', 'output buffer');
    eq(io.in8(0x3FD) & 0x60, 0x60, 'THRE and TEMT set');
    eq(io.in8(0x3FA), 0x01, 'no interrupt pending');
    io.out8(0x3F9, 0x02);
    eq(io.in8(0x3FA) & 0x0E, 0x02, 'THR empty interrupt');
    eq(io.in8(0x3FA), 0x01, 'IIR read clears the THRE condition');
    io.out8(0x3F9, 0x00);
    io.out8(0x3FB, 0x03);
    eq(io.in8(0x3FB), 0x03, 'LCR');
    io.out8(0x3FC, 0x0B);
    eq(io.in8(0x3FC), 0x0B, 'MCR');
    io.out8(0x3FF, 0x5A);
    eq(io.in8(0x3FF), 0x5A, 'SCR');
    eq(io.in8(0x3FE) & 0x30, 0x30, 'MSR cts/dsr');
    io.out8(0x3FA, 0xC7);
    eq(io.in8(0x3FA) & 0xC0, 0x00, 'no interrupt pending means FIFO bits read as 0');
    io.out8(0x3F9, 0x02);
    eq(io.in8(0x3FA) & 0xC0, 0xC0, 'FIFO enabled bits in IIR with an interrupt');
    io.out8(0x3F9, 0x00);
  });

  harness.test('receive path and data ready irq', function () {
    var r = rig();
    var io = r.io;
    var serial = r.dev.serial;
    programPic(io, 0xE8);
    serial.feed('Z');
    eq(io.in8(0x3FD) & 0x01, 0x01, 'data ready');
    eq(r.dev.pic.master.pendingMask() & 0x10, 0x00, 'IER is clear, no irq');
    io.out8(0x3F9, 0x01);
    eq(r.dev.pic.master.pendingMask() & 0x10, 0x10, 'irq4 with IER bit 0');
    eq(io.in8(0x3FA) & 0x0E, 0x04, 'received data available');
    eq(r.dev.pic.ack(), 0x24, 'com vector');
    io.out8(0x20, 0x20);
    eq(io.in8(0x3F8), 90, 'RBR');
    eq(io.in8(0x3FD) & 0x01, 0x00, 'queue drained');
    eq(r.dev.pic.master.irr & 0x10, 0x00, 'irq lowered');
  });

  harness.test('baud divisor latch and loopback', function () {
    var r = rig();
    var io = r.io;
    var serial = r.dev.serial;
    io.out8(0x3FB, 0x83);
    io.out8(0x3F8, 0x0C);
    io.out8(0x3F9, 0x00);
    eq(serial.dll, 0x0C, 'divisor low');
    eq(io.in8(0x3F8), 0x0C, 'DLL read back');
    eq(io.in8(0x3F9), 0x00, 'DLM read back');
    io.out8(0x3FB, 0x03);
    serial.clear();
    io.out8(0x3FC, 0x10);
    io.out8(0x3F8, 0x41);
    eq(serial.output, 'A', 'loopback still emits');
    eq(io.in8(0x3FD) & 0x01, 0x01, 'loopback feeds the receiver');
    eq(io.in8(0x3F8), 0x41);
    io.out8(0x3FC, 0x00);
  });

  harness.test('output ring buffer and callbacks', function () {
    var r = rig();
    var serial = r.dev.serial;
    var seen = [];
    serial.onByte = function (b) { seen.push(b); };
    serial.clear();
    var chunk = '';
    for (var i = 0; i < 2500; i++) chunk += String.fromCharCode(65 + (i % 26));
    serial.writeText(chunk);
    eq(serial.output.length, 2000, 'ring keeps the last 2000 chars');
    eq(serial.output.charAt(1999), chunk.charAt(2499), 'newest char kept');
    eq(serial.output.charAt(0), chunk.charAt(500), 'oldest dropped');
    eq(seen.length, 2500, 'onByte called for every byte');
    eq(seen[0], 65);
    eq(serial.byteCount, 2500);
    serial.clear();
    eq(serial.output, '');
    eq(serial.byteCount, 0);
  });
});

/* ------------------------ dma, floppy, port 0x92 ------------------------ */

harness.suite('dma floppy and chipset', function () {
  harness.test('8237 channel registers and page registers', function () {
    var r = rig();
    var io = r.io;
    var dma = r.dev.dma;
    io.out8(0x0C, 0x00);
    io.out8(0x04, 0x34);
    io.out8(0x04, 0x12);
    io.out8(0x0C, 0x00);
    eq(io.in8(0x04), 0x34, 'address low');
    eq(io.in8(0x04), 0x12, 'address high');
    eq(dma.getChannel(2).address, 0x1234);
    io.out8(0x0C, 0x00);
    io.out8(0x05, 0xFF);
    io.out8(0x05, 0x01);
    eq(dma.getChannel(2).count, 0x01FF, 'count register');
    io.out8(0x81, 0x05);
    eq(dma.getChannel(2).page, 0x05, 'page register');
    eq(io.in8(0x81), 0x05);
    io.out8(0x0A, 0x06);
    eq(dma.getChannel(2).mask, true, 'single channel mask set');
    io.out8(0x0A, 0x02);
    eq(dma.getChannel(2).mask, false, 'single channel mask cleared');
    io.out8(0x0B, 0x46);
    eq(dma.getChannel(2).mode, 0x46, 'mode register');
    io.out8(0x0F, 0x0F);
    eq(dma.getChannel(0).mask, true);
    io.out8(0x0E, 0x00);
    eq(dma.getChannel(0).mask, false, 'clear mask register');
    io.out8(0x08, 0x04);
    eq(dma.command, 0x04, 'command register');
    io.out8(0x0D, 0x00);
    eq(dma.getChannel(2).address, 0x1234, 'master clear keeps addresses');
    eq(dma.getChannel(3).mask, true);
  });

  harness.test('8272a floppy stub never hangs', function () {
    var r = rig();
    var io = r.io;
    var fdc = r.dev.floppy;
    eq(fdc.supported, false, 'documented as unsupported');
    eq(io.in8(0x3F4) & 0x80, 0x80, 'RQM set so probes exit');
    eq(io.in8(0x3F0), 0x00);
    io.out8(0x3F2, 0x0C);
    eq(io.in8(0x3F2), 0x0C, 'DOR readback');
    io.out8(0x3F5, 0x08);
    eq(io.in8(0x3F5), 0x80, 'sense interrupt status st0');
    eq(io.in8(0x3F5), 0x00);
    io.out8(0x3F7, 0x00);
    eq(io.in8(0x3F7), 0x00, 'CCR');
    io.out8(0x3F5, 0x06);
    eq(io.in8(0x3F5), 0x40, 'read data fails with abnormal termination');
    eq(io.in8(0x3F5), 0x04);
    eq(fdc.commands, 2);
  });

  harness.test('port 0x92 a20 and fast reset', function () {
    var calls = [];
    var bus = new Bus({ ramMB: 4 });
    var dev = Devices.install(bus, { onReset: function () { calls.push('reset'); } });
    var io = bus.io;
    eq(io.in8(0x92) & 0x02, 0x02, 'a20 enabled at power on');
    io.out8(0x92, 0x00);
    eq(bus.a20, false, 'a20 off');
    eq(io.in8(0x92), 0x00);
    io.out8(0x92, 0x02);
    eq(bus.a20, true, 'a20 on');
    dev.vga.setMode(0x13);
    dev.keyboard.press(0x1E);
    io.out8(0x92, 0x03);
    eq(calls.length, 1, 'fast reset hook');
    eq(dev.vga.mode, 3, 'devices reset');
    eq(dev.keyboard.pending(), 0);
    eq(bus.a20, true);
    eq(io.in8(0x92), 0x02, 'system control register restored');
  });

  harness.test('pci config space reads 0xff', function () {
    var r = rig();
    var io = r.io;
    io.out32(0xCF8, 0x80000000);
    eq(io.in32(0xCFC) >>> 0, 4294967295, 'no PCI on a 486');
    eq(io.in8(0xCF8), 0xFF);
    eq(io.in8(0xCFE), 0xFF);
    eq(r.dev.pci.writes, 1, 'configuration writes counted');
  });

  harness.test('device install shape and full reset', function () {
    var r = rig({ ramMB: 8 });
    var dev = r.dev;
    eq(typeof dev.reset, 'function');
    eq(typeof dev.pic.ack, 'function');
    eq(typeof dev.pit.advance, 'function');
    eq(typeof dev.keyboard.press, 'function');
    eq(typeof dev.cmos.readData, 'function');
    eq(typeof dev.vga.render, 'function');
    eq(typeof dev.ata.setImage, 'function');
    eq(typeof dev.serial.feed, 'function');
    eq(typeof dev.dma.getChannel, 'function');
    eq(typeof dev.floppy.readReg, 'function');
    eq(dev.cmos.getRegister(0x17), (7 * 1024) & 0xFF, 'cmos follows ramGB');
    r.io.out8(0x20, 0x11);
    r.io.out8(0x43, 0x36);
    dev.vga.setMode(0x13);
    dev.serial.writeText('abc');
    dev.keyboard.press(0x01);
    dev.ata.setImage(new Uint8Array(512 * 4));
    r.bus.setA20(false);
    dev.reset();
    eq(dev.pic.master.imr, 0xFF, 'pic mask reset');
    eq(dev.pic.master.irr, 0x00);
    eq(dev.vga.mode, 3, 'vga back to text mode');
    eq(dev.vga.getLine(0), '', 'screen cleared');
    eq(dev.serial.output, '', 'serial buffer cleared');
    eq(dev.keyboard.pending(), 0, 'keyboard queue cleared');
    eq(dev.ata.status, 0x40, 'ata idle ready');
    eq(dev.pit.irq0Count, 0, 'pit counters restarted');
    eq(r.bus.a20, true, 'a20 restored');
    eq(r.bus.read8(0x100010), 0x00);
  });
});

/* ----------------------------- integration ----------------------------- */

harness.suite('installation and host hooks', function () {
  harness.test('host callbacks are optional and fire', function () {
    var seen = { irq: [], serial: '', modes: [] };
    var bus = new Bus({ ramMB: 2 });
    var dev = Devices.install(bus, {
      onIrq: function (line) { seen.irq.push(line); },
      onSerial: function (text) { seen.serial += text; },
      onVideoMode: function (mode) { seen.modes.push(mode); }
    });
    dev.serial.writeText('ok');
    eq(seen.serial, 'ok', 'serial hook');
    dev.pit.onIrq0();
    assert(seen.irq.indexOf(0) >= 0, 'irq hook saw line 0');
    eq(dev.pic.master.irr & 0x01, 0x01, 'timer request reached the pic');
    dev.vga.setMode(0x13);
    eq(seen.modes[0], 0x13, 'video mode hook');
    var plain = Devices.install(new Bus({ ramMB: 2 }));
    eq(typeof plain.reset, 'function', 'install works without a host');
  });

  harness.test('a second install rebinds every port and memory map', function () {
    var bus = new Bus({ ramMB: 2 });
    var first = Devices.install(bus, {});
    var second = Devices.install(bus, {});
    second.keyboard.press(0x1E);
    eq(bus.io.in8(0x60), 0x1E, 'second install owns port 0x60');
    eq(first.keyboard.pending(), 0, 'the discarded keyboard stayed empty');
    second.vga.setMode(0x13);
    bus.write8(0xA0000, 9);
    eq(second.vga.readPixel(0, 0), 9, 'second install owns the framebuffer');
    eq(first.vga.pixels[0], 0, 'old adapter untouched');
    second.pit.onIrq0();
    eq(first.pic.master.irr, 0, 'old pic untouched');
    eq(second.pic.master.irr & 0x01, 0x01, 'new pic got the irq');
    eq(bus.readMaps.length, 1, 'framebuffer map replaced, not duplicated');
    eq(bus.writeMaps.length, 1);
  });
});

if (require.main === module) { process.exit(harness.run() ? 1 : 0); }
