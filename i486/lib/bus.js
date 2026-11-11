(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * Bus / memory / port-I/O model for the i486DX PC.
   *
   * Memory map (physical):
   *   0x00000000-0x0009FFFF  base RAM (640 KB, always present)
   *   0x000A0000-0x000FFFFF  device hole: VGA 0xA0000-0xBFFFF, ROM 0xF0000-0xFFFFF
   *   0x00100000-...         extended RAM up to ramMB
   *   0xFFFFFFF0-0xFFFFFFFF  reset-vector alias of the top 16 ROM bytes
   *   anything else          open bus: reads 0xFF, writes ignored and logged
   *
   * RAM is one flat Uint8Array; only the device hole is range checked.
   * MMIO maps win over RAM. ROM is write protected.
   */

  var HOLE_LO = 0x0A0000;
  var HOLE_HI = 0x100000;
  var A20_OFF_MASK = 0xFFEFFFFF;
  var LOG_CAP = 200;
  var PORT_LOG_CAP = 200;

  function hex(v, width) {
    var s = (v >>> 0).toString(16).toUpperCase();
    while (width && s.length < width) s = '0' + s;
    return s;
  }

  /* ------------------------------ port space ------------------------------ */

  function PortSpace(bus) {
    this.bus = bus;
    this.ports = new Map();
    this.portLog = Object.create(null);
  }

  PortSpace.prototype.addPort = function (port, handler, force) {
    port = port & 0xFFFF;
    var existing = this.ports.get(port);
    if (existing !== undefined && force !== true && handler.replace !== true) return existing;
    this.ports.set(port, handler);
    return handler;
  };

  PortSpace.prototype.removePort = function (port) {
    return this.ports.delete(port & 0xFFFF);
  };

  PortSpace.prototype.hasPort = function (port) {
    return this.ports.has(port & 0xFFFF);
  };

  PortSpace.prototype.getPort = function (port) {
    var h = this.ports.get(port & 0xFFFF);
    return h === undefined ? null : h;
  };

  PortSpace.prototype._missing = function (port, width) {
    var count = this.bus.unhandledPorts;
    count.set(port, (count.get(port) || 0) + 1);
    if (this.portLog[port] === undefined) {
      this.portLog[port] = true;
      if (Object.keys(this.portLog).length > PORT_LOG_CAP) this.portLog = Object.create(null);
      this.bus.log('unmapped port 0x' + hex(port, 4));
    }
    return width === 1 ? 0xFF : width === 2 ? 0xFFFF : 4294967295;
  };

  PortSpace.prototype.in8 = function (port) {
    port = port & 0xFFFF;
    var h = this.ports.get(port);
    if (h !== undefined && h.read !== undefined) return h.read(port, 1) & 0xFF;
    return this._missing(port, 1) & 0xFF;
  };

  PortSpace.prototype.in16 = function (port) {
    port = port & 0xFFFF;
    var h = this.ports.get(port);
    if (h !== undefined && h.read !== undefined) return h.read(port, 2) & 0xFFFF;
    var lo = this.in8(port);
    var hi = this.in8((port + 1) & 0xFFFF);
    return ((hi << 8) | lo) & 0xFFFF;
  };

  PortSpace.prototype.in32 = function (port) {
    port = port & 0xFFFF;
    var h = this.ports.get(port);
    if (h !== undefined && h.read !== undefined) return h.read(port, 4) >>> 0;
    var b0 = this.in8(port);
    var b1 = this.in8((port + 1) & 0xFFFF);
    var b2 = this.in8((port + 2) & 0xFFFF);
    var b3 = this.in8((port + 3) & 0xFFFF);
    return ((b3 << 24) | (b2 << 16) | (b1 << 8) | b0) >>> 0;
  };

  PortSpace.prototype.out8 = function (port, value) {
    port = port & 0xFFFF;
    var h = this.ports.get(port);
    if (h !== undefined && h.write !== undefined) { h.write(port, 1, value & 0xFF); return; }
    this._missing(port, 1);
  };

  PortSpace.prototype.out16 = function (port, value) {
    port = port & 0xFFFF;
    value = value & 0xFFFF;
    var h = this.ports.get(port);
    if (h !== undefined && h.write !== undefined) { h.write(port, 2, value); return; }
    this.out8(port, value & 0xFF);
    this.out8((port + 1) & 0xFFFF, (value >>> 8) & 0xFF);
  };

  PortSpace.prototype.out32 = function (port, value) {
    port = port & 0xFFFF;
    value = value >>> 0;
    var h = this.ports.get(port);
    if (h !== undefined && h.write !== undefined) { h.write(port, 4, value); return; }
    this.out8(port, value & 0xFF);
    this.out8((port + 1) & 0xFFFF, (value >>> 8) & 0xFF);
    this.out8((port + 2) & 0xFFFF, (value >>> 16) & 0xFF);
    this.out8((port + 3) & 0xFFFF, (value >>> 24) & 0xFF);
  };

  PortSpace.prototype.resetDiagnostics = function () {
    this.bus.unhandledPorts.clear();
    this.portLog = Object.create(null);
  };

  /* --------------------------------- bus --------------------------------- */

  function Bus(opts) {
    opts = opts || {};
    var ramMB = opts.ramMB === undefined ? 32 : opts.ramMB;
    if (!(ramMB > 0)) ramMB = 1;
    this.ramMB = ramMB;
    this.ramSize = ramMB * 0x100000;
    this.ram = new Uint8Array(this.ramSize);
    this.a20 = true;
    this.roms = [];
    this.readMaps = [];
    this.writeMaps = [];
    this.hasLowRead = false;
    this.hasHighRead = false;
    this.hasLowWrite = false;
    this.hasHighWrite = false;
    this.errorLog = [];
    this.unhandledPorts = new Map();
    this._writeLog = Object.create(null);
    this._logCount = 0;
    this.io = new PortSpace(this);
    this.readCount = 0;
    this.writeCount = 0;
  }

  Bus.prototype.log = function (message) {
    this.errorLog.push(message);
    if (this.errorLog.length > LOG_CAP) this.errorLog.shift();
  };

  Bus.prototype.reset = function () {
    this.a20 = true;
    this.errorLog.length = 0;
    this.unhandledPorts.clear();
    this._writeLog = Object.create(null);
  };

  Bus.prototype.setA20 = function (on) {
    this.a20 = on === true || (on !== false && on !== 0 && on !== undefined);
    return this.a20;
  };

  Bus.prototype._findRead = function (pa) {
    var maps = this.readMaps;
    for (var i = 0; i < maps.length; i++) {
      var m = maps[i];
      if (pa >= m.start && pa < m.end) return m;
    }
    return null;
  };

  Bus.prototype._findWrite = function (pa) {
    var maps = this.writeMaps;
    for (var i = 0; i < maps.length; i++) {
      var m = maps[i];
      if (pa >= m.start && pa < m.end) return m;
    }
    return null;
  };

  /* Mapping a base address that is already mapped replaces that handler, so a
     second device install rebinds instead of shadowing. */
  Bus.prototype.mapRead = function (pa, len, fn) {
    if (typeof fn !== 'function') throw new Error('mapRead needs a function');
    pa = pa >>> 0;
    var end = Math.min(pa + (len >>> 0), 0x100000000);
    var maps = this.readMaps;
    for (var i = 0; i < maps.length; i++) {
      if (maps[i].start === pa) {
        maps[i].end = end;
        maps[i].fn = fn;
        return maps[i];
      }
    }
    var map = { start: pa, end: end, fn: fn };
    this.readMaps.push(map);
    if (pa < HOLE_LO) this.hasLowRead = true;
    if (pa >= HOLE_HI) this.hasHighRead = true;
    return map;
  };

  Bus.prototype.mapWrite = function (pa, len, fn) {
    if (typeof fn !== 'function') throw new Error('mapWrite needs a function');
    pa = pa >>> 0;
    var end = Math.min(pa + (len >>> 0), 0x100000000);
    var maps = this.writeMaps;
    for (var i = 0; i < maps.length; i++) {
      if (maps[i].start === pa) {
        maps[i].end = end;
        maps[i].fn = fn;
        return maps[i];
      }
    }
    var map = { start: pa, end: end, fn: fn };
    this.writeMaps.push(map);
    if (pa < HOLE_LO) this.hasLowWrite = true;
    if (pa >= HOLE_HI) this.hasHighWrite = true;
    return map;
  };

  Bus.prototype.unmapRead = function (map) {
    var i = this.readMaps.indexOf(map);
    if (i >= 0) this.readMaps.splice(i, 1);
  };

  Bus.prototype.unmapWrite = function (map) {
    var i = this.writeMaps.indexOf(map);
    if (i >= 0) this.writeMaps.splice(i, 1);
  };

  Bus.prototype.setROM = function (pa, data) {
    pa = pa >>> 0;
    var bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
    for (var i = 0; i < this.roms.length; i++) {
      if (this.roms[i].start === pa) {
        this.roms[i].bytes = bytes;
        this.roms[i].end = pa + bytes.length;
        return;
      }
    }
    this.roms.push({ start: pa, end: pa + bytes.length, bytes: bytes });
  };

  Bus.prototype._romRead = function (pa) {
    var roms = this.roms;
    for (var i = 0; i < roms.length; i++) {
      var r = roms[i];
      if (pa >= r.start && pa < r.end) return r.bytes[pa - r.start];
    }
    return -1;
  };

  Bus.prototype._logWrite = function (pa, v) {
    var page = (pa >>> 12);
    if (this._writeLog[page] === true) return;
    this._writeLog[page] = true;
    this.log('write to unmapped 0x' + hex(pa, 8) + ' = 0x' + hex(v, 2));
  };

  Bus.prototype._readDevice = function (pa) {
    var map = this._findRead(pa);
    if (map !== null) return map.fn(pa, 1) & 0xFF;
    var rom = this._romRead(pa);
    if (rom >= 0) return rom;
    if (pa >= 0xFFFFFFF0) {
      rom = this._romRead(0xF0000 + 0xFFF0 + (pa - 0xFFFFFFF0));
      if (rom >= 0) return rom;
    }
    return 0xFF;
  };

  Bus.prototype._writeDevice = function (pa, v) {
    var map = this._findWrite(pa);
    if (map !== null) { map.fn(pa, 1, v); return; }
    this._logWrite(pa, v);
  };

  Bus.prototype.read8 = function (pa) {
    pa = pa >>> 0;
    var ram = this.ram;
    if (pa < HOLE_LO) {
      if (this.hasLowRead) {
        var m = this._findRead(pa);
        if (m !== null) return m.fn(pa, 1) & 0xFF;
      }
      this.readCount++;
      return ram[pa];
    }
    if (pa < HOLE_HI) { this.readCount++; return this._readDevice(pa); }
    if (!this.a20) {
      pa = (pa & A20_OFF_MASK) >>> 0;
      if (pa < HOLE_LO) return ram[pa];
      if (pa < HOLE_HI) return this._readDevice(pa);
    }
    if (pa < this.ramSize) {
      if (this.hasHighRead) {
        var m2 = this._findRead(pa);
        if (m2 !== null) return m2.fn(pa, 1) & 0xFF;
      }
      this.readCount++;
      return ram[pa];
    }
    this.readCount++;
    return this._readDevice(pa);
  };

  Bus.prototype.write8 = function (pa, value) {
    pa = pa >>> 0;
    value = value & 0xFF;
    var ram = this.ram;
    if (pa < HOLE_LO) {
      if (this.hasLowWrite) {
        var m = this._findWrite(pa);
        if (m !== null) { m.fn(pa, 1, value); return; }
      }
      this.writeCount++;
      ram[pa] = value;
      return;
    }
    if (pa < HOLE_HI) { this.writeCount++; this._writeDevice(pa, value); return; }
    if (!this.a20) {
      pa = (pa & A20_OFF_MASK) >>> 0;
      if (pa < HOLE_LO) { ram[pa] = value; return; }
      if (pa < HOLE_HI) { this._writeDevice(pa, value); return; }
    }
    if (pa < this.ramSize) {
      if (this.hasHighWrite) {
        var m2 = this._findWrite(pa);
        if (m2 !== null) { m2.fn(pa, 1, value); return; }
      }
      this.writeCount++;
      ram[pa] = value;
      return;
    }
    this.writeCount++;
    this._writeDevice(pa, value);
  };

  Bus.prototype.read16 = function (pa) {
    pa = pa >>> 0;
    var ram = this.ram;
    if ((pa & 1) === 0) {
      if (pa + 2 <= HOLE_LO && !this.hasLowRead) {
        this.readCount++;
        return (ram[pa] | (ram[pa + 1] << 8)) & 0xFFFF;
      }
      if (pa >= HOLE_HI && pa + 2 <= this.ramSize && !this.hasHighRead && this.a20) {
        this.readCount++;
        return (ram[pa] | (ram[pa + 1] << 8)) & 0xFFFF;
      }
    }
    return ((this.read8(pa) | (this.read8((pa + 1) >>> 0) << 8)) & 0xFFFF);
  };

  Bus.prototype.read32 = function (pa) {
    pa = pa >>> 0;
    var ram = this.ram;
    if ((pa & 3) === 0) {
      if (pa + 4 <= HOLE_LO && !this.hasLowRead) {
        this.readCount++;
        return ((ram[pa] | (ram[pa + 1] << 8) | (ram[pa + 2] << 16) | (ram[pa + 3] << 24)) >>> 0);
      }
      if (pa >= HOLE_HI && pa + 4 <= this.ramSize && !this.hasHighRead && this.a20) {
        this.readCount++;
        return ((ram[pa] | (ram[pa + 1] << 8) | (ram[pa + 2] << 16) | (ram[pa + 3] << 24)) >>> 0);
      }
    }
    var lo = this.read16(pa);
    var hi = this.read16((pa + 2) >>> 0);
    return ((hi << 16) | lo) >>> 0;
  };

  Bus.prototype.write16 = function (pa, value) {
    pa = pa >>> 0;
    value = value & 0xFFFF;
    var ram = this.ram;
    if ((pa & 1) === 0) {
      if (pa + 2 <= HOLE_LO && !this.hasLowWrite) {
        this.writeCount++;
        ram[pa] = value & 0xFF;
        ram[pa + 1] = (value >>> 8) & 0xFF;
        return;
      }
      if (pa >= HOLE_HI && pa + 2 <= this.ramSize && !this.hasHighWrite && this.a20) {
        this.writeCount++;
        ram[pa] = value & 0xFF;
        ram[pa + 1] = (value >>> 8) & 0xFF;
        return;
      }
    }
    this.write8(pa, value & 0xFF);
    this.write8((pa + 1) >>> 0, (value >>> 8) & 0xFF);
  };

  Bus.prototype.write32 = function (pa, value) {
    pa = pa >>> 0;
    value = value >>> 0;
    var ram = this.ram;
    if ((pa & 3) === 0) {
      if (pa + 4 <= HOLE_LO && !this.hasLowWrite) {
        this.writeCount++;
        ram[pa] = value & 0xFF;
        ram[pa + 1] = (value >>> 8) & 0xFF;
        ram[pa + 2] = (value >>> 16) & 0xFF;
        ram[pa + 3] = (value >>> 24) & 0xFF;
        return;
      }
      if (pa >= HOLE_HI && pa + 4 <= this.ramSize && !this.hasHighWrite && this.a20) {
        this.writeCount++;
        ram[pa] = value & 0xFF;
        ram[pa + 1] = (value >>> 8) & 0xFF;
        ram[pa + 2] = (value >>> 16) & 0xFF;
        ram[pa + 3] = (value >>> 24) & 0xFF;
        return;
      }
    }
    this.write16(pa, value & 0xFFFF);
    this.write16((pa + 2) >>> 0, (value >>> 16) & 0xFFFF);
  };

  Bus.prototype.getBytes = function (pa, len) {
    pa = pa >>> 0;
    len = len >>> 0;
    var out = new Uint8Array(len);
    for (var i = 0; i < len; i++) out[i] = this.read8((pa + i) >>> 0);
    return out;
  };

  Bus.prototype.setBytes = function (pa, bytes) {
    pa = pa >>> 0;
    for (var i = 0; i < bytes.length; i++) this.write8((pa + i) >>> 0, bytes[i] & 0xFF);
  };

  return { Bus: Bus };
});
