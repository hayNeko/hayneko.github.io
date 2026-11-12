/* i486/lib/ui.js — the page wiring: machine, VGA, IDE, panels, disk, shell.
   Everything that touches the DOM outside editor.js / highlight.js lives here.
   Loaded last (defer), so I486.{Assembler,Disassembler,Editor,Machine,Disk,Guest}
   are already registered when init() runs. The page must stay usable with the
   emulator core missing: assemble, disassemble and the project store work with
   no machine at all, and the console says so. */
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

  var ROOT = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
  var RAM_MB = 32;
  var SPEED_DEFAULT = 20000;
  var SPEED_MIN = 1;
  var SPEED_MAX = 2000000;
  var CONSOLE_MAX = 500;
  var TERM_MAX = 400;
  var PROJECT_KEY = 'i486.projects.v1';
  var TERM_PS1 = 'hy486@ide:~$';
  var SCREEN_W = 640;
  var SCREEN_H = 400;
  var GUEST_BUDGET = 3000000;
  var RUN_BURST = 60000;
  var POST_BUDGET = 3000000;
  var POST_CHUNK = 25000;
  var FRAME_BURST_CAP = 400000;  /* hard cap per frame so the page stays responsive */
  var WAKE_BURST = 512;          /* instructions retired when input wakes a halted CPU */
  var MEM_COLS = 16;
  var DIS_ROW_H = 19;       /* .ds > li line-height in i486.css */
  var MEM_ROW_H = 18;       /* .mem li line-height */
  var STACK_ROW_H = 18;     /* .stack li line-height */
  var STACK_DWORD = 4;      /* the stack window walks dword slots */
  var LIST_PREFETCH = 240;  /* rows kept above and below every window */
  var LIST_MAX = 20000;     /* a window rebases once it grows past this */
  var DIS_FORWARD = 96;     /* instructions decoded ahead of an anchor */
  var TAB_KEY = 'i486.tab';
  var MEM_FOLLOW_KEY = 'i486.mem.follow';
  var SLOT_BYTES = 512;
  var DISK_SECTORS = 0xFFFF;

  var NODE_NAMES = [
    'root', 'power', 'reset', 'boot', 'run', 'pause', 'step', 'over', 'out', 'speed',
    'clear-bp', 'status', 'eip', 'project', 'project-new', 'project-save', 'project-del',
    'download-asm', 'download-bin', 'import', 'import-file', 'sample', 'sample-load',
    'disk-download', 'disk-import', 'disk-file', 'disk-format',
    'source', 'editor-host', 'gutter', 'highlight', 'assemble', 'run-guest', 'run-com',
    'run-flat32', 'asm-status', 'disasm', 'console',
    'tab-editor', 'tab-disasm', 'pane-editor', 'pane-disasm',
    'dis-follow', 'dis-goto', 'dis-eip',
    'screen', 'screen-mode', 'screen-cursor', 'screen-clear', 'kb-capture', 'kb-hint',
    'regs', 'flags', 'state', 'stack', 'mem-base', 'mem-follow', 'mem',
    'files', 'file-add', 'file-del',
    'term', 'term-input', 'term-suggest'
  ];

  /* set-1 make codes. Codes above 0x7F carry the 0xE0 escape, which the 8042
     queues as its own byte before the make/break code. */
  var SCAN = {
    KeyA: 0x1E, KeyB: 0x30, KeyC: 0x2E, KeyD: 0x20, KeyE: 0x12, KeyF: 0x21,
    KeyG: 0x22, KeyH: 0x23, KeyI: 0x17, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26,
    KeyM: 0x32, KeyN: 0x31, KeyO: 0x18, KeyP: 0x19, KeyQ: 0x10, KeyR: 0x13,
    KeyS: 0x1F, KeyT: 0x14, KeyU: 0x16, KeyV: 0x2F, KeyW: 0x11, KeyX: 0x2D,
    KeyY: 0x15, KeyZ: 0x2C,
    Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06,
    Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0A, Digit0: 0x0B,
    Minus: 0x0C, Equal: 0x0D, BracketLeft: 0x1A, BracketRight: 0x1B,
    Backslash: 0x2B, Semicolon: 0x27, Quote: 0x28, Backquote: 0x29,
    Comma: 0x33, Period: 0x34, Slash: 0x35,
    Escape: 0x01, Backspace: 0x0E, Tab: 0x0F, Enter: 0x1C, Space: 0x39,
    CapsLock: 0x3A, ShiftLeft: 0x2A, ShiftRight: 0x36, ControlLeft: 0x1D,
    AltLeft: 0x38, NumpadAdd: 0x4E, NumpadSubtract: 0x4A, NumpadMultiply: 0x37,
    NumpadEnter: 0xE01C, Numpad0: 0x52, Numpad1: 0x4F, Numpad2: 0x50,
    Numpad3: 0x51, Numpad4: 0x4B, Numpad5: 0x4C, Numpad6: 0x4D, Numpad7: 0x47,
    Numpad8: 0x48, Numpad9: 0x49, NumpadDecimal: 0x53, NumLock: 0x45,
    ControlRight: 0xE01D, AltRight: 0xE038, MetaLeft: 0xE05B, MetaRight: 0xE05C,
    ContextMenu: 0xE05D,
    ArrowUp: 0xE048, ArrowDown: 0xE050, ArrowLeft: 0xE04B, ArrowRight: 0xE04D,
    Home: 0xE047, End: 0xE04F, PageUp: 0xE049, PageDown: 0xE051,
    Insert: 0xE052, Delete: 0xE053, PrintScreen: 0xE037,
    F1: 0x3B, F2: 0x3C, F3: 0x3D, F4: 0x3E, F5: 0x3F, F6: 0x40,
    F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44, F11: 0x57, F12: 0x58
  };

  /* The same table read the other way for typed input (guest commands, BIOS
     prompts): ASCII -> set-1 make code, digits and letters only plus the few
     characters the HY486 shell actually needs. */
  var TYPE_SCAN = {
    ' ': 0x39, '\r': 0x1C, '\n': 0x1C, '.': 0x34, '-': 0x0C, ':': -1,
    '/': 0x35, '_': 0x0C, '\\': 0x2B
  };
  (function buildTypeMap() {
    var i, ch;
    var digits = '1234567890';
    for (i = 0; i < digits.length; i++) TYPE_SCAN[digits.charAt(i)] = 0x02 + i;
    var letters = 'qwertyuiopasdfghjklzxcvbnm';
    var codes = [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
      0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26,
      0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x32];
    for (i = 0; i < letters.length; i++) {
      ch = letters.charAt(i);
      TYPE_SCAN[ch] = codes[i];
      TYPE_SCAN[ch.toUpperCase()] = codes[i];
    }
  })();

  var FLAG_NAMES = ['cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of',
    'iopl', 'nt', 'rf', 'vm', 'ac', 'vif', 'vip', 'id'];

  var REG16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
  var REG8 = ['al', 'ah', 'cl', 'ch', 'dl', 'dh', 'bl', 'bh'];

  var doc = null;
  var app = null;
  var D = Object.create(null);
  var S = {
    coreError: '',
    coreTried: false,
    machine: null,
    powered: false,
    running: false,
    stopped: false,
    raf: 0,
    speed: SPEED_DEFAULT,
    acc: 0,
    frameClock: 0,
    keyWake: 0,
    capture: false,
    editor: null,
    asm: null,
    program: null,
    imported: null,
    bpLines: [],
    bpAddrs: Object.create(null),
    rowAddrs: Object.create(null),
    lineAddr: Object.create(null),
    diskImage: null,
    diskTried: false,
    selectedFile: '',
    projects: Object.create(null),
    consoleNodes: 0,
    termLines: 0,
    history: [],
    historyAt: -1,
    tab: 'editor',
    stateEdit: null,
    disFollow: true,
    disRows: [],
    disBits: 0,
    disCurr: -1,
    disEip: 0,
    disV: null,
    disPrepend: 0,
    stackFollow: true,
    stackFollowAddr: -1,
    stackDirty: true,
    stackSp: 0,
    stackV: null,
    memV: null,
    memBase: 0,
    memFollowAddr: -1,
    memReg: 'esp',
    ipsBase: null,
    ips: 0,
    lastPaint: 0,
    status: 'READY',
    bpCount: 0,
    bpAddrMap: null,
    postDone: false,
    assemblePending: false,
    currentProject: '',
    inited: false
  };

  /* --------------------------------------------------------------- helpers -- */

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function setText(node, text) {
    if (!node) return;
    var s = String(text);
    if (node.textContent !== s) node.textContent = s;
  }

  function hex(n, width) {
    var s = (n >>> 0).toString(16).toUpperCase();
    var pad = width === undefined ? 2 : width;
    while (s.length < pad) s = '0' + s;
    return s;
  }

  function hexBytes(bytes, from, count) {
    var out = [], i, end;
    if (!bytes) return '';
    from = from || 0;
    end = count === undefined ? bytes.length : Math.min(bytes.length, from + count);
    for (i = from; i < end; i++) out.push(hex(bytes[i], 2));
    return out.join(' ');
  }

  function group(n) {
    var s = String(n >>> 0);
    var out = '';
    var i;
    for (i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
      out += s.charAt(i);
    }
    return out;
  }

  function clamp(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n;
  }

  function nowMs() {
    if (ROOT.performance && typeof ROOT.performance.now === 'function') return ROOT.performance.now();
    return Date.now();
  }

  function clock() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    var s = d.getSeconds();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function asBytes(data) {
    if (!data) return null;
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') {
      var out = new Uint8Array(data.length);
      for (var i = 0; i < data.length; i++) out[i] = data.charCodeAt(i) & 0xFF;
      return out;
    }
    if (typeof data.byteLength === 'number') return new Uint8Array(data);
    if (data.length !== undefined) return Uint8Array.from(data);
    return null;
  }

  function ns() {
    return ROOT.I486 || {};
  }

  function byId(name) {
    return D[name] || null;
  }

  /* ------------------------------------------------------------- the shell -- */

  function collectNodes() {
    var i, el;
    for (i = 0; i < NODE_NAMES.length; i++) {
      el = doc.querySelector('[data-i486="' + NODE_NAMES[i] + '"]');
      if (el) D[NODE_NAMES[i]] = el;
    }
  }

  function log(text, kind) {
    if (!D.console) return;
    var line = '[' + clock() + '] ' + String(text == null ? '' : text);
    var node;
    if (kind === 'ok' || kind === 'error' || kind === 'dim') {
      node = doc.createElement('span');
      node.className = kind;
      node.textContent = line + '\n';
    } else {
      node = doc.createTextNode(line + '\n');
    }
    D.console.appendChild(node);
    S.consoleNodes++;
    while (S.consoleNodes > CONSOLE_MAX && D.console.firstChild) {
      D.console.removeChild(D.console.firstChild);
      S.consoleNodes--;
    }
    D.console.scrollTop = D.console.scrollHeight;
  }

  function setStatus(text, state) {
    S.status = text;
    setText(D.status, text);
    if (D.status) {
      if (state) D.status.setAttribute('data-state', state);
      else D.status.removeAttribute('data-state');
    }
  }

  function termLine(text, cls) {
    if (!D.term) return;
    var p = doc.createElement('p');
    p.className = 'term__line' + (cls ? ' ' + cls : '');
    p.textContent = text == null ? '' : String(text);
    D.term.appendChild(p);
    S.termLines++;
    while (S.termLines > TERM_MAX && D.term.firstChild) {
      D.term.removeChild(D.term.firstChild);
      S.termLines--;
    }
    D.term.scrollTop = D.term.scrollHeight;
  }

  function termEcho(cmd) {
    if (!D.term) return;
    var p = doc.createElement('p');
    var ps = doc.createElement('span');
    var c = doc.createElement('span');
    p.className = 'term__line';
    ps.className = 'term__ps1';
    ps.textContent = TERM_PS1;
    c.className = 'term__cmd';
    c.textContent = ' ' + cmd;
    p.appendChild(ps);
    p.appendChild(c);
    D.term.appendChild(p);
    S.termLines++;
    D.term.scrollTop = D.term.scrollHeight;
  }

  /* ------------------------------------------------------------ the store -- */

  var memoryStore = (function () {
    var map = Object.create(null);
    return {
      getItem: function (k) { return hasOwn(map, k) ? map[k] : null; },
      setItem: function (k, v) { map[k] = String(v); },
      removeItem: function (k) { delete map[k]; },
      memory: true
    };
  })();

  var storeCache = null;

  function store() {
    if (storeCache) return storeCache;
    try {
      var ls = ROOT.localStorage;
      if (ls) {
        var probe = 'i486.probe';
        ls.setItem(probe, '1');
        ls.removeItem(probe);
        storeCache = ls;
        return storeCache;
      }
    } catch (err) {
      storeCache = memoryStore;
      return storeCache;
    }
    storeCache = memoryStore;
    return storeCache;
  }

  function loadProjects() {
    S.projects = Object.create(null);
    var raw = null;
    try { raw = store().getItem(PROJECT_KEY); } catch (err) { raw = null; }
    if (!raw) return;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (err) { parsed = null; }
    if (!parsed || typeof parsed !== 'object') return;
    var key;
    for (key in parsed) {
      if (!hasOwn(parsed, key)) continue;
      var item = parsed[key] || {};
      S.projects[key] = {
        source: typeof item.source === 'string' ? item.source : '',
        mode: typeof item.mode === 'string' ? item.mode : 'com16',
        updated: typeof item.updated === 'number' ? item.updated : 0
      };
    }
  }

  function saveProjects() {
    try {
      store().setItem(PROJECT_KEY, JSON.stringify(S.projects));
      return true;
    } catch (err) {
      return false;
    }
  }

  function projectNames() {
    var out = [], key;
    for (key in S.projects) {
      if (hasOwn(S.projects, key)) out.push(key);
    }
    out.sort();
    return out;
  }

  function sampleFor(name) {
    var Samples = ns().Samples;
    if (!Samples) return null;
    var key = String(name || '').toLowerCase();
    var direct = Samples.get(key);
    if (direct) return direct;
    var m = /^demo[-_/ ]?(.+)$/.exec(key);
    if (m) {
      if (m[1] === 'hello') return Samples.get('hello10');
      if (m[1] === 'fib') return Samples.get('fib');
      if (m[1] === 'boot') return Samples.get('bootsect');
      if (m[1] === 'flat32') return Samples.get('prot32');
    }
    return null;
  }

  /* --------------------------------------------------------- machine layer -- */

  function coreMissing(what) {
    log(what + ': core not loaded — ' +
      (S.coreError || 'I486 core modules are missing') + '; the editor still assembles', 'error');
    setStatus('NO CORE', 'fault');
    return null;
  }

  function ensureMachine() {
    if (S.machine) return S.machine;
    var api = ns();
    if (!api.Machine) {
      S.coreError = 'I486.Machine is not loaded';
      return null;
    }
    var machine = null;
    try {
      machine = new api.Machine({ ramMB: RAM_MB });
    } catch (err) {
      S.coreError = err && err.message ? err.message : String(err);
      return null;
    }
    machine.onFault = onFault;
    S.machine = machine;
    S.coreError = '';
    if (app) app.machine = machine;
    return machine;
  }

  function onFault(info) {
    if (!info) return;
    if (info.tripleFault) {
      stopRun();
      setStatus('FAULT', 'fault');
      log('triple fault — the CPU gave up at ' + hex(info.eip, 4) +
        ' (vector ' + info.vector + ')', 'error');
      return;
    }
    log('exception ' + info.vector + ' at ' + hex(info.eip, 4) +
      ' errorCode 0x' + hex(info.errorCode, 4), 'dim');
  }

  function ensurePowered() {
    if (!ensureMachine()) return null;
    if (!S.powered && !powerOn(true)) return null;
    return S.machine;
  }

  function setPowerLabel() {
    if (!D.power) return;
    setText(D.power, S.powered ? 'Power off' : 'Power on');
    D.power.setAttribute('aria-pressed', S.powered ? 'true' : 'false');
  }

  function powerOn(quiet) {
    var machine = ensureMachine();
    if (!machine) return coreMissing('power on');
    stopRun();
    ensureDisk(false);
    try {
      if (S.diskImage) machine.loadDiskImage(S.diskImage);
      machine.powerOn();
      machineGo();
    } catch (err) {
      log('power on failed: ' + (err && err.message ? err.message : String(err)), 'error');
      return null;
    }
    S.powered = true;
    S.program = null;
    S.imported = null;
    S.postDone = false;
    S.bpSkip = 0;
    setPowerLabel();
    setStatus('READY', 'ready');
    syncPanels(true);
    if (!quiet) {
      log('power on — CR0=0x60000010 CS:EIP=0xF000:0xFFF0, ' + RAM_MB + ' MB RAM', 'ok');
    }
    return machine;
  }

  function powerOff() {
    stopRun();
    S.powered = false;
    S.program = null;
    setPowerLabel();
    setStatus('OFF', '');
    clearCanvas();
    if (D['screen-mode']) setText(D['screen-mode'], 'no signal');
    if (D['screen-cursor']) setText(D['screen-cursor'], '—');
    log('power off', 'dim');
  }

  function doReset() {
    var machine = ensurePowered();
    if (!machine) return;
    stopRun();
    try {
      machine.reboot();
      machineGo();
    } catch (err) {
      log('reset failed: ' + (err && err.message ? err.message : String(err)), 'error');
      return;
    }
    S.program = null;
    S.bpSkip = 0;
    setStatus('READY', 'ready');
    syncPanels(true);
    log('reset — CPU back to 0xF000:0xFFF0, POST has not run yet', 'ok');
  }

  function doBoot() {
    var machine = ensureMachine();
    if (!machine) return coreMissing('boot');
    stopRun();
    if (!S.powered) {
      if (!powerOn(true)) return;
      machine = S.machine;
    }
    try {
      machine.reboot();
      machineGo();
    } catch (err) {
      log('boot failed: ' + (err && err.message ? err.message : String(err)), 'error');
      return;
    }
    S.program = null;
    S.bpSkip = 0;
    S.assemblePending = false;
    log('boot — BIOS POST, then INT 19h reads sector 0 of disk 0x80', 'ok');
    burst(RUN_BURST);
    syncPanels(true);
    startRun();
  }

  function burst(n) {
    var machine = S.machine;
    if (!machine) return 0;
    var done = 0;
    try {
      done = withGo(function () { return machine.run(n) | 0; });
    } catch (err) {
      log('run failed: ' + (err && err.message ? err.message : String(err)), 'error');
    }
    return done;
  }

  /* RUN after ASSEMBLE: put the buffer into memory (POST first, so the IVT
     exists) and jump to it. After a load or a boot the flag is clear, so RUN
     simply resumes; that is what keeps "continue after a breakpoint" working. */
  function runPending(machine) {
    var result = S.asm;
    if (!result || !result.ok || !result.bytes || !result.bytes.length) {
      S.assemblePending = false;
      return;
    }
    var loadMode = S.asmMode === 'boot16' ? 'boot16' : (S.asmMode === 'flat32' ? 'flat32' : 'com16');
    try {
      var org = loadIntoMachine(machine, result.bytes, loadMode);
      log('run: loaded ' + result.bytes.length + ' assembled bytes as ' + loadMode +
        ' at 0x' + hex(org, 4) + ', EIP=0x' + hex(machine.cpu.eip, 4), 'ok');
    } catch (err) {
      S.assemblePending = false;
      log('run: load failed — ' + errText(err), 'error');
    }
  }

  /* The machine's stop latch. PAUSE and the terminal halt both set it through
     the public API, so no frame, tick or step can retire an instruction behind
     the user's back; RUN (and every synchronous slice the user asked for)
     clears it again. */
  function machineStop() {
    var machine = S.machine;
    S.stopped = true;
    if (!machine) return;
    try {
      if (typeof machine.halt === 'function') machine.halt();
      else machine._stopped = true;
    } catch (err) {
      machine._stopped = true;
      log('halt: ' + errText(err), 'error');
    }
  }

  function machineGo() {
    var machine = S.machine;
    S.stopped = false;
    if (!machine) return;
    try {
      if (typeof machine.resume === 'function') machine.resume();
      else machine._stopped = false;
    } catch (err) {
      machine._stopped = false;
      log('resume: ' + errText(err), 'error');
    }
  }

  /* A synchronous run slice: clear the latch, execute, restore it afterwards. */
  function withGo(fn) {
    var was = S.stopped;
    machineGo();
    try { return fn(); }
    finally { if (was) machineStop(); }
  }

  /* getFlag returns 0/1 for a single-bit flag, a boolean for some others. */
  function interruptsOn(cpu) {
    var v;
    try {
      v = cpu.getFlag('if');
    } catch (err) {
      return (cpu.eflags & 0x200) !== 0;
    }
    return v === true || v === 1 || v === '1' || (typeof v === 'number' && v !== 0);
  }

  function startRun() {
    var machine = ensurePowered();
    if (!machine) return;
    if (S.running) {
      if (!S.assemblePending) return;
      stopRun();
    }
    if (machine.cpu.tripleFault) {
      log('cannot run: the CPU stopped on a triple fault; reset first', 'error');
      return;
    }
    if (S.assemblePending) runPending(machine);
    machineGo();
    S.acc = 0;
    S.frameClock = 0;
    /* The user asked to continue: a halted CPU gets one bounded wake burst. */
    S.keyWake = WAKE_BURST;
    S.running = true;
    S.ipsBase = { t: Date.now(), n: machine.instructions };
    setStatus('RUNNING', 'running');
    if (D.pause) D.pause.disabled = false;
    if (D.run) D.run.disabled = true;
    schedule();
  }

  function stopRun() {
    S.running = false;
    if (S.raf && typeof ROOT.cancelAnimationFrame === 'function') {
      ROOT.cancelAnimationFrame(S.raf);
    }
    S.raf = 0;
    if (D.pause) D.pause.disabled = true;
    if (D.run) D.run.disabled = false;
  }

  /* A user pause: the loop stops and the machine latches, so cycles and EIP
     are frozen until RUN or a single step. */
  function pauseRun(reason) {
    stopRun();
    machineStop();
    S.haltNotice = false;
    setStatus('PAUSED', 'halted');
    buildDisasm(false);
    syncPanels(true);
    log(reason || ('paused at ' + eipText() + ' — the CPU is stopped, nothing is retired'), 'dim');
  }

  function schedule() {
    if (S.raf) return;
    if (typeof ROOT.requestAnimationFrame !== 'function') {
      S.raf = ROOT.setTimeout(function () { S.raf = 0; frame(); }, 16);
      return;
    }
    S.raf = ROOT.requestAnimationFrame(frame);
  }

  function speedTarget() {
    return clamp(S.speed | 0, SPEED_MIN, SPEED_MAX);
  }

  /* The speed field means instructions per SECOND: every frame earns
     speed * dt instructions and the remainder carries into the next frame, so
     the long-run rate is the number in the field whatever the frame rate is. */
  function paceBudget(dtMs) {
    var speed = speedTarget();
    var acc = (S.acc || 0) + speed * (dtMs / 1000);
    var cap = 3 * speed / 60 + 5000;
    if (acc > cap) acc = cap;
    var n = Math.floor(acc);
    if (n > FRAME_BURST_CAP) n = FRAME_BURST_CAP;
    S.acc = acc - n;
    return n;
  }

  /* A halted CPU retires nothing until something can wake it: queued keyboard
     bytes earn one bounded burst, a timer IRQ never does (an idle guest at the
     prompt must stay at zero instructions per second). */
  function wakeBudget(machine) {
    var kb = machine && machine.keyboard;
    var queued = 0;
    if (S.keyWake) {
      S.keyWake = 0;
      queued = 1;
    } else if (kb && typeof kb.pending === 'function') {
      try { queued = kb.pending() | 0; } catch (err) { queued = 0; }
    }
    return queued > 0 ? WAKE_BURST : 0;
  }

  function frame() {
    S.raf = 0;
    if (!S.running) return;
    var machine = S.machine;
    var cpu = machine ? machine.cpu : null;
    var halted = !!(cpu && cpu.halted === true);
    var now = nowMs();
    var dt = S.frameClock ? clamp(now - S.frameClock, 0, 250) : 16.7;
    S.frameClock = now;
    var budget;
    if (halted) budget = wakeBudget(machine);
    else { S.keyWake = 0; budget = paceBudget(dt); }
    var result;
    if (budget <= 0) {
      syncPanels(false);
      schedule();
      return;
    }
    try {
      result = advance(budget, halted);
      syncPanels(false);
    } catch (err) {
      stopRun();
      log('run loop stopped: ' + (err && err.message ? err.message : String(err)), 'error');
      return;
    }
    if (result === 'bp') {
      tabDot('disasm');
      pauseRun('breakpoint hit at ' + hex(S.machine.cpu.eip, 4) +
        ' (continue or step to execute it)');
      return;
    }
    if (result === 'fault') {
      stopRun();
      buildDisasm(false);
      syncPanels(true);
      setStatus('FAULT', 'fault');
      log('stopped: triple fault', 'error');
      return;
    }
    if (result === 'halt' || (S.machine && S.machine.cpu.halted)) {
      if (!S.haltNotice) {
        S.haltNotice = true;
        setStatus('HALTED', 'halted');
        log('CPU is halted (HLT) with interrupts ' + (interruptsOn(cpu) ? 'on' : 'off') +
          ': idle, nothing is retired — a keystroke wakes it with ' + WAKE_BURST + ' instructions', 'dim');
        buildDisasm(false);
        syncPanels(true);
      }
      schedule();
      return;
    }
    S.haltNotice = false;
    schedule();
  }

  /* One execution slice. With breakpoints armed we step instruction by
     instruction so a breakpoint is reached before it executes; without any we
     let machine.run() do the tight loop. */
  function advance(limit, hop) {
    var machine = S.machine;
    var i;
    if (!machine) return 'halt';
    if (!S.bpCount) {
      machine.run(limit);
      if (machine.cpu.tripleFault) return 'fault';
      if (machine.cpu.halted) return 'halt';
      return 'ran';
    }
    for (i = 0; i < limit; i++) {
      var linear = (((machine.cpu.cs.base >>> 0) + (machine.cpu.eip >>> 0)) >>> 0);
      var flat = machine.cpu.eip >>> 0;
      /* A breakpoint you are standing on must not block the next instruction:
         both Continue and a manual Step execute it and clear the skip. */
      if (S.bpSkip && (S.bpSkip === linear || S.bpSkip === flat)) {
        S.bpSkip = 0;
      } else if (S.bpAddrMap[linear] || S.bpAddrMap[flat]) {
        S.bpSkip = linear;
        return 'bp';
      }
      if (machine.cpu.tripleFault) return 'fault';
      if (machine.cpu.halted && !hop) return 'halt';
      machine.step();
    }
    return machine.cpu.halted ? 'halt' : 'ran';
  }

  function cpuBits() {
    var machine = S.machine;
    if (!machine || !machine.cpu || !machine.cpu.cs) return 16;
    return machine.cpu.cs.big ? 32 : 16;
  }

  function linearEip() {
    var machine = S.machine;
    if (!machine) return 0;
    return (((machine.cpu.cs.base >>> 0) + (machine.cpu.eip >>> 0)) >>> 0);
  }

  function readPhys(addr, len) {
    var out = new Uint8Array(len), machine = S.machine, i;
    if (!machine || !machine.bus) return out;
    for (i = 0; i < len; i++) out[i] = machine.bus.read8(((addr + i) >>> 0)) & 0xFF;
    return out;
  }

  function instrAtEip() {
    var machine = S.machine;
    var Ds = ns().Disassembler;
    if (!machine || !Ds) return null;
    var res;
    try {
      res = Ds.disassemble(readPhys(linearEip(), 16), {
        bits: cpuBits(),
        origin: (machine.cpu.eip >>> 0),
        count: 1
      });
    } catch (err) {
      return null;
    }
    if (!res || !res.instrs || !res.instrs.length) return null;
    return res.instrs[0];
  }

  function afterStep() {
    var machine = S.machine;
    buildDisasm(false);
    syncPanels(true);
    if (!machine) return;
    if (machine.cpu.tripleFault) setStatus('FAULT', 'fault');
    else if (machine.cpu.halted) setStatus('HALTED', 'halted');
    else setStatus('PAUSED', 'halted');
  }

  /* One debugger step: the only path that advances while the machine is
     stopped by the user. It clears the latch, retires the instructions and
     re-latches, so the CPU is frozen again when the handler returns. */
  function doStep(count) {
    var machine = ensurePowered();
    if (!machine) return 0;
    var before = machine.instructions;
    stopRun();
    machineGo();
    if (machine.cpu.halted) {
      /* HLT waits for an interrupt; a debugger step has to be able to move
         past it, so clear the halt exactly like a delivered interrupt would. */
      machine.cpu.halted = false;
      log('step: HLT cleared for one instruction (an interrupt would do the same)', 'dim');
    }
    try {
      advance(count);
    } finally {
      machineStop();
    }
    return (machine.instructions - before) | 0;
  }

  function stepIn(n) {
    var machine = ensureMachine();
    if (!machine) { coreMissing('step'); return; }
    doStep(n === undefined ? 1 : clamp(n | 0, 1, SPEED_MAX));
    afterStep();
  }

  function stepOver() {
    var machine = ensurePowered();
    if (!machine) return;
    stopRun();
    machineGo();
    S.bpSkip = 0;
    var ins = instrAtEip();
    var target = 0;
    var direct = ins && ins.mnemonic === 'call' && /^0x[0-9A-F]+$/i.test(String(ins.operands || '').trim());
    if (direct) {
      target = (((machine.cpu.eip >>> 0) + ins.length) >>> 0);
      var why = machine.runUntil(target, 2000000);
      log('step over: call at ' + hex(ins.addr, 4) + ' returned (' + why + ')', 'dim');
    } else if (ins && ins.mnemonic === 'int') {
      machine.step();
      log('step over: ' + String(ins.operands || 'int').trim() + ' serviced through the IVT', 'dim');
    } else {
      machine.step();
      if (ins && ins.mnemonic === 'call') log('step over: indirect call, stepped into it', 'dim');
    }
    machineStop();
    afterStep();
  }

  function stepOut() {
    var machine = ensurePowered();
    if (!machine) return;
    stopRun();
    machineGo();
    S.bpSkip = 0;
    var bits = cpuBits();
    var cpu = machine.cpu;
    var ss = cpu.getSeg('ss') || { base: 0 };
    var sp = cpu.getReg('esp') >>> 0;
    if (bits === 16) sp &= 0xFFFF;
    var at = (((ss.base >>> 0) + sp) >>> 0);
    var raw = readPhys(at, 4);
    var target = bits === 32
      ? ((raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0)
      : (raw[0] | (raw[1] << 8));
    if (!target) {
      machine.step();
      log('step out: the return slot at ' + hex(at, 4) + ' is empty, stepped instead', 'dim');
    } else {
      var why = machine.runUntil(target, 2000000);
      log('step out: running to the return address ' + hex(target, 4) + ' (' + why + ')', 'dim');
    }
    machineStop();
    afterStep();
  }

  /* ------------------------------------------------------------- the screen -- */

  function clearCanvas() {
    var canvas = byId('screen');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    try { ctx.clearRect(0, 0, canvas.width, canvas.height); } catch (err) { /* nothing to draw */ }
  }

  function paintScreen(force) {
    var machine = S.machine;
    var canvas = byId('screen');
    if (!machine || !canvas || !S.powered) return;
    var vga = machine.screen;
    if (!vga || typeof vga.render !== 'function') return;
    var now = Date.now();
    if (!force && !vga.dirty && now - S.lastPaint < 120) return;
    S.lastPaint = now;
    try {
      vga.render(canvas);
    } catch (err) {
      log('screen: render failed — ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  function updateScreenMeta(machine) {
    var vga = machine.screen;
    if (!vga) return;
    var mode = vga.mode === 0x13 ? 0x13 : 3;
    setText(D['screen-mode'], mode === 0x13 ? 'mode 13h · 320×200' : 'mode 03h · 80×25');
    if (mode === 0x13) {
      setText(D['screen-cursor'], 'no text cursor');
    } else {
      var cur = vga.cursor || { x: 0, y: 0 };
      setText(D['screen-cursor'], 'cursor ' + (cur.x | 0) + ',' + (cur.y | 0));
    }
  }

  function clearScreen() {
    var machine = ensurePowered();
    if (!machine) return;
    var vga = machine.screen;
    if (!vga) return;
    if (typeof vga.clear === 'function') vga.clear(0x07);
    paintScreen(true);
    updateScreenMeta(machine);
    log('screen cleared (attribute 0x07)', 'dim');
  }

  /* ------------------------------------------------------------- registers -- */

  function regNodeList() {
    if (S.regNodes) return S.regNodes;
    var list = [];
    if (D.regs) {
      var nodes = D.regs.querySelectorAll('.reg');
      var i, el, name, width, val;
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        name = el.getAttribute('data-reg');
        width = parseInt(el.getAttribute('data-width'), 10);
        val = el.querySelector('.reg__val');
        if (!name || !val) continue;
        list.push({ name: name, width: isFinite(width) ? width : 32, val: val, row: el });
      }
    }
    S.regNodes = list;
    return list;
  }

  function addRegRow(name, width) {
    if (!D.regs) return null;
    var row = doc.createElement('div');
    var label = doc.createElement('span');
    var val = doc.createElement('span');
    row.className = 'reg reg--narrow';
    row.setAttribute('data-reg', name);
    row.setAttribute('data-width', String(width));
    label.className = 'reg__name';
    label.textContent = name;
    val.className = 'reg__val';
    val.setAttribute('data-edit', '');
    val.textContent = width === 16 ? '0x0000' : '0x00';
    row.appendChild(label);
    row.appendChild(val);
    D.regs.appendChild(row);
    return { name: name, width: width, val: val, row: row };
  }

  function buildRegRows() {
    var list = regNodeList();
    var i;
    for (i = 0; i < REG16.length; i++) {
      if (!hasReg(list, REG16[i])) list.push(addRegRow(REG16[i], 16));
    }
    for (i = 0; i < REG8.length; i++) {
      if (!hasReg(list, REG8[i])) list.push(addRegRow(REG8[i], 8));
    }
    S.regNodes = compress(list);
  }

  function hasReg(list, name) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].name === name) return true;
    }
    return false;
  }

  function compress(list) {
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].val) out.push(list[i]);
    }
    return out;
  }

  function regValue(cpu, name, width) {
    var v = 0;
    try { v = cpu.getReg(name) >>> 0; } catch (err) { v = 0; }
    if (width === 8) return '0x' + hex(v & 0xFF, 2);
    if (width === 16) return '0x' + hex(v & 0xFFFF, 4);
    return '0x' + hex(v >>> 0, 8);
  }

  function updateRegs(cpu) {
    var list = regNodeList();
    var i, item;
    for (i = 0; i < list.length; i++) {
      item = list[i];
      setText(item.val, regValue(cpu, item.name, item.width));
    }
  }

  function beginRegEdit(item) {
    var cpu = S.machine ? S.machine.cpu : null;
    if (!cpu) { log('registers: no machine to edit', 'error'); return; }
    if (item.input) { item.input.focus(); item.input.select(); return; }
    var input = doc.createElement('input');
    input.className = 'reg__input';
    input.type = 'text';
    input.value = (cpu.getReg(item.name) >>> 0).toString(16).toUpperCase();
    input.setAttribute('aria-label', 'new value for ' + item.name);
    item.row.appendChild(input);
    item.row.classList.add('is-editing');
    item.input = input;
    item.val.hidden = true;
    input.focus();
    input.select();

    var finish = function (commit) {
      if (!item.input) return;
      var text = String(input.value || '').trim();
      item.input = null;
      item.row.classList.remove('is-editing');
      item.val.hidden = false;
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!commit) return;
      var value = parseAddr(text, NaN);
      if (value !== value) { log('registers: "' + text + '" is not a number', 'error'); return; }
      try {
        cpu.setReg(item.name, value >>> 0);
        item.row.classList.add('is-edited');
        log('register ' + item.name + ' = 0x' + hex(value >>> 0, item.width / 4), 'ok');
      } catch (err) {
        log('register ' + item.name + ': ' + (err && err.message ? err.message : String(err)), 'error');
      }
      syncPanels(true);
    };

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      event.stopPropagation();
    });
    input.addEventListener('blur', function () { finish(false); });
  }

  /* CS/DS/ES/FS/GS/SS and CR0/CR2/CR3 are written through the CPU API; every
     rejection is logged and leaves the machine untouched. */
  var STATE_WRITE = {
    cs: 'seg', ds: 'seg', es: 'seg', fs: 'seg', gs: 'seg', ss: 'seg',
    cr0: 'cr', cr2: 'cr', cr3: 'cr'
  };

  function stateEditInit() {
    var map = stateMap();
    var key, dd;
    for (key in STATE_WRITE) {
      if (!hasOwn(STATE_WRITE, key)) continue;
      dd = map[key];
      if (!dd) continue;
      dd.setAttribute('data-edit', '');
      dd.setAttribute('data-state-key', key);
      dd.setAttribute('title', 'click to edit (0x1234, 1234h or decimal)');
      dd.classList.add('state-val');
    }
  }

  function stateRawValue(cpu, key) {
    if (key === 'cr0') return hex(cpu.cr0 >>> 0, 8);
    if (key === 'cr2' || key === 'cr3') {
      try { return hex(cpu.getCR(key === 'cr2' ? 2 : 3) >>> 0, 8); } catch (err) { return '00000000'; }
    }
    try { return hex(cpu.getSeg(key).sel >>> 0, 4); } catch (err) { return '0000'; }
  }

  function applyStateWrite(key, kind, text) {
    var machine = S.machine;
    var cpu = machine && machine.cpu;
    var value = parseAddr(text, NaN);
    var seg, idx;
    if (!cpu) { log('state: no machine to edit', 'error'); return; }
    if (value !== value) {
      log('state ' + key + ': "' + text + '" is not a number (use 0x1234, 1234h or decimal)', 'error');
      return;
    }
    if (kind === 'cr') {
      idx = key === 'cr0' ? 0 : (key === 'cr2' ? 2 : 3);
      try {
        cpu.setCR(idx, value >>> 0);
        log('control register ' + key + ' = 0x' + hex(value >>> 0, 8), 'ok');
      } catch (err) {
        log('control register ' + key + ': ' + errText(err) + ' — ' + key.toUpperCase() + ' unchanged', 'error');
      }
      syncPanels(true);
      return;
    }
    if (key === 'cs' && (cpu.cr0 & 1) === 0) {
      /* In real mode CS is the instruction-fetch base and writing it silently
         re-targets the fetch pointer; the panel refuses it and says why. */
      log('cs: real-mode CS is the fetch base of the running code — use a far jump ' +
        '(or edit it in protected mode); CS unchanged', 'error');
      return;
    }
    try {
      cpu.setSeg(key, value & 0xFFFF);
      seg = cpu.getSeg(key);
      log('segment ' + key + ' = 0x' + hex(seg.sel >>> 0, 4) +
        ' · base 0x' + hex(seg.base >>> 0, 8) + ' · limit 0x' + hex(seg.limit >>> 0, 4), 'ok');
    } catch (err) {
      log('segment ' + key + ': ' + errText(err) + ' — ' + key.toUpperCase() + ' unchanged', 'error');
    }
    syncPanels(true);
  }

  function beginStateEdit(key, dd) {
    var machine = S.machine;
    if (!machine) { log('state: no machine to edit', 'error'); return; }
    if (S.stateEdit) return;
    var kind = STATE_WRITE[key];
    var row = dd.parentNode;
    if (!kind || !row) return;
    var input = doc.createElement('input');
    input.className = 'reg__input';
    input.type = 'text';
    input.value = stateRawValue(machine.cpu, key);
    input.setAttribute('aria-label', 'new value for ' + key);
    dd.hidden = true;
    row.classList.add('is-editing');
    row.appendChild(input);
    S.stateEdit = { key: key, input: input, dd: dd, row: row };
    input.focus();
    input.select();

    var finish = function (commit) {
      if (!S.stateEdit || S.stateEdit.input !== input) return;
      S.stateEdit = null;
      var text = String(input.value || '').trim();
      if (input.parentNode) input.parentNode.removeChild(input);
      row.classList.remove('is-editing');
      dd.hidden = false;
      if (!commit) return;
      try {
        applyStateWrite(key, kind, text);
      } catch (err) {
        log('state ' + key + ': ' + errText(err), 'error');
      }
    };

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      event.stopPropagation();
    });
    input.addEventListener('blur', function () { finish(false); });
  }

  function updateFlags(cpu) {
    if (!D.flags) return;
    var buttons = D.flags.querySelectorAll('.flag');
    var i, el, name, on, value;
    for (i = 0; i < buttons.length; i++) {
      el = buttons[i];
      name = el.getAttribute('data-flag');
      if (!name) continue;
      value = 0;
      try { value = cpu.getFlag(name); } catch (err) { value = 0; }
      on = name === 'iopl' ? value !== 0 : (value === true || value === 1);
      if (el.classList.contains('is-on') !== on) el.classList.toggle('is-on', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function toggleFlag(name, el) {
    var machine = ensureMachine();
    if (!machine) { coreMissing('flags'); return; }
    var cpu = machine.cpu;
    var now = 0;
    try { now = cpu.getFlag(name); } catch (err) { now = 0; }
    var next = name === 'iopl' ? 0 : (now ? 0 : 1);
    try {
      cpu.setFlag(name, next);
      log('flag ' + name.toUpperCase() + ' = ' + next, 'ok');
    } catch (err) {
      log('flag ' + name + ': ' + (err && err.message ? err.message : String(err)), 'error');
    }
    updateFlags(cpu);
    if (el) el.setAttribute('aria-pressed', next ? 'true' : 'false');
  }

  function stateMap() {
    if (S.stateNodes) return S.stateNodes;
    var map = Object.create(null);
    if (D.state) {
      var rows = D.state.querySelectorAll('.state__row');
      var i, dt, dd, key;
      for (i = 0; i < rows.length; i++) {
        dt = rows[i].querySelector('dt');
        dd = rows[i].querySelector('dd');
        if (!dt || !dd) continue;
        key = String(dt.textContent || '').trim().toLowerCase();
        if (key) map[key] = dd;
      }
    }
    S.stateNodes = map;
    return map;
  }

  function putState(map, key, value) {
    if (map[key]) setText(map[key], value);
  }

  /* base/limit never get a row of their own: they ride in the value tooltip. */
  function stateTitle(map, key, text) {
    var dd = map[key];
    if (dd && text && dd.title !== text) dd.title = text;
  }

  function segTitle(name, seg) {
    if (!seg) return name;
    return name + ' 0x' + hex(seg.sel >>> 0, 4) +
      ' · base 0x' + hex(seg.base >>> 0, 8) +
      ' · limit 0x' + hex(seg.limit >>> 0, 4);
  }

  function modeText(machine) {
    var st = machine.state();
    if (st.mode === 'v86') return machine.cpu.cs.big ? 'v86-32' : 'v86-16';
    if (st.mode === 'protected') return machine.cpu.cs.big ? 'prot32' : 'prot16';
    return 'real16';
  }

  function measureIps() {
    var machine = S.machine;
    if (!machine) return 0;
    var now = Date.now();
    if (!S.ipsBase) S.ipsBase = { t: now, n: machine.instructions };
    var dt = now - S.ipsBase.t;
    if (dt < 400) return S.ips;
    var dn = machine.instructions - S.ipsBase.n;
    S.ips = Math.round(dn * 1000 / dt);
    S.ipsBase = { t: now, n: machine.instructions };
    return S.ips;
  }

  function updateStatePanels(machine) {
    var cpu = machine.cpu;
    var map = stateMap();
    var gdtr = cpu.gdtr || { base: 0, limit: 0 };
    var idtr = cpu.idtr || { base: 0, limit: 0 };
    putState(map, 'cs', '0x' + hex(cpu.cs.sel, 4));
    putState(map, 'ds', '0x' + hex(cpu.getReg('ds'), 4));
    putState(map, 'es', '0x' + hex(cpu.getReg('es'), 4));
    putState(map, 'ss', '0x' + hex(cpu.getReg('ss'), 4));
    putState(map, 'fs', '0x' + hex(cpu.getReg('fs'), 4));
    putState(map, 'gs', '0x' + hex(cpu.getReg('gs'), 4));
    stateTitle(map, 'cs', segTitle('cs', cpu.cs));
    stateTitle(map, 'ds', segTitle('ds', cpu.getSeg('ds')));
    stateTitle(map, 'es', segTitle('es', cpu.getSeg('es')));
    stateTitle(map, 'fs', segTitle('fs', cpu.getSeg('fs')));
    stateTitle(map, 'gs', segTitle('gs', cpu.getSeg('gs')));
    stateTitle(map, 'ss', segTitle('ss', cpu.getSeg('ss')));
    putState(map, 'cr0', '0x' + hex(cpu.cr0 >>> 0, 8));
    putState(map, 'cr2', '0x' + hex(cpu.getCR(2) >>> 0, 8));
    putState(map, 'cr3', '0x' + hex(cpu.getCR(3) >>> 0, 8));
    putState(map, 'mode', modeText(machine));
    putState(map, 'gdt', hex(gdtr.base, 4) + ':' + hex(gdtr.limit, 4));
    putState(map, 'idt', hex(idtr.base, 4) + ':' + hex(idtr.limit, 4));
    putState(map, 'cycles', group(cpu.cycles >>> 0));
    putState(map, 'ips', group(measureIps()));
    putState(map, 'halted', cpu.halted ? 'yes' : 'no');
  }

  /* ------------------------------------------------------ stack and memory --

     Both panels are windows over the address space, like the disassembly: the
     stack follows ESP by default and can be walked in both directions once it
     is unpinned, and the memory dump follows a register (esp on a fresh page)
     until the wheel freezes the base at the first visible row. */

  function readWord(addr, step) {
    var raw = readPhys(addr, step);
    if (step === 4) return ((raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)) >>> 0);
    return (raw[0] | (raw[1] << 8)) >>> 0;
  }

  /* The stack window walks dword slots: the follow base is ESP rounded down to
     four, every row is one 32-bit read, so addresses read …F0 …F4 …F8 …FC. */
  function stackTopAddr(machine) {
    var cpu = machine && machine.cpu;
    var ss, sp = 0;
    if (!cpu) return 0;
    ss = cpu.getSeg('ss') || { base: 0 };
    try { sp = cpu.getReg('esp') >>> 0; } catch (err) { sp = 0; }
    if (cpuBits() === 16) sp = sp & 0xFFFF;
    return ((((ss.base >>> 0) + sp) & ~3) >>> 0);
  }

  function stackDword(addr) {
    var machine = S.machine;
    var bus = machine && machine.bus;
    if (bus && typeof bus.read32 === 'function') {
      try { return bus.read32(addr >>> 0) >>> 0; } catch (err) { /* split read below */ }
    }
    return readWord(addr, STACK_DWORD);
  }

  function stackSlot() {
    var li = doc.createElement('li');
    var a = doc.createElement('span');
    var v = doc.createElement('span');
    a.className = 'st__addr';
    v.className = 'st__val';
    li.appendChild(a);
    li.appendChild(v);
    if (D.stack) D.stack.appendChild(li);
    return { li: li, addr: a, val: v };
  }

  function stackFill(slot, idx, addr) {
    var at = '0x' + hex(addr, 8);
    var on = addr === (S.stackSp >>> 0);
    setText(slot.addr, hex(addr, 8));
    setText(slot.val, '0x' + hex(stackDword(addr), 8));
    if (slot.li.getAttribute('data-addr') !== at) slot.li.setAttribute('data-addr', at);
    if (on !== slot.li.classList.contains('is-sp')) slot.li.classList.toggle('is-sp', on);
  }

  function stackEnsure() {
    if (S.stackV) return true;
    if (!D.stack) return false;
    D.stack.textContent = '';
    var view = listOf(D.stack, '.stack-view');
    var v = vNew(view, STACK_ROW_H, stackSlot, D.stack);
    v.fill = stackFill;
    v.step = STACK_DWORD;
    S.stackV = v;
    bindScroller(view, function () { vOnScroll(v, stackUnpin); }, stackUnpin);
    return true;
  }

  function stackRebase(sp) {
    var v = S.stackV;
    if (!v) return;
    var step = v.step || STACK_DWORD;
    var vis = Math.max(1, Math.ceil((v.ol.clientHeight || 144) / v.rowH) + 1);
    var up = Math.min(LIST_PREFETCH, Math.floor((sp >>> 0) / step));
    v.top = ((sp >>> 0) - up * step) >>> 0;
    v.count = up + vis + LIST_PREFETCH;
    vDraw(v);
    vScrollTo(v, up * v.rowH);
    vDraw(v);
  }

  function stackPin() {
    var pin = doc.querySelector('[data-stack-pin]');
    if (!pin) return;
    pin.textContent = S.stackFollow ? 'follow esp' : 'unpinned';
    pin.classList.toggle('is-on', S.stackFollow);
    pin.classList.toggle('is-off', !S.stackFollow);
  }

  function stackVisible() {
    var v = S.stackV;
    if (!v || !v.count) return 0;
    return (v.top + v.pad * v.step) >>> 0;
  }

  function stackUnpin() {
    if (!S.stackFollow) return;
    S.stackFollow = false;
    stackPin();
    log('stack: unpinned at 0x' + hex(stackVisible(), 8) +
      ' — the wheel walks the stack, double click a row sends memory', 'dim');
  }

  function stackSetFollow(on) {
    S.stackFollow = on === true;
    if (S.stackFollow) { S.stackFollowAddr = -1; S.stackDirty = true; }
    stackPin();
    if (S.machine && S.stackFollow) updateStack(S.machine);
    return S.stackFollow;
  }

  function updateStack(machine) {
    if (!stackEnsure()) return;
    var v = S.stackV;
    if (v.step !== STACK_DWORD) { v.step = STACK_DWORD; S.stackDirty = true; }
    S.stackSp = stackTopAddr(machine);
    if (S.stackFollow && (S.stackFollowAddr !== S.stackSp || S.stackDirty)) {
      S.stackFollowAddr = S.stackSp;
      S.stackDirty = false;
      stackRebase(S.stackSp);
      return;
    }
    vDraw(v);
  }

  function memSlot() {
    var li = doc.createElement('li');
    var a = doc.createElement('span');
    var h = doc.createElement('span');
    var s = doc.createElement('span');
    li.className = 'mem__row';
    a.className = 'mem__addr';
    h.className = 'mem__hex';
    s.className = 'mem__asc';
    li.appendChild(a);
    li.appendChild(h);
    li.appendChild(s);
    if (D.mem) D.mem.appendChild(li);
    return { li: li, addr: a, hex: h, asc: s };
  }

  function memFill(slot, idx, addr) {
    var raw = readPhys(addr, MEM_COLS);
    var txt = [], asc = '', j, ch;
    for (j = 0; j < MEM_COLS; j++) {
      txt.push(hex(raw[j], 2));
      ch = raw[j];
      asc += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : '.';
    }
    setText(slot.addr, hex(addr, 8));
    setText(slot.hex, txt.join(' '));
    setText(slot.asc, '|' + asc + '|');
  }

  function memEnsure() {
    if (S.memV) return true;
    if (!D.mem) return false;
    D.mem.textContent = '';
    var view = listOf(D.mem, '.mem-view');
    var v = vNew(view, MEM_ROW_H, memSlot, D.mem);
    v.fill = memFill;
    v.step = MEM_COLS;
    S.memV = v;
    bindScroller(view, function () { vOnScroll(v, memUnpin); }, memUnpin);
    return true;
  }

  var MEM_FOLLOW_NAMES = ['none', 'eip', 'eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi',
    'cs', 'ds', 'es', 'fs', 'gs', 'ss'];

  function memFollowReg() {
    return D['mem-follow'] ? String(D['mem-follow'].value || 'none') : 'none';
  }

  function memFollowValid(name) {
    for (var i = 0; i < MEM_FOLLOW_NAMES.length; i++) {
      if (MEM_FOLLOW_NAMES[i] === name) return true;
    }
    return false;
  }

  function memIsSegment(name) {
    return name === 'cs' || name === 'ds' || name === 'es' ||
      name === 'fs' || name === 'gs' || name === 'ss';
  }

  /* Following a segment register means following its base; eip means CS:EIP;
     every other name is a general register read on each refresh. */
  function memFollowAddr(machine, reg) {
    var cpu = machine && machine.cpu;
    var value = 0, seg;
    if (!cpu || reg === 'none') return null;
    if (reg === 'eip') return (linearEip() & ~0xF) >>> 0;
    if (memIsSegment(reg)) {
      try { seg = cpu.getSeg(reg); } catch (err) { seg = null; }
      value = seg ? (seg.base >>> 0) : 0;
      return (value & ~0xF) >>> 0;
    }
    try { value = cpu.getReg(reg) >>> 0; } catch (err) { value = 0; }
    return (value & ~0xF) >>> 0;
  }

  function memFollowPin() {
    var el = doc.querySelector('[data-mem-pin]');
    var reg = memFollowReg();
    if (!el) return;
    setText(el, reg === 'none' ? 'base frozen' : 'follow ' + reg);
    el.classList.toggle('is-on', reg !== 'none');
    el.classList.toggle('is-off', reg === 'none');
  }

  function memSetInput(addr) {
    if (!D['mem-base']) return;
    if (doc.activeElement === D['mem-base']) return;
    D['mem-base'].value = '0x' + hex(addr >>> 0, 8);
  }

  function memRebase(base) {
    var v = S.memV;
    if (!v) return;
    base = ((base >>> 0) & ~0xF) >>> 0;
    var vis = Math.max(1, Math.ceil((v.ol.clientHeight || 176) / v.rowH) + 1);
    var up = Math.min(LIST_PREFETCH, Math.floor(base / MEM_COLS));
    v.top = (base - up * MEM_COLS) >>> 0;
    v.count = up + vis + LIST_PREFETCH;
    S.memBase = base;
    memSetInput(base);
    vDraw(v);
    vScrollTo(v, up * v.rowH);
    vDraw(v);
  }

  function memVisibleBase() {
    var v = S.memV;
    if (!v || !v.count) return S.memBase >>> 0;
    return (v.top + v.pad * MEM_COLS) >>> 0;
  }

  function memUnpin() {
    var el = D['mem-follow'];
    if (!el || el.value === 'none') return;
    var base = memVisibleBase();
    el.value = 'none';
    S.memBase = base;
    S.memFollowAddr = -1;
    memSetInput(base);
    memFollowPin();
    try { store().setItem(MEM_FOLLOW_KEY, 'none'); } catch (err) { /* private mode */ }
    log('memory: unpinned at 0x' + hex(base, 8) + ' — the base is frozen, the dump keeps growing', 'dim');
  }

  function memSetFollow(reg) {
    var el = D['mem-follow'];
    var name = memFollowValid(reg) ? String(reg) : 'esp';
    if (el && el.value !== name) el.value = name;
    S.memFollowAddr = -1;
    if (name !== 'none') S.memReg = name;
    memFollowPin();
    try { store().setItem(MEM_FOLLOW_KEY, name); } catch (err) { /* private mode */ }
    return name;
  }

  function memGoto(addr) {
    var el = D['mem-follow'];
    addr = ((parseAddr(addr, 0) >>> 0) & ~0xF) >>> 0;
    if (el && el.value !== 'none') el.value = 'none';
    try { store().setItem(MEM_FOLLOW_KEY, 'none'); } catch (err) { /* private mode */ }
    S.memFollowAddr = -1;
    memFollowPin();
    memEnsure();
    memRebase(addr);
    memSetInput(addr);
    return addr;
  }

  function memFollowRestore() {
    var reg = S.memReg || 'esp';
    memSetFollow(reg === 'none' ? 'esp' : reg);
    if (S.machine) updateMem(S.machine);
    return memFollowReg();
  }

  function updateMem(machine) {
    if (!memEnsure()) return;
    var v = S.memV;
    var reg = memFollowReg();
    var follow = memFollowAddr(machine, reg);
    if (reg !== 'none') S.memReg = reg;
    if (follow !== null) {
      if (S.memFollowAddr !== follow) {
        S.memFollowAddr = follow;
        memRebase(follow);
        return;
      }
      vDraw(v);
      return;
    }
    S.memFollowAddr = -1;
    if (v.count <= 0) memRebase(parseAddr(D['mem-base'] ? D['mem-base'].value : '', 0));
    else vDraw(v);
  }

  function memoryBase(machine) {
    var follow = memFollowAddr(machine, memFollowReg());
    if (follow !== null) return follow >>> 0;
    if (S.memV && S.memV.count) return memVisibleBase();
    return parseAddr(D['mem-base'] ? D['mem-base'].value : '', 0);
  }

  function updateEipChip(machine) {
    if (!D.eip) return;
    var bits = cpuBits();
    var width = bits === 32 ? 8 : 4;
    setText(D.eip, '0x' + hex(machine.cpu.cs.sel, 4) + ':0x' + hex(machine.cpu.eip >>> 0, width));
  }

  function syncPanels(force) {
    var machine = S.machine;
    paintScreen(force);
    if (!machine) { disRefresh(); return; }
    try {
      updateRegs(machine.cpu);
      updateFlags(machine.cpu);
      updateStatePanels(machine);
      updateStack(machine);
      updateMem(machine);
      updateScreenMeta(machine);
      updateEipChip(machine);
      disRefresh();
    } catch (err) {
      if (!S.panelError) {
        S.panelError = true;
        log('panels: ' + (err && err.message ? err.message : String(err)), 'error');
      }
    }
  }

  /* -------------------------------------------------------------- keyboard -- */

  function isFormField(node) {
    var tag = node && node.tagName ? node.tagName.toUpperCase() : '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  /* Text entry keeps its keys (the terminal, the editor). A checkbox, a button
     or the page body must not swallow the guest's keyboard. */
  function isTextEntry(node) {
    if (!node || !node.tagName) return false;
    var tag = node.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      var type = String(node.type || 'text').toLowerCase();
      return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit';
    }
    return node.isContentEditable === true;
  }

  function screenFrame() {
    var canvas = byId('screen');
    return canvas && canvas.closest ? canvas.closest('.screen__frame') : null;
  }

  function applyCapture() {
    var frameEl = screenFrame();
    if (frameEl) frameEl.classList.toggle('is-capturing', S.capture);
    if (S.capture && D['kb-capture'] && doc.activeElement === D['kb-capture'] &&
        typeof D['kb-capture'].blur === 'function') {
      D['kb-capture'].blur();
    }
    if (D['kb-hint']) {
      setText(D['kb-hint'], S.capture
        ? 'capture on · keydown → port 0x60 · Esc is forwarded'
        : 'scancode set 1 → port 0x60 · IRQ1');
    }
    log('keyboard capture ' + (S.capture ? 'on' : 'off'), 'dim');
  }

  function sendKey(code, down) {
    var machine = S.machine;
    if (!machine || !S.powered) return;
    S.keyWake = WAKE_BURST;
    var extended = code > 0xFF;
    var base = code & 0x7F;
    if (extended && machine.keyboard && typeof machine.keyboard.queue === 'function') {
      machine.keyboard.queue(0xE0);
    }
    try {
      machine.setKey(base, down === true);
    } catch (err) {
      if (!S.keyError) {
        S.keyError = true;
        log('keyboard: ' + (err && err.message ? err.message : String(err)), 'error');
      }
    }
  }

  function onKeyDown(event) {
    if (!S.capture) return;
    if (isTextEntry(event.target)) return;
    var code = SCAN[event.code];
    if (code === undefined) {
      var key = event.key;
      if (key && key.length === 1) {
        var alt = SCAN['Key' + key.toUpperCase()] || SCAN['Digit' + key] || TYPE_SCAN[key];
        if (alt !== undefined && alt > 0) code = alt;
      }
    }
    if (code === undefined) return;
    event.preventDefault();
    if (event.repeat) return;
    sendKey(code, true);
  }

  function onKeyUp(event) {
    if (!S.capture) return;
    if (isTextEntry(event.target)) return;
    var code = SCAN[event.code];
    if (code === undefined) return;
    event.preventDefault();
    sendKey(code, false);
  }

  function bindKeyboard() {
    if (D['kb-capture']) {
      D['kb-capture'].addEventListener('change', function () {
        S.capture = D['kb-capture'].checked === true;
        applyCapture();
      });
    }
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('keyup', onKeyUp, true);
  }

  /* ------------------------------------------------------------------ IDE -- */

  function errText(err) {
    return err && err.message ? err.message : String(err);
  }

  function textOf(bytes) {
    if (!bytes) return '';
    var out = '', i;
    for (i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] & 0xFF);
    return out;
  }

  function textBytes(text) {
    var s = String(text == null ? '' : text);
    var out = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
    return out;
  }

  function parseNum(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return NaN;
    var neg = false;
    if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
    var v;
    if (/^0x/i.test(s)) v = parseInt(s.slice(2), 16);
    else if (/^[0-9A-F]+h$/i.test(s)) v = parseInt(s.slice(0, -1), 16);
    else v = parseInt(s, 10);
    if (!isFinite(v)) return NaN;
    return (neg ? -v : v) >>> 0;
  }

  function parseAddr(text, dflt) {
    var v = parseNum(text);
    if (v !== v) return dflt === undefined ? 0 : dflt;
    return v;
  }

  function getSourceText() {
    return S.editor ? String(S.editor.getValue()) : '';
  }

  function setSource(text) {
    var value = text == null ? '' : String(text);
    if (S.editor) S.editor.setValue(value);
    else if (D.source) D.source.value = value;
    if (S.editor && typeof S.editor.clearErrors === 'function') S.editor.clearErrors();
    return value;
  }

  function inferMode(source) {
    var text = String(source == null ? '' : source);
    if (/^[ \t]*bits[ \t]+32\b/im.test(text)) return 'flat32';
    if (/^[ \t]*org[ \t]+0x0*7[cd]00\b/im.test(text)) return 'boot16';
    return 'com16';
  }

  function asmOptions(mode) {
    if (mode === 'flat32') return { bits: 32, origin: 0x100000 };
    if (mode === 'boot16') return { bits: 16, origin: 0x7C00 };
    return { bits: 16, origin: 0x100 };
  }

  function applyListing(result, opts) {
    var map = Object.create(null);
    var i, item;
    if (result && result.listing) {
      for (i = 0; i < result.listing.length; i++) {
        item = result.listing[i];
        if (!item || !(item.line > 0)) continue;
        if (map[item.line] === undefined) map[item.line] = item.addr >>> 0;
      }
    }
    S.lineAddr = map;
    S.asmOrigin = opts.origin >>> 0;
    refreshBps();
  }

  function showAsmStatus(result, mode) {
    if (!D['asm-status']) return;
    var el = D['asm-status'];
    el.classList.remove('is-ok', 'is-err');
    if (result && result.ok) {
      el.classList.add('is-ok');
      setText(el, result.bytes.length + ' B · ' + mode + ' · org 0x' + hex(S.asmOrigin, 4));
    } else {
      el.classList.add('is-err');
      var count = result && result.errors ? result.errors.length : 1;
      setText(el, count + ' error' + (count === 1 ? '' : 's'));
    }
  }

  function showErrors(list) {
    if (!S.editor || typeof S.editor.setErrors !== 'function') return;
    if (list && list.length) S.editor.setErrors(list);
    else S.editor.clearErrors();
  }

  function doAssemble(quiet) {
    var A = ns().Assembler;
    var source = getSourceText();
    var mode = inferMode(source);
    var opts = asmOptions(mode);
    var result;
    if (!A) {
      var missing = { ok: false, bytes: new Uint8Array(0), origin: opts.origin, symbols: new Map(), errors: [{ line: 0, message: 'I486.Assembler is not loaded' }], listing: [] };
      showErrors(missing.errors);
      showAsmStatus(missing, mode);
      if (!quiet) log('assemble: I486.Assembler is not loaded', 'error');
      return missing;
    }
    try {
      result = A.assemble(source, opts);
    } catch (err) {
      result = {
        ok: false, bytes: new Uint8Array(0), origin: opts.origin, symbols: new Map(),
        errors: [{ line: 0, message: errText(err) }], listing: []
      };
    }
    S.asm = result;
    S.asmMode = mode;
    S.asmOpts = opts;
    applyListing(result, opts);
    showErrors(result.errors);
    showAsmStatus(result, mode);
    if (!result.ok) tabDot('editor');
    if (result.ok) {
      S.program = { bytes: result.bytes, org: opts.origin >>> 0, bits: opts.bits, mode: mode };
      S.assemblePending = true;
      if (!quiet) {
        log('assemble ok: ' + result.bytes.length + ' bytes, org 0x' + hex(opts.origin, 4) +
          ', bits ' + opts.bits + ' (' + mode + ')', 'ok');
      }
    } else if (!quiet) {
      log('assemble failed: ' + result.errors.length + ' error(s)', 'error');
      var i;
      for (i = 0; i < result.errors.length && i < 20; i++) {
        log('  line ' + result.errors[i].line + ': ' + result.errors[i].message, 'error');
      }
    }
    buildDisasm(true);
    syncPanels(false);
    return result;
  }

  /* ------------------------------------------- windowed lists (revision 2) --

     The disassembly, the stack and the memory dump are windows over the whole
     32-bit address space. Each one is a scroll container that holds at most one
     screenful of rows; the padding above and below the pool stands in for every
     row that is not rendered, so paddingTop = firstRowIndex * rowH keeps the
     scroll position and the row index in step without absolute positioning. */

  function vNew(ol, rowH, makeSlot, list) {
    return {
      ol: ol, list: list || ol, rowH: rowH, step: 1, top: 0, count: 0,
      pool: [], makeSlot: makeSlot, fill: null,
      pad: 0, vis: 0, expect: null
    };
  }

  function listOf(el, cls) {
    if (!el || !el.closest) return el;
    return el.closest(cls) || el;
  }

  function vPool(v) {
    var h = v.ol ? v.ol.clientHeight : 0;
    var vis = h > 0 ? Math.ceil(h / v.rowH) + 1 : 0;
    while (vis > 0 && v.pool.length < vis) v.pool.push(v.makeSlot(v));
    return vis;
  }

  function vDraw(v) {
    if (!v.ol) return v;
    var vis = vPool(v);
    var st = v.ol.scrollTop || 0;
    var pad = Math.floor(st / v.rowH);
    var limit = v.count > 0 ? v.count - 1 : 0;
    if (pad > limit) pad = limit;
    if (pad < 0) pad = 0;
    v.pad = pad;
    v.vis = vis;
    v.list.style.paddingTop = (pad * v.rowH) + 'px';
    var below = v.count - pad - vis;
    v.list.style.paddingBottom = (below > 0 ? below * v.rowH : 0) + 'px';
    var i, idx, slot;
    for (i = 0; i < v.pool.length; i++) {
      slot = v.pool[i];
      idx = pad + i;
      if (i < vis && v.count > 0 && idx < v.count) {
        if (slot.li.style.display === 'none') slot.li.style.display = '';
        v.fill(slot, idx, (v.top + idx * v.step) >>> 0);
      } else if (slot.li.style.display !== 'none') {
        slot.li.style.display = 'none';
      }
    }
    return v;
  }

  /* Every write we make to scrollTop stamps a short window: the scroll event it
     provokes arrives a frame later and must not be mistaken for a user gesture. */
  function vScrollTo(v, top) {
    if (!v.ol) return;
    var max = (v.count * v.rowH) - (v.ol.clientHeight || 0);
    var t = clamp(Math.round(top), 0, max > 0 ? max : 0);
    v.expect = t;
    v.expectUntil = nowMs() + 400;
    v.ol.scrollTop = t;
  }

  function vInternalScroll(v) {
    var st = v.ol ? (v.ol.scrollTop || 0) : 0;
    var internal = (v.expect !== null && Math.abs(st - v.expect) <= 1) || nowMs() < (v.expectUntil || 0);
    v.expect = null;
    return internal;
  }

  /* Keep a screenful of slack above and below so a wheel, a scrollbar drag or a
     PageDown always has somewhere to go: a window list has no end. */
  function vGrow(v) {
    if (!v.ol || v.count <= 0) return;
    var vis = v.vis || (Math.ceil((v.ol.clientHeight || 0) / v.rowH) + 1);
    var st = v.ol.scrollTop || 0;
    var pad = Math.floor(st / v.rowH);
    var up = LIST_PREFETCH - pad;
    if (up > 0 && v.top > 0) {
      var k = Math.min(up, Math.floor(v.top / v.step));
      if (k > 0) {
        v.top -= k * v.step;
        v.count += k;
        vDraw(v);
        vScrollTo(v, st + k * v.rowH);
      }
    }
    var down = pad + vis + LIST_PREFETCH - v.count;
    if (down > 0) {
      var room = Math.floor((0xFFFFFFFF - v.top) / v.step) + 1 - v.count;
      if (room > 0) v.count += Math.min(down, room);
    }
    vTrim(v, vis, pad);
  }

  function vTrim(v, vis, pad) {
    if (v.count <= LIST_MAX) return;
    if (pad === undefined) pad = v.pad;
    var from = Math.max(0, pad - LIST_PREFETCH);
    var to = Math.min(v.count, pad + vis + LIST_PREFETCH);
    var over = v.count - LIST_MAX;
    var below = Math.min(over, v.count - to);
    if (below > 0) { v.count -= below; over -= below; }
    if (over > 0) {
      var above = Math.min(over, from);
      if (above > 0) {
        v.top += above * v.step;
        v.count -= above;
        vDraw(v);
        vScrollTo(v, Math.max(0, (v.ol.scrollTop || 0) - above * v.rowH));
      }
    }
  }

  function bindScroller(ol, onScroll, onWheel, onGesture) {
    if (!ol) return;
    var queued = false;
    var run = function () {
      queued = false;
      try { onScroll(); } catch (err) { log('scroll: ' + errText(err), 'error'); }
    };
    ol.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      if (typeof ROOT.requestAnimationFrame === 'function') ROOT.requestAnimationFrame(run);
      else ROOT.setTimeout(run, 16);
    }, { passive: true });
    if (onWheel) ol.addEventListener('wheel', onWheel, { passive: true });
    if (onGesture) {
      ol.addEventListener('pointerdown', onGesture, { passive: true });
      ol.addEventListener('touchstart', onGesture, { passive: true });
    }
  }

  function vOnScroll(v, onUser) {
    var internal = vInternalScroll(v);
    if (!internal && onUser) onUser();
    vGrow(v);
    vDraw(v);
  }

  /* ---------------------------------------------------- live disassembly --

     The listing decodes on demand from the bus for any linear address. Forward
     is plain linear decoding; backwards tries start offsets -1..-15 bytes before
     the first known instruction and keeps the longest chain that decodes
     exactly into that anchor, because an x86 instruction carries no length. */

  function disBitsNow() {
    var machine = S.machine;
    if (machine && machine.cpu && machine.cpu.cs) return cpuBits();
    if (S.program && S.program.bits) return S.program.bits;
    if (S.asmOpts && S.asmOpts.bits) return S.asmOpts.bits;
    return 16;
  }

  function disReadBytes(addr, len) {
    var out = new Uint8Array(len), i, raw = null, machine = S.machine, prog = S.program, base, k;
    if (machine && machine.bus) {
      try { raw = machine.bus.getBytes(addr >>> 0, len); } catch (err) { raw = null; }
      for (i = 0; i < len; i++) out[i] = raw && i < raw.length ? raw[i] & 0xFF : 0xFF;
      return out;
    }
    base = prog && prog.bytes ? (prog.org >>> 0) : 0;
    for (i = 0; i < len; i++) {
      k = ((addr >>> 0) - base) + i;
      out[i] = prog && prog.bytes && k >= 0 && k < prog.bytes.length ? prog.bytes[k] & 0xFF : 0xFF;
    }
    return out;
  }

  function disDecodeOne(addr, bits) {
    var Ds = ns().Disassembler;
    var bytes, res, ins, len;
    addr = addr >>> 0;
    if (!Ds) return null;
    bytes = disReadBytes(addr, 16);
    ins = null;
    try {
      res = Ds.disassemble(bytes, { bits: bits, origin: addr, count: 1 });
      ins = res && res.instrs && res.instrs.length ? res.instrs[0] : null;
    } catch (err) {
      ins = null;
    }
    if (!ins) {
      return { addr: addr, len: 1, text: 'db 0x' + hex(bytes[0], 2), bytesText: hex(bytes[0], 2), mnemonic: 'db' };
    }
    len = ins.length > 0 ? ins.length : 1;
    return {
      addr: addr,
      len: len,
      text: String(ins.text == null ? '' : ins.text),
      bytesText: hexBytes(ins.bytes, 0, 6),
      mnemonic: String(ins.mnemonic == null ? '' : ins.mnemonic)
    };
  }

  function disForward(rows, addr, bits, count) {
    var a = addr >>> 0, n = 0, row, next;
    while (n < count) {
      row = disDecodeOne(a, bits);
      if (!row) break;
      rows.push(row);
      next = (a + row.len) >>> 0;
      if (row.len <= 0 || next <= a) break;
      a = next;
      n++;
    }
    return n;
  }

  function disBackChain(anchor, bits) {
    var best = null, o, start, chain, a, row, next, guard;
    anchor = anchor >>> 0;
    for (o = 1; o <= 15; o++) {
      if (anchor < o) break;
      start = (anchor - o) >>> 0;
      chain = [];
      a = start;
      guard = 0;
      while (a !== anchor && guard < 16) {
        row = disDecodeOne(a, bits);
        if (!row || row.len <= 0) break;
        chain.push(row);
        next = (a + row.len) >>> 0;
        if (next <= a || next > anchor) break;
        a = next;
        guard++;
      }
      if (a !== anchor || !chain.length) continue;
      if (!best || chain.length > best.length) best = chain;
    }
    return best;
  }

  function disPrependRows(want) {
    var rows = S.disRows, added = 0, chain, last, byte;
    while (added < want && rows.length && rows[0].addr > 0) {
      chain = disBackChain(rows[0].addr, S.disBits);
      if (!chain) {
        /* No start offset lines up with the anchor (the heuristic guessed a
           boundary that is inside a longer instruction): step back one byte so
           the window can still grow upwards, and let a later chain re-sync. */
        last = (rows[0].addr - 1) >>> 0;
        byte = disReadBytes(last, 1);
        chain = [{ addr: last, len: 1, text: 'db 0x' + hex(byte[0], 2), bytesText: hex(byte[0], 2), mnemonic: 'db' }];
      }
      rows = chain.concat(rows);
      added += chain.length;
    }
    if (added && S.disV) S.disV.count = rows.length;
    S.disRows = rows;
    return added;
  }

  function disAppendRows(want) {
    var rows = S.disRows, last = rows.length ? rows[rows.length - 1] : null;
    var added;
    if (!last || want <= 0) return 0;
    if (last.addr + last.len > 0xFFFFFFFF) return 0;
    added = disForward(rows, (last.addr + last.len) >>> 0, S.disBits, want);
    if (added && S.disV) S.disV.count = rows.length;
    return added;
  }

  function disSlot() {
    var li = doc.createElement('li');
    var a = doc.createElement('span');
    var b = doc.createElement('span');
    var t = doc.createElement('span');
    li.setAttribute('data-bp', '0');
    a.className = 'ds-addr';
    b.className = 'ds-bytes';
    t.className = 'ds-text';
    li.appendChild(a);
    li.appendChild(b);
    li.appendChild(t);
    if (D.disasm) D.disasm.appendChild(li);
    return { li: li, addr: a, bytes: b, text: t, ea: null };
  }

  function disFill(slot, idx) {
    var rows = S.disRows, row = rows[idx];
    var at, bp, curr;
    if (!row) {
      if (slot.li.style.display !== 'none') slot.li.style.display = 'none';
      return;
    }
    at = '0x' + hex(row.addr, 8);
    if (slot.li.getAttribute('data-addr') !== at) slot.li.setAttribute('data-addr', at);
    setText(slot.addr, hex(row.addr, 8));
    setText(slot.bytes, row.bytesText);
    setText(slot.text, row.text);
    bp = S.bpAddrMap && S.bpAddrMap[row.addr] ? '1' : '0';
    if (slot.li.getAttribute('data-bp') !== bp) slot.li.setAttribute('data-bp', bp);
    curr = row.addr === S.disCurr;
    if (curr !== slot.li.classList.contains('is-curr')) slot.li.classList.toggle('is-curr', curr);
    if (curr && !slot.ea) {
      slot.ea = doc.createElement('span');
      slot.ea.className = 'ds-ea';
      slot.li.appendChild(slot.ea);
    } else if (!curr && slot.ea) {
      slot.li.removeChild(slot.ea);
      slot.ea = null;
    }
    if (slot.ea) setText(slot.ea, '@0x' + hex(S.disEip >>> 0, 8));
  }

  function disEmpty(text) {
    var ol = D.disasm;
    S.disV = null;
    S.disRows = [];
    if (!ol) return;
    ol.style.paddingTop = '0px';
    ol.style.paddingBottom = '0px';
    ol.textContent = '';
    var li = doc.createElement('li');
    var sp = doc.createElement('span');
    li.className = 'ds-empty';
    sp.className = 'ds-text';
    sp.textContent = String(text);
    li.appendChild(sp);
    ol.appendChild(li);
  }

  function disSetBitsLabel() {
    var el = doc.querySelector('[data-ds-bits]');
    if (el) setText(el, String(S.disBits || 16) + '-bit');
  }

  function disEnsure() {
    if (!D.disasm) return false;
    if (!ns().Disassembler) { if (S.disV) disEmpty('I486.Disassembler is not loaded'); return false; }
    if (S.disV) return true;
    D.disasm.textContent = '';
    D.disasm.style.paddingTop = '0px';
    D.disasm.style.paddingBottom = '0px';
    var view = listOf(D.disasm, '.ds-view');
    var v = vNew(view, DIS_ROW_H, disSlot, D.disasm);
    v.fill = disFill;
    S.disV = v;
    S.disRows = [];
    S.disBits = 0;
    if (!view.__i486Bound) {
      view.__i486Bound = true;
      bindScroller(view, disOnScroll, disUserGesture, disUserGesture);
    }
    return true;
  }

  function disIndexAt(addr) {
    var rows = S.disRows, lo = 0, hi = rows.length - 1, mid;
    if (!rows.length || addr < 0) return -1;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      if (rows[mid].addr === addr) return mid;
      if (rows[mid].addr < addr) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  /* The row that contains CS:EIP. Instruction boundaries are the normal case,
     but a paused CPU can sit mid-instruction, so the range is checked. */
  function disCurrent() {
    var rows = S.disRows, lo, hi, mid, best, eip;
    S.disCurr = -1;
    if (!rows.length) return;
    eip = S.machine && S.machine.cpu && S.machine.cpu.cs ? linearEip() : 0;
    S.disEip = eip >>> 0;
    if (!S.machine || !S.machine.cpu || !S.machine.cpu.cs) return;
    lo = 0;
    hi = rows.length - 1;
    best = -1;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      if (rows[mid].addr <= eip) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best >= 0 && eip < rows[best].addr + rows[best].len) S.disCurr = rows[best].addr;
  }

  function disVisibleAddr() {
    var v = S.disV;
    if (!v || !S.disRows.length) return null;
    var row = S.disRows[Math.min(v.pad, S.disRows.length - 1)];
    return row ? row.addr >>> 0 : null;
  }

  function disDefaultAddr() {
    if (S.machine && S.machine.cpu && S.machine.cpu.cs) return linearEip();
    if (S.program && S.program.org) return S.program.org >>> 0;
    if (S.asmOrigin) return S.asmOrigin >>> 0;
    return 0;
  }

  function disAnchor(addr, wantUp) {
    var v = S.disV, head, rows;
    if (!v) return;
    S.disBits = disBitsNow();
    disSetBitsLabel();
    rows = [];
    head = disDecodeOne(addr >>> 0, S.disBits);
    if (head) {
      rows.push(head);
      disForward(rows, (head.addr + head.len) >>> 0, S.disBits, DIS_FORWARD);
    }
    S.disRows = rows;
    v.count = rows.length;
    v.top = 0;
    v.step = 1;
    if (!rows.length) { vDraw(v); return; }
    S.disPrepend = disPrependRows(wantUp === undefined ? LIST_PREFETCH : wantUp);
    disCurrent();
    vDraw(v);
    vScrollTo(v, Math.max(0, (S.disPrepend - 2) * v.rowH));
    vDraw(v);
  }

  function disDraw() {
    var v = S.disV;
    if (!v) return;
    v.count = S.disRows.length;
    disCurrent();
    vDraw(v);
  }

  /* Only a scroll that we did not cause may unpin the listing: our own
     follow/re-anchor/growth writes are stamped by vScrollTo and land inside the
     window, so running, stepping or re-anchoring never touches S.disFollow. */
  function disOnScroll() {
    var v = S.disV;
    if (!v) return;
    var internal = vInternalScroll(v);
    if (!internal && S.disFollow) disSetFollow(false);
    disGrow();
    disDraw();
  }

  /* wheel / pointerdown / touchstart on the listing: the user takes over. */
  function disUserGesture() {
    if (S.disFollow) disSetFollow(false);
  }

  function disGrow() {
    var v = S.disV;
    if (!v || !v.count) return;
    var vis = v.vis || (Math.ceil((v.ol.clientHeight || 0) / v.rowH) + 1);
    var st = v.ol.scrollTop || 0;
    var pad = Math.floor(st / v.rowH);
    var up = LIST_PREFETCH - pad;
    var added, down;
    if (up > 0) {
      added = disPrependRows(up);
      if (added > 0) {
        vDraw(v);
        vScrollTo(v, st + added * v.rowH);
      }
    }
    down = Math.floor((v.ol.scrollTop || 0) / v.rowH) + vis + LIST_PREFETCH - S.disRows.length;
    if (down > 0) disAppendRows(down);
    disTrimRows(vis);
    v.count = S.disRows.length;
  }

  function disTrimRows(vis) {
    var v = S.disV, rows = S.disRows;
    if (!v || rows.length <= LIST_MAX) return;
    var over = rows.length - LIST_MAX;
    var to = Math.min(rows.length, v.pad + vis + LIST_PREFETCH);
    var below = Math.min(over, rows.length - to);
    if (below > 0) { rows.length = rows.length - below; over -= below; }
    if (over > 0) {
      var above = Math.min(over, Math.max(0, v.pad - LIST_PREFETCH));
      if (above > 0) {
        rows.splice(0, above);
        v.count = rows.length;
        vDraw(v);
        vScrollTo(v, Math.max(0, (v.ol.scrollTop || 0) - above * v.rowH));
      }
    }
    v.count = rows.length;
  }

  function disSetFollow(on, quiet) {
    var next = on === true;
    var changed = next !== S.disFollow;
    S.disFollow = next;
    if (D['dis-follow']) {
      setText(D['dis-follow'], next ? 'FOLLOW' : 'UNPINNED');
      D['dis-follow'].setAttribute('aria-pressed', next ? 'true' : 'false');
      D['dis-follow'].classList.toggle('is-on', next);
      D['dis-follow'].classList.toggle('is-off', !next);
    }
    if (next && changed && S.disV) disAnchor(disDefaultAddr(), LIST_PREFETCH);
    if (changed && !quiet) {
      log('disassembly: ' + (next ? 'following CS:EIP' : 'unpinned — the anchor stays put'), 'dim');
    }
    return next;
  }

  function disFollowSync() {
    var v = S.disV;
    if (!v || S.tab !== 'disasm') return;
    var machine = S.machine;
    var bits, eip, prev, idx, top, moved;
    if (!machine || !machine.cpu || !machine.cpu.cs) { disDraw(); return; }
    bits = disBitsNow();
    eip = linearEip();
    prev = S.disCurr;
    if (bits !== S.disBits) { disAnchor(eip, LIST_PREFETCH); return; }
    disCurrent();
    idx = disIndexAt(S.disCurr);
    if (S.disCurr < 0 || idx < 0) { disAnchor(eip, LIST_PREFETCH); return; }
    moved = prev !== S.disCurr;
    if (idx < v.pad + 1 || idx > v.pad + v.vis - 2) {
      top = Math.max(0, (idx - 2) * v.rowH);
      vDraw(v);
      vScrollTo(v, top);
      disGrow();
      moved = true;
    }
    if (moved) disDraw();
  }

  function disRefresh() {
    if (!disEnsure()) return;
    var bits = disBitsNow();
    if (!S.disRows.length || bits !== S.disBits) {
      /* A code-size switch invalidates every row: re-anchor where the user is
         looking (or on CS:EIP while following) with the new instruction size. */
      var at = S.disFollow ? disDefaultAddr() : disVisibleAddr();
      disAnchor(at === null ? disDefaultAddr() : at, LIST_PREFETCH);
      return;
    }
    if (S.disFollow) { disFollowSync(); return; }
    disDraw();
  }

  /* Refresh the listing: following re-anchors on CS:EIP, an unpinned list keeps
     its own anchor and only re-decodes when the code size changes. */
  function buildDisasm(force) {
    if (!disEnsure()) return;
    var bits = disBitsNow();
    var at = S.disFollow ? disDefaultAddr() : disVisibleAddr();
    if (force || !S.disRows.length || bits !== S.disBits) {
      disAnchor(at === null ? disDefaultAddr() : at, LIST_PREFETCH);
      return;
    }
    if (S.disFollow) { disFollowSync(); return; }
    disDraw();
  }

  function disJump(addr) {
    if (!disEnsure()) return 0;
    addr = addr >>> 0;
    disAnchor(addr, LIST_PREFETCH);
    disDraw();
    /* An explicit jump always normalises the field, even while it has focus. */
    if (D['dis-goto']) D['dis-goto'].value = '0x' + hex(addr, 8);
    return addr;
  }

  function parseHexAddr(text) {
    var s = String(text == null ? '' : text).trim().replace(/^0x/i, '').replace(/h$/i, '');
    if (!s || !/^[0-9A-F]+$/i.test(s)) return NaN;
    return (parseInt(s, 16) >>> 0);
  }

  function disGoto(text) {
    var addr = parseHexAddr(text);
    var at;
    if (addr !== addr) return false;
    if (S.disFollow) disSetFollow(false, true);
    at = disJump(addr);
    log('disassembly: goto 0x' + hex(at, 8) + ' (' + disBitsNow() + '-bit)', 'dim');
    return true;
  }

  /* Live decode at any linear address, independent of what the panel shows. */
  function disasmAt(addr, rows) {
    var out = [], a = addr >>> 0, n = clamp(rows === undefined ? 12 : rows | 0, 1, 200);
    var bits = disBitsNow(), row, next, i;
    if (!ns().Disassembler) return out;
    for (i = 0; i < n; i++) {
      row = disDecodeOne(a, bits);
      if (!row) break;
      out.push({ addr: row.addr, text: row.text });
      next = (a + row.len) >>> 0;
      if (row.len <= 0 || next <= a) break;
      a = next;
    }
    return out;
  }

  function toggleRowBp(addr) {
    addr = addr >>> 0;
    if (S.rowAddrs[addr]) delete S.rowAddrs[addr];
    else S.rowAddrs[addr] = true;
    refreshBps();
    log('breakpoint ' + (S.rowAddrs[addr] ? 'set' : 'cleared') + ' at 0x' + hex(addr, 8) +
      ' (' + S.bpCount + ' armed)', 'dim');
  }

  function refreshBps() {
    var map = Object.create(null);
    var count = 0, i, addr, key;
    for (i = 0; i < S.bpLines.length; i++) {
      addr = S.lineAddr[S.bpLines[i]];
      if (addr !== undefined && !map[addr >>> 0]) {
        map[addr >>> 0] = true;
        count++;
      }
    }
    for (key in S.rowAddrs) {
      if (!hasOwn(S.rowAddrs, key)) continue;
      if (!map[key >>> 0]) {
        map[key >>> 0] = true;
        count++;
      }
    }
    S.bpAddrMap = map;
    S.bpCount = count;
    applyRowBps();
    return count;
  }

  function applyRowBps() {
    disDraw();
  }

  function clearBreakpoints() {
    S.rowAddrs = Object.create(null);
    S.bpLines = [];
    if (S.editor && typeof S.editor.setBreakpoints === 'function') S.editor.setBreakpoints([]);
    refreshBps();
    buildDisasm(true);
    log('breakpoints cleared', 'dim');
  }

  /* ------------------------------------------------------------- load/run -- */

  /* The program name follows what is actually in the editor: if the buffer
     still matches a sample byte for byte, that id names the .COM. */
  function sourceSampleId() {
    var Samples = ns().Samples;
    var source = getSourceText();
    var i;
    if (!Samples || !source) return '';
    for (i = 0; i < Samples.list.length; i++) {
      if (Samples.list[i].source === source) return Samples.list[i].id;
    }
    return '';
  }

  function programBaseName() {
    var name = sourceSampleId() || S.currentProject || (D.project ? D.project.value : '') || 'prog';
    name = String(name).replace(/^demo[-_/]/, '');
    return name;
  }

  function hyfsName(raw) {
    var s = String(raw == null ? '' : raw).toUpperCase();
    var dot = s.lastIndexOf('.');
    var base = dot > 0 ? s.slice(0, dot) : s;
    var ext = dot > 0 ? s.slice(dot + 1) : '';
    base = base.replace(/[^A-Z0-9_-]/g, '').slice(0, 8);
    ext = ext.replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (!base) base = 'PROG';
    return ext ? base + '.' + ext : base;
  }

  function programName() {
    var base = programBaseName();
    return hyfsName(/\./.test(base) ? base : base + '.COM');
  }

  /* A standalone program still needs the BIOS: the IVT and the interrupt
     handlers only exist after POST. Rather than trusting a flag we check the
     first 32 vectors, which point into the ROM once POST has installed them. */
  function ivtReady() {
    var machine = S.machine;
    var vec, off, seg, pa;
    if (!machine || !machine.bus) return false;
    for (vec = 0; vec < 0x20; vec++) {
      off = machine.bus.read16(vec * 4) & 0xFFFF;
      seg = machine.bus.read16(vec * 4 + 2) & 0xFFFF;
      if (!seg) return false;
      pa = (((seg << 4) + off) >>> 0);
      if (pa < 0xF0000) return false;
    }
    return true;
  }

  function ensurePost() {
    var machine = S.machine;
    var ran = 0;
    if (!machine) return false;
    if (S.postDone && ivtReady()) return true;
    try {
      if (S.diskImage) machine.loadDiskImage(S.diskImage);
      machine.reboot();
    } catch (err) {
      return false;
    }
    while (ran < POST_BUDGET) {
      machine.run(POST_CHUNK);
      ran += POST_CHUNK;
      if (machine.cpu.tripleFault) break;
      if (machine.cpu.halted) break;
      if (screenHas('romon') || screenHas('hy486')) break;
    }
    S.powered = true;
    S.postDone = ivtReady();
    S.program = null;
    if (S.postDone) {
      log('machine: BIOS POST ran (' + group(ran) + ' instructions), IVT and handlers installed', 'dim');
    } else {
      log('machine: POST did not install the IVT within ' + group(POST_BUDGET) + ' instructions', 'error');
    }
    return S.postDone;
  }

  function loadIntoMachine(machine, bytes, loadMode) {
    var org = loadMode === 'flat32' ? 0x100000 : (loadMode === 'boot16' ? 0x7C00 : 0x100);
    ensurePost();
    S.bpSkip = 0;
    S.assemblePending = false;
    machine.loadProgram(bytes, { mode: loadMode });
    S.powered = true;
    S.program = { bytes: bytes, org: org >>> 0, bits: loadMode === 'flat32' ? 32 : 16, mode: loadMode };
    buildDisasm(true);
    syncPanels(true);
    return org;
  }

  function runCom() {
    var machine = ensureMachine();
    if (!machine) { coreMissing('run .COM'); return; }
    stopRun();
    var bytes = null;
    var loadMode = 'com16';
    var result = null;
    if (S.imported && S.imported.bytes && S.imported.bytes.length) {
      bytes = S.imported.bytes;
      loadMode = S.imported.mode || 'com16';
      log('run: imported binary, ' + bytes.length + ' bytes', 'dim');
      S.imported = null;
    } else {
      result = doAssemble(false);
      if (!result.ok) {
        log('run .COM: fix the assemble errors first', 'error');
        return;
      }
      bytes = result.bytes;
      loadMode = S.asmMode === 'boot16' ? 'boot16' : (S.asmMode === 'flat32' ? 'flat32' : 'com16');
      if (loadMode !== 'com16') log('run .COM: the source says ' + S.asmMode + ', honouring it', 'dim');
    }
    if (!bytes || !bytes.length) {
      log('run .COM: nothing to run (0 bytes)', 'error');
      return;
    }
    if (!S.powered && !powerOn(true)) return;
    machine = S.machine;
    var org;
    try {
      org = loadIntoMachine(machine, bytes, loadMode);
    } catch (err) {
      log('run .COM: load failed — ' + errText(err), 'error');
      return;
    }
    log('loaded ' + bytes.length + ' bytes as ' + loadMode + ' at 0x' + hex(org, 4) +
      ', EIP=0x' + hex(machine.cpu.eip, 4), 'ok');
    S.imported = null;
    startRun();
  }

  function runFlat32() {
    var machine = ensureMachine();
    if (!machine) { coreMissing('run flat32'); return; }
    stopRun();
    var A = ns().Assembler;
    var opts = asmOptions('flat32');
    var result;
    if (!A) { coreMissing('run flat32'); return; }
    try {
      result = A.assemble(getSourceText(), opts);
    } catch (err) {
      result = { ok: false, errors: [{ line: 0, message: errText(err) }], bytes: new Uint8Array(0), listing: [], symbols: new Map(), origin: opts.origin };
    }
    S.asm = result;
    S.asmMode = 'flat32';
    S.asmOpts = opts;
    applyListing(result, opts);
    showErrors(result.errors);
    showAsmStatus(result, 'flat32');
    if (!result.ok) {
      log('run flat32: ' + result.errors.length + ' error(s)', 'error');
      var i;
      for (i = 0; i < result.errors.length && i < 12; i++) {
        log('  line ' + result.errors[i].line + ': ' + result.errors[i].message, 'error');
      }
      buildDisasm(true);
      return;
    }
    if (!S.powered && !powerOn(true)) return;
    machine = S.machine;
    try {
      loadIntoMachine(machine, result.bytes, 'flat32');
    } catch (err) {
      log('run flat32: load failed — ' + errText(err), 'error');
      return;
    }
    log('flat32: ' + result.bytes.length + ' bytes at 0x100000, CR0.PE=1, ring 0, EIP=0x' +
      hex(machine.cpu.eip, 8), 'ok');
    startRun();
  }

  function screenHas(needle) {
    var machine = S.machine;
    if (!machine || !machine.screen) return false;
    var lines;
    try { lines = machine.screen.getScreenText(); } catch (err) { return false; }
    for (var i = 0; i < lines.length; i++) {
      if (String(lines[i]).indexOf(needle) >= 0) return true;
    }
    return false;
  }

  function screenText() {
    var machine = S.machine;
    var out = [], i;
    if (!machine || !machine.screen) {
      for (i = 0; i < 25; i++) out.push('');
      return out;
    }
    var lines = [];
    try { lines = machine.screen.getScreenText() || []; } catch (err) { lines = []; }
    for (i = 0; i < 25; i++) out.push(String(lines[i] === undefined ? '' : lines[i]));
    return out;
  }

  function runChunks(budget, stop) {
    var machine = S.machine;
    if (!machine) return 0;
    return withGo(function () {
      var done = 0, chunk = 50000, slice;
      while (done < budget) {
        if (machine.cpu.tripleFault) break;
        slice = Math.min(chunk, budget - done);
        machine.run(slice);
        done += slice;
        if (stop && stop()) break;
        if (machine.cpu.halted && !machine.cpu.canInterrupt()) {
          /* HLT with interrupts off never wakes up: stop burning the budget */
          break;
        }
      }
      return done;
    });
  }

  function typeText(text, per) {
    var machine = S.machine;
    var steps = 0;
    if (!machine) return 0;
    var gap = per || 3000;
    var i, code;
    for (i = 0; i < text.length; i++) {
      code = TYPE_SCAN[text.charAt(i)];
      if (code === undefined || code < 0) continue;
      sendKey(code, true);
      steps += burst(gap);
      sendKey(code, false);
      steps += burst(gap);
    }
    return steps;
  }

  function directRun(result, budget, mode) {
    var machine = S.machine;
    var loadMode = mode === 'boot16' || mode === 'flat32' ? mode : 'com16';
    if (!machine) return { ok: false, steps: 0 };
    if (!S.powered && !powerOn(true)) return { ok: false, steps: 0 };
    machine = S.machine;
    try {
      loadIntoMachine(machine, result.bytes, loadMode);
    } catch (err) {
      log('run: load failed — ' + errText(err), 'error');
      return { ok: false, steps: 0 };
    }
    log('loaded ' + result.bytes.length + ' bytes as ' + loadMode + ' at 0x' +
      hex(S.program.org, 4), 'ok');
    var steps = runChunks(Math.max(1000, budget), null);
    syncPanels(true);
    return { ok: true, steps: steps, path: loadMode };
  }

  /* Guest run: put the program on the HYFS image, boot the machine, wait for
     the HY486 prompt and type "run FILE" at it. If the guest cannot get that
     far the .COM is loaded directly so the demo still shows its output. */
  function guestRun(result, budget) {
    var machine = ensureMachine();
    var api = ns();
    var Disk = api.Disk;
    if (!machine) return { ok: false, steps: 0 };
    if (!result || !result.ok || !result.bytes || !result.bytes.length) return { ok: false, steps: 0 };
    if (!Disk || !ensureDisk(false) || !S.diskImage) {
      log('run in guest: no HYFS image available, loading the .COM directly', 'dim');
      return directRun(result, budget, S.asmMode);
    }
    var name = programName();
    if (!Disk.writeFile(S.diskImage, name, result.bytes)) {
      log('run in guest: HYFS refused the name ' + name + ', loading the .COM directly', 'dim');
      return directRun(result, budget, S.asmMode);
    }
    refreshFiles();
    try {
      machine.loadDiskImage(S.diskImage);
      machine.reboot();
      machineGo();
    } catch (err) {
      log('run in guest: boot failed — ' + errText(err), 'dim');
      return directRun(result, budget, S.asmMode);
    }
    S.powered = true;
    S.program = null;
    S.assemblePending = false;
    setPowerLabel();
    log('run in guest: ' + name + ' written to hyfs.img, booting', 'ok');
    var total = 0;
    var wait = runChunks(Math.floor(budget * 0.5), function () { return screenHas('hy486'); });
    total += wait;
    if (!screenHas('hy486')) {
      log('run in guest: no kernel prompt after ' + group(total) +
        ' instructions, loading the .COM directly', 'error');
      return directRun(result, budget - total > 20000 ? budget - total : 200000, S.asmMode);
    }
    log('run in guest: HY486 prompt reached after ' + group(total) + ' instructions', 'ok');
    var before = screenText().join('\u0001');
    total += typeText('run ' + name + '\r', 3000);
    total += runChunks(Math.max(20000, budget - total), function () {
      return screenText().join('\u0001') !== before;
    });
    syncPanels(true);
    return { ok: true, steps: total, path: 'guest', name: name };
  }

  function runInGuest(syncSteps) {
    var api = ns();
    var machine = ensureMachine();
    if (!machine) { coreMissing('run in guest'); return { ok: false, steps: 0 }; }
    stopRun();
    var result = doAssemble(false);
    if (!result.ok) {
      log('run in guest: fix the assemble errors first', 'error');
      return { ok: false, steps: 0 };
    }
    var budget = syncSteps === undefined ? GUEST_BUDGET : clamp(syncSteps | 0, 1000, 20000000);
    if (S.asmMode !== 'com16') {
      log('run in guest: a ' + S.asmMode + ' program cannot be run by the HY486 kernel, loading it directly', 'dim');
      return directRun(result, budget);
    }
    if (!api.Guest || !api.Disk) {
      log('run in guest: guest/disk modules are missing, loading the .COM directly', 'dim');
      return directRun(result, budget);
    }
    return guestRun(result, budget);
  }

  /* ----------------------------------------------------------------- disk -- */

  function builtinFiles() {
    var api = ns();
    var out = [];
    var Samples = api.Samples;
    var A = api.Assembler;
    var hello = Samples ? Samples.get('hello10') : null;
    var fib = Samples ? Samples.get('fib') : null;
    if (A && hello) {
      var r = A.assemble(hello.source, { bits: 16, origin: 0x100 });
      if (r.ok) out.push({ name: 'HELLO.COM', data: r.bytes });
    }
    if (A && fib) {
      var f = A.assemble(fib.source, { bits: 16, origin: 0x100 });
      if (f.ok) out.push({ name: 'FIB.COM', data: f.bytes });
    }
    out.push({
      name: 'README.TXT',
      data: textBytes(
        'HY486 / HYFS disk\r\n' +
        'sector 1 is the superblock, sectors 2-9 the directory,\r\n' +
        '4-sector clusters of data from sector 12. KERNEL.SYS is the\r\n' +
        'real-mode shell the boot sector chain-loads to 0x0000:0x8000.\r\n')
    });
    if (hello) out.push({ name: 'HELLO.ASM', data: textBytes(hello.source) });
    return out;
  }

  function buildDefaultImage() {
    var api = ns();
    var files = builtinFiles();
    var image = null;
    if (api.Guest && api.Assembler) {
      try {
        var built = api.Guest.build({ assembler: api.Assembler, files: files, sectors: DISK_SECTORS });
        log('hyfs.img built: ' + built.files.length + ' files, kernel ' + built.kernelSize +
          ' bytes at LBA ' + built.kernelLba + ', ' + built.sectors + ' sectors', 'ok');
        return built.image;
      } catch (err) {
        log('guest build failed: ' + errText(err), 'error');
      }
    }
    if (api.Disk) {
      try {
        image = api.Disk.format({ sectors: DISK_SECTORS, files: files });
      } catch (err) {
        log('HYFS format failed: ' + errText(err), 'error');
        image = null;
      }
    }
    return image;
  }

  function ensureDisk(rebuild) {
    if (S.diskImage && !rebuild) return S.diskImage;
    S.diskImage = buildDefaultImage();
    if (S.diskImage && S.machine) {
      try { S.machine.loadDiskImage(S.diskImage); } catch (err) { /* kept in the UI only */ }
    }
    refreshFiles();
    return S.diskImage;
  }

  function diskList() {
    var api = ns();
    if (!S.diskImage || !api.Disk) return [];
    try {
      return api.Disk.list(S.diskImage) || [];
    } catch (err) {
      return [];
    }
  }

  function fmtSize(n) {
    var s = String(n >>> 0);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) out += ' ';
      out += s.charAt(i);
    }
    return out + ' B';
  }

  function refreshFiles() {
    var ul = byId('files');
    if (!ul) return;
    var files = diskList();
    ul.textContent = '';
    var i, li, name, size, run;
    for (i = 0; i < files.length; i++) {
      li = doc.createElement('li');
      li.setAttribute('data-name', files[i].name);
      name = doc.createElement('span');
      name.className = 'file__name';
      name.textContent = files[i].name;
      size = doc.createElement('span');
      size.className = 'file__size';
      size.textContent = fmtSize(files[i].size);
      run = doc.createElement('button');
      run.type = 'button';
      run.className = 'file__run';
      run.setAttribute('data-run', '');
      run.textContent = 'run';
      run.setAttribute('aria-label', 'run ' + files[i].name);
      li.appendChild(name);
      li.appendChild(size);
      li.appendChild(run);
      if (files[i].name === S.selectedFile) li.classList.add('is-sel');
      ul.appendChild(li);
    }
    if (!files.length) {
      li = doc.createElement('li');
      li.className = 'files__empty';
      li.textContent = 'no disk image attached';
      ul.appendChild(li);
    }
  }

  function attachImage(bytes, label) {
    var api = ns();
    var u8 = asBytes(bytes);
    if (!u8) { log('disk: ' + label + ' is not a byte array', 'error'); return false; }
    if (api.Disk) {
      try {
        api.Disk.list(u8);
      } catch (err) {
        log('disk: ' + label + ' does not look like a HYFS image — ' + errText(err), 'error');
        return false;
      }
    }
    S.diskImage = u8;
    if (S.machine) {
      try { S.machine.loadDiskImage(u8); } catch (err) { log('disk: attach failed — ' + errText(err), 'error'); }
    }
    refreshFiles();
    log('disk: ' + label + ' attached (' + u8.length + ' bytes)', 'ok');
    return true;
  }

  function runFile(name) {
    var api = ns();
    var machine = ensureMachine();
    var upper = String(name).toUpperCase();
    var bytes = S.diskImage && api.Disk ? api.Disk.readFile(S.diskImage, name) : null;
    if (!bytes) {
      log('disk: ' + name + ' cannot be read from the image', 'error');
      return;
    }
    if (/\.ASM$/.test(upper)) {
      setSource(textOf(bytes));
      log('disk: ' + name + ' loaded into the editor', 'ok');
      return;
    }
    if (/\.TXT$/.test(upper) || /\.DOC$/.test(upper)) {
      log('disk: ' + name, 'ok');
      textOf(bytes).split('\n').forEach(function (line) { log('  ' + line, 'dim'); });
      return;
    }
    if (!machine) { coreMissing('run file'); return; }
    if (/\.(SYS|BIN)$/.test(upper)) {
      log('disk: ' + name + ' is a boot image, booting the machine instead', 'dim');
      doBoot();
      return;
    }
    stopRun();
    try {
      if (!S.powered && !powerOn(true)) return;
      loadIntoMachine(S.machine, bytes, 'com16');
    } catch (err) {
      log('disk: ' + name + ' load failed — ' + errText(err), 'error');
      return;
    }
    log('disk: ' + name + ' (' + bytes.length + ' bytes) loaded at 0x100, running', 'ok');
    startRun();
  }

  function deleteSelectedFile(name) {
    var api = ns();
    var target = name || S.selectedFile;
    if (!target) { log('disk: select a file first', 'error'); return; }
    if (!S.diskImage || !api.Disk) { log('disk: no image attached', 'error'); return; }
    if (!api.Disk.deleteFile(S.diskImage, target)) {
      log('disk: ' + target + ' was not deleted', 'error');
      return;
    }
    if (S.selectedFile === target) S.selectedFile = '';
    refreshFiles();
    log('disk: ' + target + ' deleted', 'ok');
  }

  function addCurrentBinary() {
    var api = ns();
    var result = doAssemble(true);
    if (!result.ok) {
      log('add file: assemble failed, nothing written', 'error');
      return;
    }
    if (!ensureDisk(false) || !api.Disk) { log('add file: no HYFS image', 'error'); return; }
    var name = programName();
    if (!api.Disk.writeFile(S.diskImage, name, result.bytes)) {
      log('add file: HYFS refused "' + name + '"', 'error');
      return;
    }
    S.selectedFile = name;
    refreshFiles();
    log('disk: wrote ' + name + ' (' + result.bytes.length + ' bytes)', 'ok');
  }

  /* --------------------------------------------------- download / import -- */

  function download(name, bytes, mime) {
    try {
      var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = doc.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      doc.body.appendChild(a);
      a.click();
      if (a.parentNode) a.parentNode.removeChild(a);
      ROOT.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      log('download: ' + name + ' (' + bytes.length + ' bytes)', 'ok');
      return true;
    } catch (err) {
      log('download failed: ' + errText(err), 'error');
      return false;
    }
  }

  function downloadAsm() {
    var name = String(programBaseName()).replace(/[^A-Za-z0-9_.-]/g, '') || 'program';
    if (!/\.asm$/i.test(name)) name += '.asm';
    download(name, textBytes(getSourceText()), 'text/plain;charset=utf-8');
  }

  function downloadBin() {
    var result = doAssemble(true);
    if (!result.ok) {
      log('download .bin: assemble failed', 'error');
      return;
    }
    var name = String(programBaseName()).replace(/[^A-Za-z0-9_.-]/g, '') || 'program';
    if (!/\.bin$/i.test(name)) name += '.bin';
    download(name, result.bytes, 'application/octet-stream');
  }

  function importBin(bytes, label) {
    S.imported = { bytes: bytes, mode: 'com16' };
    S.assemblePending = false;
    var Ds = ns().Disassembler;
    if (D['asm-status']) {
      D['asm-status'].classList.remove('is-err');
      D['asm-status'].classList.add('is-ok');
      setText(D['asm-status'], bytes.length + ' B · imported binary');
    }
    log('import: ' + label + ' — ' + bytes.length + ' bytes, run it with "Run .COM"', 'ok');
    if (!Ds) return;
    var res;
    try {
      res = Ds.range(bytes, { bits: 16, origin: 0x100, maxInstrs: 12 });
    } catch (err) {
      log('  disassembly failed: ' + errText(err), 'error');
      return;
    }
    var instrs = res && res.instrs ? res.instrs : [];
    for (var i = 0; i < instrs.length; i++) {
      log('  0x' + hex(instrs[i].addr, 4) + '  ' + hexBytes(instrs[i].bytes, 0, 5) +
        '  ' + instrs[i].text, 'dim');
    }
  }

  function onImportFile(input) {
    var file = input && input.files ? input.files[0] : null;
    if (!file) return;
    var label = String(file.name || 'file');
    if (typeof FileReader === 'undefined') {
      log('import: FileReader is not available', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { log('import: cannot read ' + label, 'error'); };
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result);
      try {
        if (/\.img$/i.test(label)) attachImage(bytes, label);
        else if (/\.bin$/i.test(label)) importBin(bytes, label);
        else {
          var text = textOf(bytes);
          setSource(text);
          log('import: ' + label + ' (' + text.split('\n').length + ' lines) into the editor', 'ok');
          doAssemble(true);
        }
      } catch (err) {
        log('import: ' + label + ' — ' + errText(err), 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
  }

  /* ------------------------------------------------------------- projects -- */

  function collectBuiltins() {
    S.builtins = [];
    if (!D.project) return;
    var opts = D.project.options;
    var i;
    for (i = 0; i < opts.length; i++) {
      S.builtins.push({ value: opts[i].value, label: String(opts[i].textContent || opts[i].value) });
    }
  }

  function isBuiltin(name) {
    for (var i = 0; i < S.builtins.length; i++) {
      if (S.builtins[i].value === name) return true;
    }
    return false;
  }

  function refreshProjectSelect(selectName) {
    if (!D.project) return;
    var current = selectName || D.project.value;
    D.project.textContent = '';
    var i, opt;
    for (i = 0; i < S.builtins.length; i++) {
      opt = doc.createElement('option');
      opt.value = S.builtins[i].value;
      opt.textContent = S.builtins[i].label;
      D.project.appendChild(opt);
    }
    var names = projectNames();
    for (i = 0; i < names.length; i++) {
      if (isBuiltin(names[i])) continue;
      opt = doc.createElement('option');
      opt.value = names[i];
      opt.textContent = names[i];
      D.project.appendChild(opt);
    }
    if (current) D.project.value = current;
    if (!D.project.value && D.project.options.length) D.project.selectedIndex = 0;
  }

  function projectSource(name) {
    if (!name) return null;
    var stored = S.projects[name];
    if (stored && stored.source) return stored.source;
    var sample = sampleFor(name);
    return sample ? sample.source : null;
  }

  function loadProject(name) {
    var source = projectSource(name);
    if (!source) {
      log('project: ' + name + ' has no source', 'error');
      return '';
    }
    S.currentProject = String(name);
    setSource(source);
    log('project: loaded ' + name + ' (' + source.split('\n').length + ' lines)', 'ok');
    return source;
  }

  function saveProject(name) {
    var key = String(name == null ? '' : name).trim();
    if (!key) return false;
    var source = getSourceText();
    S.projects[key] = { source: source, mode: inferMode(source), updated: Date.now() };
    if (!saveProjects()) {
      log('project: the store refused the write', 'error');
      return false;
    }
    S.currentProject = key;
    refreshProjectSelect(key);
    log('project: saved "' + key + '" (' + source.length + ' chars)', 'ok');
    return true;
  }

  function readProject(name) {
    var source = projectSource(name);
    return source === null ? null : source;
  }

  function deleteProject(name) {
    var key = String(name == null ? '' : name).trim();
    if (!key) return false;
    if (!hasOwn(S.projects, key)) {
      log('project: "' + key + '" is not a saved project', 'error');
      return false;
    }
    delete S.projects[key];
    if (!saveProjects()) return false;
    if (S.currentProject === key) S.currentProject = '';
    refreshProjectSelect();
    log('project: deleted "' + key + '"', 'ok');
    return true;
  }

  function newProject() {
    var index = 1;
    var name = '';
    while (index < 200) {
      name = 'project-' + index;
      if (!hasOwn(S.projects, name) && !isBuiltin(name)) break;
      index++;
    }
    var answer = null;
    try {
      if (typeof ROOT.prompt === 'function') answer = ROOT.prompt('project name', name);
    } catch (err) {
      answer = null;
    }
    var chosen = String(answer === null || answer === undefined || answer === '' ? name : answer).trim();
    if (!chosen) return;
    S.projects[chosen] = { source: defaultSource(), mode: 'com16', updated: Date.now() };
    saveProjects();
    refreshProjectSelect(chosen);
    setSource(S.projects[chosen].source);
    S.currentProject = chosen;
    log('project: created "' + chosen + '"', 'ok');
  }

  function defaultSource() {
    var Samples = ns().Samples;
    if (Samples && Samples.defaultId) {
      var sample = Samples.get(Samples.defaultId);
      if (sample) return sample.source;
    }
    return getSourceText();
  }

  function refreshSampleSelect() {
    var Samples = ns().Samples;
    if (!D.sample || !Samples) return;
    D.sample.textContent = '';
    var i, opt;
    for (i = 0; i < Samples.list.length; i++) {
      opt = doc.createElement('option');
      opt.value = Samples.list[i].id;
      opt.textContent = Samples.list[i].id + ' — ' + String(Samples.list[i].title || '').replace(/^\S+\s+—\s+/, '');
      D.sample.appendChild(opt);
    }
    if (Samples.defaultId) D.sample.value = Samples.defaultId;
  }

  function loadSample(id) {
    var Samples = ns().Samples;
    if (!Samples) {
      log('sample: I486.Samples is not loaded', 'error');
      return '';
    }
    var sample = Samples.get(id) || Samples.get(Samples.defaultId);
    if (!sample) return '';
    S.currentProject = sample.id;
    setSource(sample.source);
    if (D.sample) D.sample.value = sample.id;
    log('sample: ' + sample.id + ' — ' + (sample.note || sample.title || ''), 'ok');
    doAssemble(true);
    return sample.source;
  }

  /* ------------------------------------------------------------- terminal -- */

  var COMMANDS = ['help', 'boot', 'reset', 'reboot', 'run', 'step', 'over', 'out', 'regs',
    'mem', 'dis', 'asm', 'disk', 'ls', 'dir', 'cat', 'type', 'save', 'load', 'speed',
    'clear', 'cls', 'echo', 'ver', 'time', 'del', 'halt'];

  function termRun(text) {
    var line = String(text == null ? '' : text).trim();
    if (!line) return;
    termEcho(line);
    S.history.push(line);
    if (S.history.length > 80) S.history.shift();
    S.historyAt = -1;
    var parts = line.split(/\s+/);
    var cmd = parts[0].toLowerCase();
    var args = parts.slice(1);
    try {
      execCommand(cmd, args);
    } catch (err) {
      termLine('error: ' + errText(err), 'term__line--out');
    }
  }

  function execCommand(cmd, args) {
    var machine = S.machine;
    if (cmd === 'help') return cmdHelp();
    if (cmd === 'clear' || cmd === 'cls') return cmdClear();
    if (cmd === 'echo') return termLine(args.join(' '));
    if (cmd === 'ver') return cmdVer();
    if (cmd === 'time') return termLine(new Date().toString());
    if (cmd === 'speed') return cmdSpeed(args);
    if (cmd === 'boot') return doBoot();
    if (cmd === 'reset' || cmd === 'reboot') return doReset();
    if (cmd === 'ls' || cmd === 'dir') return cmdLs();
    if (cmd === 'disk') return cmdDisk();
    if (cmd === 'cat' || cmd === 'type') return cmdCat(args);
    if (cmd === 'del') return deleteSelectedFile(args[0] || '');
    if (cmd === 'save') return cmdSave(args);
    if (cmd === 'load') return cmdLoad(args);
    if (cmd === 'asm') return cmdAsm(args);
    if (cmd === 'run') return cmdRun(args);
    if (cmd === 'step') return cmdStep(args);
    if (cmd === 'over') { stepOver(); return termLine('step over done, EIP ' + eipText()); }
    if (cmd === 'out') { stepOut(); return termLine('step out done, EIP ' + eipText()); }
    if (cmd === 'regs') return cmdRegs();
    if (cmd === 'mem') return cmdMem(args);
    if (cmd === 'dis') return cmdDis(args);
    if (cmd === 'halt') {
      if (!machine) return termLine('halt: core not loaded');
      pauseRun('halt — the CPU is stopped at ' + eipText() + ' (RUN or step to continue)');
      termLine('halt: CPU stopped at ' + eipText() + ' — press RUN to resume');
      return;
    }
    termLine('unknown command: ' + cmd + ' — try help');
  }

  function eipText() {
    var machine = S.machine;
    if (!machine) return '0x0000';
    return '0x' + hex(machine.cpu.cs.sel, 4) + ':0x' + hex(machine.cpu.eip, 4);
  }

  function cmdHelp() {
    termLine('hy486@ide — the IDE shell. Every button has a command:');
    termLine('  help                  this screen');
    termLine('  boot | reset          BIOS POST from the disk | hardware reset');
    termLine('  run [n]               free-run, or run n instructions and stop');
    termLine('  step [n] | over | out  one instruction, step over a call, step out');
    termLine('  regs                  the register file');
    termLine('  mem <addr> [len]      physical memory dump');
    termLine('  dis [addr] [n]        disassemble at an address (default CS:EIP)');
    termLine('  asm [file]            assemble the editor (or a disk file)');
    termLine('  disk                  HYFS geometry and free space');
    termLine('  ls | dir              files on hyfs.img');
    termLine('  cat <file> | type     print a text file');
    termLine('  save <name>           store the project in localStorage');
    termLine('  load <name>           load a project into the editor');
    termLine('  speed <n>             instructions per animation frame');
    termLine('  cls | clear           clear this log');
    termLine('  echo <text>           print the text');
  }

  function cmdClear() {
    if (!D.term) return;
    D.term.textContent = '';
    S.termLines = 0;
    termLine('hy486@ide — log cleared');
  }

  function cmdVer() {
    var api = ns();
    var missing = [];
    if (!api.Machine) missing.push('machine');
    if (!api.BIOS) missing.push('bios');
    if (!api.Disk) missing.push('disk');
    termLine('HY486 IDE 1.0 · i486DX 33 MHz · ' + RAM_MB + ' MB RAM · HYFS ' +
      Math.round(DISK_SECTORS * 512 / 1048576) + ' MB · ' + (missing.length ? 'missing: ' + missing.join(' ') : 'core complete'));
    if (S.machine) {
      var st = S.machine.state();
      termLine('mode ' + st.mode + ' · EIP 0x' + hex(st.eip, 4) + ' · cycles ' + group(st.cycles) +
        ' · halted ' + (st.halted ? 'yes' : 'no'));
    }
  }

  function cmdSpeed(args) {
    var n = parseNum(args[0]);
    if (n !== n || !n) {
      termLine('speed is ' + group(S.speed) + ' instructions per frame');
      return;
    }
    S.speed = clamp(n, SPEED_MIN, SPEED_MAX);
    if (D.speed) D.speed.value = String(S.speed);
    termLine('speed = ' + group(S.speed) + ' instructions per frame');
  }

  function cmdLs() {
    var list = diskList();
    if (!list.length) {
      termLine('no files (no image attached)');
      return;
    }
    var i;
    for (i = 0; i < list.length; i++) {
      termLine('  ' + rpad(list[i].name, 13) + rpad(fmtSize(list[i].size), 10));
    }
    termLine(list.length + ' file(s)');
  }

  function rpad(text, width) {
    var s = String(text);
    while (s.length < width) s += ' ';
    return s;
  }

  function cmdDisk() {
    var api = ns();
    if (!S.diskImage) {
      termLine('no image attached — FORMAT HYFS or DISK IMPORT builds one');
      return;
    }
    var info = null;
    if (api.Disk) {
      try { info = api.Disk.superblock(S.diskImage); } catch (err) { info = null; }
    }
    termLine('hyfs.img · ' + S.diskImage.length + ' bytes · ' +
      (info ? info.totalSectors + ' sectors · ' + info.fileCount + ' files · kernel ' + info.bootKernel : 'unreadable'));
    termLine('list: ' + diskList().map(function (f) { return f.name; }).join(' '));
  }

  function cmdCat(args) {
    var api = ns();
    var name = args[0];
    if (!name) { termLine('usage: cat <file>'); return; }
    if (!S.diskImage || !api.Disk) { termLine('no image attached'); return; }
    var bytes = api.Disk.readFile(S.diskImage, name);
    if (!bytes) { termLine('no such file: ' + name); return; }
    textOf(bytes).split('\n').forEach(function (line) { termLine(line); });
  }

  function cmdSave(args) {
    var name = args[0] || (D.project ? D.project.value : '') || S.currentProject;
    if (!name) { termLine('usage: save <name>'); return; }
    termLine(saveProject(name) ? 'saved ' + name : 'save failed');
  }

  function cmdLoad(args) {
    var name = args[0];
    if (!name) {
      termLine('projects: ' + (projectNames().join(' ') || '(none)'));
      return;
    }
    var source = loadProject(name);
    termLine(source ? 'loaded ' + name : 'no such project: ' + name);
  }

  function cmdAsm(args) {
    var api = ns();
    if (args[0] && S.diskImage && api.Disk) {
      var bytes = api.Disk.readFile(S.diskImage, args[0]);
      if (!bytes) { termLine('no such file: ' + args[0]); return; }
      setSource(textOf(bytes));
    }
    var result = doAssemble(false);
    termLine(result.ok
      ? 'assembled ' + result.bytes.length + ' bytes at org 0x' + hex(S.asmOrigin, 4)
      : result.errors.length + ' error(s) — see the console panel');
  }

  function cmdRun(args) {
    var machine = ensureMachine();
    if (!machine) { termLine('run: core not loaded'); return; }
    if (!args[0]) {
      startRun();
      termLine('running at ' + group(S.speed) + ' instructions per frame');
      return;
    }
    var n = parseNum(args[0]);
    if (n !== n || !n) { termLine('usage: run [n]'); return; }
    var budget = clamp(n, 1, 20000000);
    stopRun();
    if (!S.powered) powerOn(true);
    if (!S.program) {
      var result = doAssemble(true);
      if (result.ok) {
        try { loadIntoMachine(S.machine, result.bytes, S.asmMode === 'flat32' ? 'flat32' : 'com16'); } catch (err) { termLine('load failed: ' + errText(err)); return; }
      }
    }
    var done = burst(budget);
    syncPanels(true);
    termLine('ran ' + group(done) + ' instructions, EIP ' + eipText());
  }

  function cmdStep(args) {
    var m = ensureMachine();
    if (!m) { termLine('step: core not loaded'); return; }
    var n = args[0] ? parseNum(args[0]) : 1;
    if (n !== n || !n) n = 1;
    stepIn(clamp(n, 1, 100000));
    termLine('stepped, EIP ' + eipText() + ' · cycles ' + group(m.cpu.cycles >>> 0));
  }

  function cmdRegs() {
    var machine = S.machine;
    if (!machine) { termLine('regs: core not loaded'); return; }
    var cpu = machine.cpu;
    var names = ['eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp', 'eip', 'eflags'];
    var line = '', i, name;
    for (i = 0; i < names.length; i++) {
      name = names[i];
      line = name + '=0x' + hex(cpu.getReg(name) >>> 0, 8);
      termLine('  ' + rpad(line, 16));
    }
    termLine('  cs=0x' + hex(cpu.cs.sel, 4) + ' ds=0x' + hex(cpu.getReg('ds'), 4) +
      ' es=0x' + hex(cpu.getReg('es'), 4) + ' ss=0x' + hex(cpu.getReg('ss'), 4));
    termLine('  cr0=0x' + hex(cpu.cr0 >>> 0, 8) + ' cr2=0x' + hex(cpu.getCR(2) >>> 0, 8) +
      ' cr3=0x' + hex(cpu.getCR(3) >>> 0, 8));
    var flags = [];
    for (i = 0; i < FLAG_NAMES.length; i++) {
      try {
        if (cpu.getFlag(FLAG_NAMES[i])) flags.push(FLAG_NAMES[i].toUpperCase());
      } catch (err) { /* flag not modelled */ }
    }
    termLine('  flags: ' + flags.join(' '));
  }

  function cmdMem(args) {
    var machine = S.machine;
    if (!machine) { termLine('mem: core not loaded'); return; }
    var base = args[0] ? parseAddr(args[0], 0) : memoryBase(machine);
    if (!args[0] && memFollowReg() !== 'none') {
      termLine('follow: ' + memFollowReg() + ' · base 0x' + hex(base >>> 0, 8));
    }
    var len = args[1] ? clamp(parseNum(args[1]) | 0, 1, 4096) : 64;
    var off, raw, txt, asc, j, i;
    for (off = 0; off < len; off += 16) {
      raw = readPhys((base + off) >>> 0, 16);
      txt = [];
      asc = '';
      for (j = 0; j < 16; j++) {
        txt.push(hex(raw[j], 2));
        asc += raw[j] >= 32 && raw[j] < 127 ? String.fromCharCode(raw[j]) : '.';
      }
      termLine(hex((base + off) >>> 0, 8) + '  ' + txt.join(' ') + '  |' + asc + '|');
    }
  }

  function cmdDis(args) {
    var Ds = ns().Disassembler;
    var machine = S.machine;
    if (!Ds) { termLine('dis: I486.Disassembler is not loaded'); return; }
    var at = args[0] ? parseAddr(args[0], 0) : (machine ? (machine.cpu.eip >>> 0) : (S.asmOrigin >>> 0));
    var count = args[1] ? clamp(parseNum(args[1]) | 0, 1, 256) : 12;
    var bits = machine ? cpuBits() : ((S.asmOpts && S.asmOpts.bits) || 16);
    var bytes;
    var res;
    if (machine && S.powered) bytes = readPhys((((machine.cpu.cs.base >>> 0) + at) >>> 0), 256);
    else if (S.asm && S.asm.ok) bytes = S.asm.bytes;
    else { termLine('dis: nothing loaded'); return; }
    try {
      res = Ds.range(bytes, { bits: bits, origin: at >>> 0, maxInstrs: count });
    } catch (err) {
      termLine('dis: ' + errText(err));
      return;
    }
    var instrs = res && res.instrs ? res.instrs : [];
    for (var i = 0; i < instrs.length; i++) {
      termLine(hex(instrs[i].addr, 4) + '  ' + rpad(hexBytes(instrs[i].bytes, 0, 6), 20) + instrs[i].text);
    }
  }

  function tabComplete(value) {
    var text = String(value || '');
    var parts = text.split(/\s+/);
    var head = parts[0] || '';
    var last = text.slice(text.lastIndexOf(' ') + 1);
    var i, out = [];
    if (parts.length === 1) {
      for (i = 0; i < COMMANDS.length; i++) {
        if (COMMANDS[i].indexOf(head.toLowerCase()) === 0) out.push(COMMANDS[i]);
      }
      return out;
    }
    var files = diskList();
    for (i = 0; i < files.length; i++) {
      if (files[i].name.toLowerCase().indexOf(last.toLowerCase()) === 0) out.push(files[i].name);
    }
    var names = projectNames();
    for (i = 0; i < names.length; i++) {
      if (names[i].toLowerCase().indexOf(last.toLowerCase()) === 0) out.push(names[i]);
    }
    return out;
  }

  function bindTerminal() {
    var input = byId('term-input');
    if (input) {
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          var value = input.value;
          input.value = '';
          termRun(value);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (!S.history.length) return;
          if (S.historyAt < 0) S.historyAt = S.history.length;
          S.historyAt = Math.max(0, S.historyAt - 1);
          input.value = S.history[S.historyAt] || '';
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (S.historyAt < 0) return;
          S.historyAt = Math.min(S.history.length, S.historyAt + 1);
          input.value = S.historyAt >= S.history.length ? '' : (S.history[S.historyAt] || '');
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          var matches = tabComplete(input.value);
          if (!matches.length) return;
          var prefix = input.value.slice(0, input.value.lastIndexOf(' ') + 1);
          if (matches.length === 1) {
            input.value = prefix + matches[0] + (/^(cat|type|del|asm|load|run)$/.test(prefix.trim()) ? ' ' : '');
          } else {
            termLine(matches.join('  '));
          }
        }
      });
      input.addEventListener('focus', function () {
        if (D.term) D.term.scrollTop = D.term.scrollHeight;
      });
    }
    if (byId('term-suggest')) {
      byId('term-suggest').addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('[data-cmd]') : null;
        if (!button) return;
        var cmd = button.getAttribute('data-cmd');
        if (!cmd) return;
        termRun(cmd);
      });
    }
  }

  /* ------------------------------------------------------ I486App + wiring -- */

  function numArray(bytes) {
    var out = [], i;
    if (!bytes) return out;
    for (i = 0; i < bytes.length; i++) out.push(bytes[i] & 0xFF);
    return out;
  }

  function buildApp() {
    var api = {
      ready: false,
      version: '1.0',
      machine: null,
      assemble: function () {
        try {
          var result = doAssemble(true);
          var errors = [];
          var list = result && result.errors ? result.errors : [];
          for (var i = 0; i < list.length; i++) {
            errors.push({ line: list[i].line | 0, message: String(list[i].message == null ? '' : list[i].message) });
          }
          return { ok: result && result.ok === true, bytes: numArray(result ? result.bytes : null), errors: errors };
        } catch (err) {
          return { ok: false, bytes: [], errors: [{ line: 0, message: errText(err) }] };
        }
      },
      loadSample: function (name) {
        try { return loadSample(name); } catch (err) { return ''; }
      },
      runGuest: function (steps) {
        try {
          var result = runInGuest(steps);
          return {
            ok: result && result.ok === true,
            steps: result && result.steps ? result.steps | 0 : 0,
            path: result && result.path ? String(result.path) : 'none'
          };
        } catch (err) {
          log('runGuest: ' + errText(err), 'error');
          return { ok: false, steps: 0, path: 'none' };
        }
      },
      step: function (n) {
        var count = 0;
        try {
          var machine = ensureMachine();
          if (!machine) return { eip: 0, cs: 0, steps: 0 };
          var want = n === undefined ? 1 : clamp(n | 0, 1, 2000000);
          if (!S.powered) powerOn(true);
          count = doStep(want);
          syncPanels(true);
          return { eip: machine.cpu.eip >>> 0, cs: machine.cpu.cs.sel & 0xFFFF, steps: count };
        } catch (err) {
          return { eip: 0, cs: 0, steps: count };
        }
      },
      screenText: function () {
        try { return screenText(); } catch (err) { return []; }
      },
      consoleText: function () {
        try { return D.console ? String(D.console.textContent) : ''; } catch (err) { return ''; }
      },
      setSource: function (text) {
        try { setSource(text); } catch (err) { /* never throws */ }
      },
      getSource: function () {
        try { return getSourceText(); } catch (err) { return ''; }
      },
      projects: function () {
        try { return projectNames(); } catch (err) { return []; }
      },
      saveProject: function (name) {
        try { return saveProject(name) === true; } catch (err) { return false; }
      },
      readProject: function (name) {
        try { return readProject(name); } catch (err) { return null; }
      },
      deleteProject: function (name) {
        try { return deleteProject(name) === true; } catch (err) { return false; }
      },
      files: function () {
        try {
          if (!S.diskImage) ensureDisk(false);
          var list = diskList();
          var out = [];
          for (var i = 0; i < list.length; i++) out.push({ name: String(list[i].name), size: list[i].size | 0 });
          return out;
        } catch (err) {
          return [];
        }
      },
      addFile: function (name, bytes) {
        try {
          var Disk = ns().Disk;
          var u8 = asBytes(bytes);
          if (!Disk || !u8) return false;
          if (!ensureDisk(false) || !S.diskImage) return false;
          var ok = Disk.writeFile(S.diskImage, name, u8);
          refreshFiles();
          return ok === true;
        } catch (err) {
          return false;
        }
      },
      state: function () {
        try {
          var machine = S.machine;
          if (!machine) return { mode: 'none', eip: 0, halted: false, cycles: 0, status: S.status };
          var st = machine.state();
          return {
            mode: String(st.mode),
            eip: st.eip >>> 0,
            halted: st.halted === true,
            cycles: st.cycles >>> 0,
            status: String(S.status),
            stopped: st.stopped === true || S.stopped === true,
            cr0: machine.cpu.cr0 >>> 0,
            cr3: machine.cpu.getCR(3) >>> 0
          };
        } catch (err) {
          return { mode: 'unknown', eip: 0, halted: false, cycles: 0, status: String(S.status) };
        }
      },
      setTab: function (name) {
        try { return setTab(name, true); } catch (err) { return S.tab; }
      },
      tab: function () {
        return S.tab === 'disasm' ? 'disasm' : 'editor';
      },
      disasmAt: function (addr, rows) {
        try { return disasmAt(parseAddr(addr, 0), rows); } catch (err) { return []; }
      },
      follow: function () {
        try {
          return {
            disasm: S.disFollow === true,
            memory: memFollowReg() !== 'none',
            stack: S.stackFollow === true
          };
        } catch (err) {
          return { disasm: false, memory: false, stack: false };
        }
      },
      setFollow: function (panel, on) {
        var want = on === true || on === 1 || on === 'on';
        try {
          if (panel === 'disasm') disSetFollow(want);
          else if (panel === 'stack') stackSetFollow(want);
          else if (panel === 'memory') {
            if (want) memFollowRestore();
            else { memSetFollow('none'); if (S.machine) updateMem(S.machine); }
          }
        } catch (err) { /* the hook never throws */ }
        return api.follow();
      }
    };
    app = api;
    ROOT.I486App = api;
    return api;
  }

  function editorHooks() {
    return {
      onChange: function () { /* the editor keeps its own state */ },
      onCursor: function () { /* gutter only */ },
      onAssemble: function () { doAssemble(false); },
      onBreakpoint: function (lines) {
        S.bpLines = lines && lines.length ? lines.slice() : [];
        refreshBps();
        log('breakpoints: ' + (S.bpLines.length ? S.bpLines.join(', ') : 'none') +
          ' (line) · ' + S.bpCount + ' armed', 'dim');
      }
    };
  }

  function mountEditor() {
    var host = byId('editor-host');
    var E = ns().Editor;
    if (!host || !E || typeof E.create !== 'function') {
      if (D.source) S.editor = null;
      return;
    }
    try {
      S.editor = E.create(host, editorHooks());
    } catch (err) {
      log('editor: mount failed — ' + errText(err), 'error');
      S.editor = host.__i486EditorInstance || null;
    }
  }

  function prepareCanvas() {
    var canvas = byId('screen');
    if (!canvas) return;
    try {
      var ctx = canvas.getContext('2d');
      if (ctx) ctx.imageSmoothingEnabled = false;
    } catch (err) { /* no 2d context: the canvas stays blank */ }
    if (canvas.width !== SCREEN_W) canvas.width = SCREEN_W;
    if (canvas.height !== SCREEN_H) canvas.height = SCREEN_H;
    clearCanvas();
  }

  function wireToolbar() {
    on('power', function () { if (S.powered) powerOff(); else powerOn(false); });
    on('reset', doReset);
    on('boot', doBoot);
    on('run', startRun);
    on('pause', function () { pauseRun(); });
    on('step', function () { stepIn(1); });
    on('over', stepOver);
    on('out', stepOut);
    on('clear-bp', clearBreakpoints);
    if (byId('speed')) {
      var readSpeed = function () {
        var value = parseInt(D.speed.value, 10);
        S.speed = isFinite(value) && value > 0 ? clamp(value, SPEED_MIN, SPEED_MAX) : SPEED_DEFAULT;
        if (String(S.speed) !== D.speed.value) D.speed.value = String(S.speed);
      };
      D.speed.addEventListener('change', readSpeed);
      D.speed.addEventListener('input', readSpeed);
      readSpeed();
    } else {
      S.speed = SPEED_DEFAULT;
    }
  }

  function on(name, fn) {
    var el = byId(name);
    if (!el) return;
    el.addEventListener('click', function (event) {
      try {
        fn(event);
      } catch (err) {
        log(name + ': ' + errText(err), 'error');
      }
    });
  }

  function wireEditorPanel() {
    on('assemble', function () { doAssemble(false); });
    on('run-guest', function () { runInGuest(); });
    on('run-com', runCom);
    on('run-flat32', runFlat32);
  }

  function wireScreenPanel() {
    on('screen-clear', clearScreen);
  }

  function wirePanels() {
    if (D.regs) {
      D.regs.addEventListener('click', function (event) {
        var val = event.target && event.target.closest ? event.target.closest('.reg__val') : null;
        if (!val) return;
        var row = val.closest('.reg');
        if (!row) return;
        var name = row.getAttribute('data-reg');
        var width = parseInt(row.getAttribute('data-width'), 10) || 32;
        var item = null;
        var list = regNodeList();
        var i;
        for (i = 0; i < list.length; i++) {
          if (list[i].name === name) { item = list[i]; break; }
        }
        if (item) beginRegEdit(item);
        else log('register ' + name + ' (' + width + ')', 'dim');
      });
    }
    if (D.flags) {
      D.flags.addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('.flag') : null;
        if (!button) return;
        var name = button.getAttribute('data-flag');
        if (!name) return;
        toggleFlag(name, button);
      });
    }
    if (D.stack) {
      D.stack.addEventListener('dblclick', function (event) {
        var li = event.target && event.target.closest ? event.target.closest('li') : null;
        if (!li || !li.getAttribute) return;
        var raw = li.getAttribute('data-addr');
        if (!raw) return;
        var addr = parseAddr(raw, 0);
        memGoto(addr);
        log('stack: memory window sent to 0x' + hex(addr, 8), 'dim');
        syncPanels(false);
      });
    }
    if (D.state) {
      D.state.addEventListener('click', function (event) {
        var dd = event.target && event.target.closest ? event.target.closest('dd[data-edit]') : null;
        if (!dd || (D.state.contains && !D.state.contains(dd))) return;
        var key = dd.getAttribute('data-state-key');
        if (!key) return;
        beginStateEdit(key, dd);
      });
    }
    if (D['mem-base']) {
      D['mem-base'].addEventListener('change', function () {
        memGoto(parseAddr(D['mem-base'].value, 0));
        syncPanels(false);
      });
      D['mem-base'].addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        memGoto(parseAddr(D['mem-base'].value, 0));
        syncPanels(false);
      });
    }
    if (D['mem-follow']) {
      D['mem-follow'].addEventListener('change', function () {
        memSetFollow(memFollowReg());
        syncPanels(false);
      });
    }
    if (D.disasm) {
      D.disasm.addEventListener('click', function (event) {
        var li = event.target && event.target.closest ? event.target.closest('li') : null;
        if (!li || !li.getAttribute) return;
        var raw = li.getAttribute('data-addr');
        if (!raw) return;
        toggleRowBp(parseAddr(raw, 0));
      });
    }
  }

  function wireFiles() {
    if (D.files) {
      D.files.addEventListener('click', function (event) {
        var target = event.target;
        var li = target && target.closest ? target.closest('li') : null;
        if (!li) return;
        var name = li.getAttribute('data-name');
        if (target.closest('[data-run]')) {
          if (name) runFile(name);
          return;
        }
        if (!name) return;
        S.selectedFile = S.selectedFile === name ? '' : name;
        refreshFiles();
      });
    }
    on('file-add', addCurrentBinary);
    on('file-del', function () { deleteSelectedFile(''); });
  }

  function wireProjects() {
    if (D.project) {
      D.project.addEventListener('change', function () {
        loadProject(D.project.value);
        S.currentProject = D.project.value;
      });
    }
    on('project-new', newProject);
    on('project-save', function () { saveProject(D.project ? D.project.value : S.currentProject); });
    on('project-del', function () { deleteProject(D.project ? D.project.value : S.currentProject); });
    on('sample-load', function () {
      var id = D.sample ? D.sample.value : '';
      loadSample(id);
    });
  }

  function wireAssets() {
    on('import', function () { if (byId('import-file')) byId('import-file').click(); });
    on('download-asm', downloadAsm);
    on('download-bin', downloadBin);
    on('disk-import', function () { if (byId('disk-file')) byId('disk-file').click(); });
    on('disk-download', function () {
      if (!S.diskImage) { log('disk: no image to save', 'error'); return; }
      download('hyfs.img', S.diskImage, 'application/octet-stream');
    });
    on('disk-format', function () {
      log('disk: rebuilding hyfs.img with the built-in files', 'dim');
      ensureDisk(true);
      log('disk: formatted, ' + diskList().length + ' files', 'ok');
    });
    if (byId('import-file')) {
      byId('import-file').addEventListener('change', function () { onImportFile(byId('import-file')); });
    }
    if (byId('disk-file')) {
      byId('disk-file').addEventListener('change', function () {
        var input = byId('disk-file');
        var file = input.files ? input.files[0] : null;
        if (!file || typeof FileReader === 'undefined') return;
        var reader = new FileReader();
        reader.onerror = function () { log('disk: cannot read ' + file.name, 'error'); };
        reader.onload = function () { attachImage(new Uint8Array(reader.result), String(file.name || 'image')); };
        reader.readAsArrayBuffer(file);
        input.value = '';
      });
    }
  }

  /* ------------------------------------------------------------ the studio --
     Revision 2: one panel, two tabs. The choice is remembered in localStorage
     and every panel can be re-pinned with Ctrl+Home or the toolbar toggle. */

  function setTab(name, quiet) {
    var tab = name === 'disasm' ? 'disasm' : 'editor';
    var edOn = tab === 'editor';
    S.tab = tab;
    if (D['tab-editor']) {
      D['tab-editor'].classList.toggle('is-on', edOn);
      D['tab-editor'].setAttribute('aria-selected', edOn ? 'true' : 'false');
      D['tab-editor'].setAttribute('tabindex', edOn ? '0' : '-1');
      if (edOn) D['tab-editor'].classList.remove('has-dot');
    }
    if (D['tab-disasm']) {
      D['tab-disasm'].classList.toggle('is-on', !edOn);
      D['tab-disasm'].setAttribute('aria-selected', edOn ? 'false' : 'true');
      D['tab-disasm'].setAttribute('tabindex', edOn ? '-1' : '0');
      if (!edOn) D['tab-disasm'].classList.remove('has-dot');
    }
    if (D['pane-editor']) D['pane-editor'].hidden = !edOn;
    if (D['pane-disasm']) D['pane-disasm'].hidden = edOn;
    try { store().setItem(TAB_KEY, tab); } catch (err) { /* private mode */ }
    if (!edOn) disRefresh();
    else if (!quiet && S.editor && typeof S.editor.focus === 'function') S.editor.focus();
    if (!quiet) log('panel: ' + tab, 'dim');
    return tab;
  }

  /* A dot on the other tab says "look here" without stealing the focus. */
  function tabDot(name) {
    if (S.tab === name) return;
    var el = byId('tab-' + name);
    if (el) el.classList.add('has-dot');
  }

  function scrollerFor(node) {
    if (!node || !node.closest) return null;
    return node.closest('.ds-view, .mem-view, .stack-view');
  }

  function followPanelFor(node) {
    if (!node || !node.closest) return null;
    if (node.closest('[data-i486="pane-disasm"]')) return 'disasm';
    if (node.closest('.wb-panel--stack')) return 'stack';
    if (node.closest('.wb-panel--mem')) return 'memory';
    return null;
  }

  function setFollowAll(on) {
    disSetFollow(on === true);
    stackSetFollow(on === true);
    memSetFollow(on === true ? (S.memReg || 'esp') : 'none');
    if (S.machine) { updateMem(S.machine); updateStack(S.machine); }
    return on === true;
  }

  function applyStoredTab() {
    var tab = 'editor';
    try { if (store().getItem(TAB_KEY) === 'disasm') tab = 'disasm'; } catch (err) { tab = 'editor'; }
    setTab(tab, true);
  }

  function applyStoredMemFollow() {
    var reg = 'esp';
    try {
      var saved = String(store().getItem(MEM_FOLLOW_KEY) || '');
      if (memFollowValid(saved)) reg = saved;
    } catch (err) { reg = 'esp'; }
    if (D['mem-follow']) D['mem-follow'].value = reg;
    S.memReg = reg === 'none' ? 'esp' : reg;
    S.memFollowAddr = -1;
    memFollowPin();
    stackPin();
    log('memory: follow ' + reg + ' (base = value & ~0xF)', 'dim');
  }

  function wireStudio() {
    var tabs = [[D['tab-editor'], 'editor'], [D['tab-disasm'], 'disasm']];
    var i;
    for (i = 0; i < tabs.length; i++) {
      (function (button, name) {
        if (!button) return;
        button.addEventListener('click', function () { setTab(name); });
        button.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
          event.preventDefault();
          setTab(name);
          if (button.focus) button.focus();
        });
      })(tabs[i][0], tabs[i][1]);
    }
    if (D['dis-follow']) {
      D['dis-follow'].addEventListener('click', function () {
        if (S.tab !== 'disasm') setTab('disasm');
        disSetFollow(!S.disFollow);
      });
    }
    if (D['dis-eip']) {
      D['dis-eip'].addEventListener('click', function () {
        var at = disDefaultAddr();
        if (S.tab !== 'disasm') setTab('disasm');
        if (S.disFollow) disSetFollow(false, true);
        disJump(at);
        log('disassembly: CS:EIP at 0x' + hex(at, 8), 'dim');
      });
      D['dis-eip'].addEventListener('dblclick', function () {
        if (S.tab !== 'disasm') setTab('disasm');
        disSetFollow(true);
      });
    }
    if (D.eip) {
      D.eip.addEventListener('dblclick', function () {
        if (S.tab !== 'disasm') setTab('disasm');
        disSetFollow(true);
        log('disassembly: following CS:EIP again', 'dim');
      });
    }
    if (D['dis-goto']) {
      D['dis-goto'].addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (S.tab !== 'disasm') setTab('disasm');
        disGoto(D['dis-goto'].value);
      });
    }
  }

  function wireShortcuts() {
    doc.addEventListener('keydown', function (event) {
      var key = event.key;
      var target = event.target;
      var sc, panel, h;
      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        if (key === '1') { event.preventDefault(); setTab('editor'); return; }
        if (key === '2') { event.preventDefault(); setTab('disasm'); return; }
        if (key === 'g' || key === 'G') {
          event.preventDefault();
          if (S.tab !== 'disasm') setTab('disasm');
          if (D['dis-goto'] && D['dis-goto'].focus) D['dis-goto'].focus();
          return;
        }
        if (key === 'Home') {
          if (isFormField(target) && !(S.editor && S.editor.textarea === target)) return;
          event.preventDefault();
          panel = followPanelFor(target);
          if (panel === 'memory') { memFollowRestore(); return; }
          if (panel === 'stack') { stackSetFollow(true); return; }
          if (panel === 'disasm') { disSetFollow(true); return; }
          setFollowAll(true);
          return;
        }
      }
      if (isFormField(target)) return;
      sc = scrollerFor(target);
      if (sc && (key === 'PageDown' || key === 'PageUp' || key === 'Home' || key === 'End')) {
        event.preventDefault();
        if (S.disV && sc === S.disV.ol) disUserGesture();
        h = sc.clientHeight || 160;
        if (key === 'PageDown') sc.scrollTop = (sc.scrollTop || 0) + h * 0.9;
        else if (key === 'PageUp') sc.scrollTop = (sc.scrollTop || 0) - h * 0.9;
        else if (key === 'Home') sc.scrollTop = 0;
        else sc.scrollTop = sc.scrollHeight;
        return;
      }
      if (key === 'F9') { event.preventDefault(); startRun(); return; }
      if (key === 'F10') { event.preventDefault(); pauseRun(); return; }
      if (key === 'F7') { event.preventDefault(); stepIn(1); return; }
      if (key === 'F8') { event.preventDefault(); if (event.ctrlKey) stepOut(); else stepOver(); return; }
      if (key === 'F6') { event.preventDefault(); doBoot(); }
    }, false);
  }

  function bootMessage() {
    if (D.console) D.console.textContent = '';
    S.consoleNodes = 0;
    if (D.term) {
      D.term.textContent = '';
      S.termLines = 0;
    }
    if (D['screen-mode']) setText(D['screen-mode'], 'no signal');
    if (D['screen-cursor']) setText(D['screen-cursor'], '—');
    var ps1 = doc.querySelector('.term__prompt-line .term__ps1');
    if (ps1) ps1.textContent = TERM_PS1;
    var api = ns();
    var names = ['CPU', 'Bus', 'Devices', 'Assembler', 'Disassembler', 'Disk', 'Guest',
      'BIOS', 'Machine', 'Highlight', 'Editor', 'Samples'];
    var have = [], miss = [], i;
    for (i = 0; i < names.length; i++) {
      if (api[names[i]]) have.push(names[i]);
      else miss.push(names[i]);
    }
    log('hy486 IDE 1.0 · i486DX workbench', 'ok');
    log('modules: ' + (have.length ? have.join(' ') : '(none)'), have.length ? 'dim' : 'error');
    if (miss.length) log('missing: ' + miss.join(' ') + ' — core not loaded, the editor still assembles', 'error');
    if (!ensureMachine()) {
      log('core not loaded: ' + (S.coreError || 'I486.Machine is missing') +
        ' — assemble, disassemble, projects and files still work', 'error');
    } else {
      log('machine: 32 MB RAM, BIOS ROM ' + (S.machine.rom && S.machine.rom.bytes ? S.machine.rom.bytes.length : 0) +
        ' bytes, ATA ' + (S.machine.ata ? S.machine.ata.sectors : 0) + ' sectors', 'ok');
    }
    log('keyboard: ' + countKeys(SCAN) + ' set-1 scancodes mapped (0xE0 extended keys included)', 'dim');
    var Samples = api.Samples;
    log('samples: ' + (Samples ? Samples.list.length + ' programs' : 'none') +
      ' · breakpoints: gutter or disassembly row', 'dim');
  }

  function countKeys(obj) {
    var n = 0, key;
    for (key in obj) {
      if (hasOwn(obj, key)) n++;
    }
    return n;
  }

  function initialSource() {
    var selected = D.project ? D.project.value : '';
    var stored = selected && S.projects[selected] ? S.projects[selected].source : '';
    if (stored) {
      setSource(stored);
      S.currentProject = selected;
      log('editor: restored project "' + selected + '"', 'ok');
      return;
    }
    var current = getSourceText();
    var A = ns().Assembler;
    var probe = null;
    if (A && current) {
      try { probe = A.assemble(current, asmOptions(inferMode(current))); } catch (err) { probe = null; }
    }
    if (probe && probe.ok) {
      log('editor: the built-in buffer assembles as-is (' + probe.bytes.length + ' bytes)', 'dim');
      return;
    }
    var why = probe && probe.errors && probe.errors.length
      ? 'line ' + probe.errors[0].line + ': ' + String(probe.errors[0].message)
      : 'no assembler loaded';
    var fallback = defaultSource();
    if (!fallback || fallback === current) return;
    setSource(fallback);
    log('editor: the built-in placeholder does not assemble (' + why + ') - replaced with the default sample', 'error');
  }

  function init() {
    if (typeof document === 'undefined') return;
    if (S.inited) return;
    S.inited = true;
    doc = document;
    try {
      collectNodes();
      buildApp();
      loadProjects();
      collectBuiltins();
      mountEditor();
      buildRegRows();
      stateEditInit();
      prepareCanvas();
      refreshSampleSelect();
      refreshProjectSelect();
      wireToolbar();
      wireStudio();
      wireEditorPanel();
      wireScreenPanel();
      wirePanels();
      memEnsure();
      stackEnsure();
      applyStoredMemFollow();
      applyStoredTab();
      disSetFollow(true, true);
      wireFiles();
      wireProjects();
      wireAssets();
      bindTerminal();
      bindKeyboard();
      wireShortcuts();
      bootMessage();
      initialSource();
      setPowerLabel();
      ensureDisk(false);
      termLine('HY486 IDE 1.0 — help · dir · run HELLO.COM · mem 0x118 64');
      doAssemble(true);
      refreshFiles();
      var ready = S.machine !== null;
      app.ready = ready;
      if (ready) {
        document.documentElement.dataset.i486Ready = '1';
        setStatus('READY', 'ready');
      } else {
        setStatus('NO CORE', 'fault');
      }
      syncPanels(false);
    } catch (err) {
      log('startup: ' + errText(err), 'error');
      if (D.console) {
        var extra = doc.createElement('span');
        extra.className = 'error';
        extra.textContent = 'startup failed: ' + errText(err) + '\n';
        D.console.appendChild(extra);
      }
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  return { UI: { init: init, app: function () { return app; } } };
});
