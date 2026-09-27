/**
 * labs-vm.js — Hayneko_Arch32S 虚拟机页面（~/labs/vm）
 *
 * 把 HaynekoArch32VM_python 的 dbg.py 搬到网页上：
 *   - 引擎是 scripts/hayneko-arch32.js（vm.py + as.py 的移植，ISA 从 JSON 读）
 *   - 左侧反汇编窗口（当前指令高亮、单击切断点），右侧寄存器 / 栈 / 内存转储，
 *     底部输出，最上面是工具栏（F7 单步 / F8 跳过调用 / F9 运行）
 *   - 终端里可以建虚拟机、跑单条汇编指令、看寄存器…
 *     所有按钮与命令走同一套实现（command 表），所以两边永远一致
 *
 * 终端命令注册进 scripts/terminal.js（Terminal.register），
 * 因此在别的页面敲 vm 也能建机器；页面只是这台机器的显示器。
 */
(function (global) {
	'use strict';

	var doc = global.document;

	/* 页面找不到 dbg.py 的路径时才用的兜底（正常从 ISA_URL 读） */
	var ISA_URL = 'HaynekoArch32VM_python/hayneko_arch32S-v1.json';
	var ROM_SIZE = 1024;
	var DISK_SIZE = 256 * 1024;
	var MEM_DEFAULT = 4096;
	var MAX_RUN_STEPS = 2000000;      /* 与 dbg.py 的 Runner(max_steps=2_000_000) 一致 */
	var W_BEFORE = 40;                /* 反汇编窗口：当前指令前后各 40 条 */
	var W_AFTER = 40;
	var STACK_ROWS = 26;
	var MEM_ROWS = 16;                /* 每行 16 字节 = 256 字节（页面够宽，一行放得下） */
	var MEM_BYTES = 16;

	var engine = null;                /* global.HaynekoArch32 */
	var isa = null;
	var loadingISA = null;
	var pendingISA = [];

	var machines = [];
	var activeName = null;
	var uploads = [];
	var ui = null;                    /* 当前挂载的页面控制器 */

	function H() {
		if (!engine) engine = global.HaynekoArch32 || null;
		return engine;
	}

	/* ------------------------------------------------------------------ 工具 */

	function pad(text, width) {
		text = String(text);
		while (text.length < width) text += ' ';
		return text;
	}

	function hex(value, width) { return H().hex(value, width || 8); }

	function num(text) {
		if (typeof text === 'number') return text;
		var s = String(text == null ? '' : text).trim();
		if (!s) return NaN;
		var lower = s.toLowerCase();
		var neg = false;
		if (lower.charAt(0) === '-') { neg = true; lower = lower.slice(1); }
		var value;
		if (lower.indexOf('0x') === 0) value = parseInt(lower.slice(2), 16);
		else if (lower.indexOf('0b') === 0) value = parseInt(lower.slice(2), 2);
		else if (lower.indexOf('0o') === 0) value = parseInt(lower.slice(2), 8);
		else value = /^[0-9]+$/.test(lower) ? parseInt(lower, 10) : NaN;
		if (isNaN(value)) return NaN;
		return neg ? -value : value;
	}

	function parseFlags(args) {
		var flags = {};
		var rest = [];
		for (var i = 0; i < args.length; i++) {
			var arg = String(args[i]);
			if (arg.indexOf('--') === 0) {
				var eq = arg.indexOf('=');
				if (eq > 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
				else flags[arg.slice(2)] = true;
			} else {
				rest.push(arg);
			}
		}
		return { flags: flags, rest: rest };
	}

	/** 终端里的一行汇编用 | 分段（as 的分号是注释，所以不能拿分号当分隔符） */
	function normalizeSource(text) {
		return String(text).split('|').join('\n');
	}

	function bytesToHex(bytes) {
		var out = [];
		for (var i = 0; i < bytes.length; i++) out.push((bytes[i] + 0x100).toString(16).slice(1).toUpperCase());
		return out.join(' ');
	}

	/* ------------------------------------------------------------ ISA 加载 */

	function ensureISA() {
		if (isa) return Promise.resolve(isa);
		if (loadingISA) return loadingISA;
		var api = H();
		if (!api) return Promise.reject(new Error('hayneko-arch32.js 没有加载'));
		loadingISA = api.ISA.fetch(api.ISA_URL || ISA_URL).then(function (loaded) {
			isa = loaded;
			var queue = pendingISA.slice();
			pendingISA.length = 0;
			queue.forEach(function (cb) { cb(isa); });
			return isa;
		}).catch(function (err) {
			loadingISA = null;
			throw err;
		});
		return loadingISA;
	}

	/** 命令入口：ISA 就绪后再执行（第一次用 vm 命令时才去 fetch JSON） */
	function withISA(fn, out) {
		if (isa) { fn(isa); return; }
		var line = null;
		if (out) line = out('loading ' + ISA_URL + ' ...', 't-dim');
		ensureISA().then(function (loaded) {
			if (line && line.remove) line.remove();
			fn(loaded);
		}).catch(function (err) {
			if (line && line.remove) line.remove();
			if (out) {
				out('vm: 无法加载 ISA 定义 (' + (err && err.message ? err.message : err) + ')', 't-err');
				out('    通过本地 HTTP 服务器打开本站再试 (file:// 下 fetch 会被拦)', 't-dim');
			}
		});
	}

	/* ------------------------------------------------------------ 虚拟机对象 */

	function Machine(name, options) {
		options = options || {};
		var api = H();
		if (!isa) throw new Error('ISA 还没加载完，无法创建虚拟机');
		var opts = {
			isa: isa,
			memSize: options.memSize || MEM_DEFAULT,
			entry: options.entry || 0,
			sp: options.sp,
			syscallVector: options.syscallVector
		};
		if (options.rom) opts.rom = options.rom;
		if (options.disk) opts.disk = options.disk;
		this.name = name;
		this.memSize = opts.memSize;
		this.vm = new api.VM(opts);
		this.breakpoints = {};
		this.out = [];                  /* 端口输出（字符） */
		this.logs = [];                 /* 页面里的日志行 {text, cls} */
		this.running = false;
		this.romLabel = options.romLabel || '—';
		this.diskLabel = options.diskLabel || '—';
		this.source = options.source || '';
		var self = this;
		this.vm.onOutput = function (text) { self.out.push(text); };
	}

	Machine.prototype.find = function () { return machines; };

	Machine.prototype.log = function (text, cls) {
		this.logs.push({ text: text, cls: cls || 'log' });
		if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
	};

	Machine.prototype.note = function (text) { this.log(text, 'log'); };

	Machine.prototype.bpSet = function () {
		var out = [];
		for (var addr in this.breakpoints) if (this.breakpoints[addr]) out.push(parseInt(addr, 10));
		return out.sort(function (a, b) { return a - b; });
	};

	Machine.prototype.stopReason = function () {
		if (this.vm.halted) return this.vm.lastError ? this.vm.lastError : 'HALT';
		return null;
	};

	/** 执行一条，捕获 HALT / 异常（返回 false 表示停机） */
	Machine.prototype.step = function () {
		try {
			this.vm.step();
		} catch (err) {
			if (err && err.name === 'HaltSignal') {
				this.log('[' + err.message + ']', 'ok');
				return false;
			}
			this.log('[' + (err && err.name ? err.name : 'Error') + '] ' + (err.message || err), 'err');
			this.vm.halted = true;
			return false;
		}
		return !this.vm.halted;
	};

	Machine.prototype.snapshot = function () { return this.vm.snapshot(); };

	function findMachine(name) {
		for (var i = 0; i < machines.length; i++) if (machines[i].name === name) return machines[i];
		return null;
	}

	function activeMachine() {
		if (activeName) {
			var found = findMachine(activeName);
			if (found) return found;
		}
		return machines.length ? machines[0] : null;
	}

	function uniqueName(base) {
		var name = base || 'vm1';
		if (!findMachine(name)) return name;
		var n = 2;
		while (findMachine(name + '-' + n)) n++;
		return name + '-' + n;
	}

	function createMachine(name, options, out) {
		name = uniqueName(name);
		var machine = new Machine(name, options || {});
		machines.push(machine);
		if (!activeName) activeName = name;
		if (out) out('created ' + name + '  mem=' + machine.memSize + 'KB  ip=0x' +
			hex(machine.vm.ip, 8) + '  sp=0x' + hex(machine.vm.spInit, 8), 't-ok');
		return machine;
	}

	function removeMachine(name, out) {
		var index = -1;
		for (var i = 0; i < machines.length; i++) if (machines[i].name === name) index = i;
		if (index < 0) { out('vm: no machine named "' + name + '"', 't-err'); return false; }
		machines[index].running = false;
		machines.splice(index, 1);
		if (activeName === name) activeName = machines.length ? machines[0].name : null;
		out('removed ' + name, 't-ok');
		return true;
	}

	/* --------------------------------------------------------------- 输出行 */

	function uploadByName(name) {
		for (var i = 0; i < uploads.length; i++) if (uploads[i].name === name) return uploads[i];
		return null;
	}

	function padRom(bytes) {
		var rom = new Uint8Array(ROM_SIZE);
		rom.set(bytes.subarray(0, Math.min(bytes.length, ROM_SIZE)));
		return rom;
	}

	function assembleInto(machine, source, out) {
		var api = H();
		var asm = new api.Assembler(isa);
		try {
			source = normalizeSource(source);
			var result = asm.assembleWithLabels(source);
			machine.vm.loadRom(padRom(result.bytes));
			machine.source = source;
			machine.romLabel = 'asm:' + result.size + 'B';
			out('assembled ' + result.size + ' bytes -> ROM (mem ' + machine.memSize + 'KB)', 't-ok');
			var labels = Object.keys(result.labels);
			if (labels.length) {
				var parts = [];
				labels.slice(0, 8).forEach(function (name) {
					parts.push(name + '=0x' + hex(result.labels[name], 4));
				});
				out('  labels: ' + parts.join('  '), 't-dim');
			}
			return result;
		} catch (err) {
			out('asm: ' + (err && err.message ? err.message : err), 't-err');
			return null;
		}
	}

	/* ============================================================ 命令实现 */

	function helpText(machine, out) {
		out('Hayneko_Arch32S virtual machines', 't-info');
		if (!machines.length) out('  (no machine yet — try: vm new vm1 --demo=fib)', 't-dim');
		machines.forEach(function (m) {
			var state = m.running ? 'running' : (m.vm.halted ? 'halted' : 'paused');
			out('  ' + pad(m.name, 12) + 'mem ' + m.memSize + 'KB  ip=0x' + hex(m.vm.ip, 8) +
				'  sp=0x' + hex(m.vm.gpr[7], 8) + '  steps=' + m.vm.instructionCount +
				'  ' + state + '  bp=' + m.bpSet().length + '  rom=' + m.romLabel);
		});
		out('');
		out('usage', 't-dim');
		[
			['vm new <name> [--mem=4096] [--entry=0x0] [--sp=0x100000] [--demo=fib] [--rom=<file>]', 'create a machine'],
			['vm ls | vm rm <name> | vm upload', 'list / remove / choose files'],
			['vm <name> info | reset', 'state snapshot / restart'],
			['vm <name> demo <hello|fib|fib3|intr|mem>', 'load a built-in program'],
			['vm <name> asm "<source>"', 'assemble source (join lines with |)'],
			['vm <name> inst "<assembly>" [--at=0xADDR] [--no-run]', 'patch + run one instruction'],
			['vm <name> step [n] | run [n] | stop', 'execution control'],
			['vm <name> regs [set <reg> <value>]', 'registers / flags'],
			['vm <name> mem [addr] [len] | dis [addr] [n]', 'dump memory / disassemble'],
			['vm <name> bp [addr|clear] | go <addr>', 'breakpoints / set ip'],
			['vm <name> rom <file> | disk <file> | save rom|disk', 'load / save images']
		].forEach(function (row) {
			out('  ' + pad(row[0], 66) + row[1]);
		});
	}

	function cmdInfo(machine, out) {
		var snap = machine.vm.snapshot();
		out('machine ' + machine.name, 't-info');
		out('  mem=' + machine.memSize + 'KB  entry=0x' + hex(machine.vm.entry, 8) +
			'  sp0=0x' + hex(machine.vm.spInit, 8) + '  syscall=0x' + hex(machine.vm.syscallVector, 2));
		out('  ip=0x' + hex(snap.ip, 8) + '  flags=0x' + hex(snap.flags, 8) +
			'  mode=' + snap.mode + '  idt=0x' + hex(snap.idt, 8));
		out('  steps=' + snap.instructionCount + '  halted=' + snap.halted +
			'  quit=' + snap.quitCode + '  rom=' + machine.romLabel + '  disk=' + machine.diskLabel);
		out('  breakpoints: ' + (machine.bpSet().length
			? machine.bpSet().map(function (a) { return '0x' + hex(a, 8); }).join(' ') : 'none'));
	}

	function cmdRegs(machine, rest, out) {
		var vm = machine.vm;
		if (rest[0] === 'set') {
			var index = H().GPR_ID[rest[1]];
			if (index === undefined) { out('regs: unknown register "' + rest[1] + '"', 't-err'); return; }
			var value = num(rest[2]);
			if (isNaN(value)) { out('regs: need a value', 't-err'); return; }
			if (index === 0) { out('regs: x0 is hard-wired to 0', 't-err'); return; }
			vm.writeGpr(index, value);
			out(rest[1] + ' = 0x' + hex(vm.gpr[index], 8), 't-ok');
			return;
		}
		var names = H().GPR_NAMES;
		for (var i = 0; i < 32; i += 4) {
			var row = [];
			for (var k = 0; k < 4; k++) row.push(pad(names[i + k], 3) + '=' + hex(vm.gpr[i + k], 8));
			out('  ' + row.join('  '));
		}
		out('  ip=0x' + hex(vm.ip, 8) + '  flags=0x' + hex(vm.flags, 8) + '  sp=0x' + hex(vm.gpr[7], 8));
		out('  ' + H().FLAG_DISPLAY.map(function (name) {
			return name.toUpperCase() + '=' + vm.getFlag(name);
		}).join(' '), 't-dim');
		out('  cr0=0x' + hex(vm.cr[0], 8) + ' cr1=0x' + hex(vm.cr[1], 8) +
			' cr2=0x' + hex(vm.cr[2], 8) + ' cr3=0x' + hex(vm.cr[3], 8) +
			'  mode=' + vm.mode + '  idt=0x' + hex(vm.kernel.idt, 8), 't-dim');
	}

	function cmdMem(machine, rest, out) {
		var vm = machine.vm;
		var start = rest.length ? num(rest[0]) : 0;
		var length = rest.length > 1 ? num(rest[1]) : 64;
		if (isNaN(start) || start < 0) { out('mem: bad address', 't-err'); return; }
		if (isNaN(length) || length <= 0) length = 64;
		if (length > 4096) length = 4096;
		for (var off = 0; off < length; off += 16) {
			var addr = (start + off) >>> 0;
			if (addr >= vm.memSizeBytes) break;
			var bytes = [];
			var ascii = '';
			for (var i = 0; i < 16 && addr + i < vm.memSizeBytes; i++) {
				var byte = vm.memory[addr + i];
				bytes.push((byte + 0x100).toString(16).slice(1).toUpperCase());
				ascii += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
			}
			out(hex(addr, 8) + '  ' + pad(bytes.join(' '), 47) + '  |' + ascii + '|');
		}
	}

	function cmdDis(machine, rest, out, opts) {
		var vm = machine.vm;
		var start = rest.length ? num(rest[0]) : vm.ip;
		var count = rest.length > 1 ? num(rest[1]) : 12;
		if (isNaN(start)) { out('dis: bad address', 't-err'); return; }
		if (isNaN(count) || count <= 0) count = 12;
		if (count > 200) count = 200;
		var addr = start >>> 0;
		for (var i = 0; i < count && addr < vm.memSizeBytes; i++) {
			var dec = null;
			try { dec = vm.disasm(addr); } catch (err) { dec = null; }
			var mark = addr === vm.ip ? '>' : (machine.breakpoints[addr] ? '*' : ' ');
			if (!dec) {
				out(mark + ' ' + hex(addr, 8) + '  ??          .byte 0x' + hex(vm.memory[addr], 2));
				addr += 1;
				continue;
			}
			var parts = vm.disasmParts(dec);
			out(mark + ' ' + hex(addr, 8) + '  ' + pad(bytesToHex(dec.raw), 14) + '  ' +
				pad(parts.mnemonic, 12) + ' ' + parts.operands);
			addr += dec.length;
		}
		if (opts && opts.hint) out('  ( > = ip   * = breakpoint )', 't-dim');
	}

	function cmdStep(machine, count, out) {
		var n = isNaN(count) || count <= 0 ? 1 : Math.min(count, MAX_RUN_STEPS);
		for (var i = 0; i < n; i++) {
			if (machine.vm.halted) { out('machine is halted', 't-err'); return; }
			if (!machine.step()) break;
		}
		out('ip=0x' + hex(machine.vm.ip, 8) + '  steps=' + machine.vm.instructionCount, 't-dim');
	}

	function cmdRun(machine, count, out) {
		var budget = isNaN(count) || count <= 0 ? MAX_RUN_STEPS : Math.min(count, MAX_RUN_STEPS);
		var steps = 0;
		while (steps < budget) {
			if (machine.vm.halted) break;
			if (machine.breakpoints[machine.vm.ip] && steps > 0) {
				out('breakpoint 0x' + hex(machine.vm.ip, 8) + ' after ' + steps + ' steps', 't-warn');
				return;
			}
			if (!machine.step()) break;
			steps++;
		}
		if (steps >= budget && !machine.vm.halted) {
			out('step limit ' + budget + ' reached (ip=0x' + hex(machine.vm.ip, 8) + ')', 't-warn');
			return;
		}
		out('stopped at ip=0x' + hex(machine.vm.ip, 8) + ' after ' + steps + ' steps', 't-ok');
	}

	function cmdBreak(machine, rest, out) {
		if (!rest.length) {
			var list = machine.bpSet();
			if (!list.length) { out('no breakpoints', 't-dim'); return; }
			list.forEach(function (addr) { out('  0x' + hex(addr, 8)); });
			return;
		}
		if (rest[0] === 'clear') {
			machine.breakpoints = {};
			out('breakpoints cleared', 't-ok');
			return;
		}
		var addr = num(rest[0]);
		if (isNaN(addr)) { out('bp: bad address', 't-err'); return; }
		addr = addr >>> 0;
		if (machine.breakpoints[addr]) {
			delete machine.breakpoints[addr];
			out('breakpoint removed 0x' + hex(addr, 8), 't-dim');
		} else {
			machine.breakpoints[addr] = true;
			out('breakpoint set 0x' + hex(addr, 8), 't-ok');
		}
	}

	/** vm <name> inst "<assembly>" —— 直接把一条汇编写进内存并（默认）执行它 */
	function cmdInst(machine, rest, flags, out) {
		var source = rest.join(' ');
		if (!source) { out('inst: missing assembly, e.g. vm ' + machine.name + ' inst nop', 't-err'); return; }
		var api = H();
		var at = flags.at !== undefined ? num(flags.at) : machine.vm.ip;
		if (isNaN(at)) { out('inst: bad --at address', 't-err'); return; }
		at = at >>> 0;
		var asm = new api.Assembler(isa);
		var bytes;
		try {
			bytes = asm.assemble(normalizeSource(source), at);
		} catch (err) {
			var message = err && err.message ? err.message : String(err);
			/* 只有一条指令时把助记符提示出来，避免"未知指令"看不出是写法问题 */
			out('asm: ' + message, 't-err');
			return;
		}
		try {
			machine.vm.writeBytes(at, bytes);
			dropWindow(machine);
		} catch (err) {
			out('inst: 无法写入内存 (' + (err.message || err) + ')', 't-err');
			return;
		}
		var text = [];
		for (var i = 0; i < bytes.length; i++) text.push((bytes[i] + 0x100).toString(16).slice(1).toUpperCase());
		out('patched 0x' + hex(at, 8) + '  ' + text.join(' ') + '   ' + source, 't-dim');

		if (flags['no-run']) return;
		if (machine.vm.halted) {
			out('机器已停机 —— 先 vm ' + machine.name + ' reset 再跑（这条只写进了内存）', 't-warn');
			return;
		}

		var before = machine.vm.snapshot();
		var ok = machine.step();
		var after = machine.vm.snapshot();
		var changed = [];
		for (var r = 1; r < 32; r++) {
			if (before.gpr[r] !== after.gpr[r]) {
				changed.push(api.GPR_NAMES[r] + ' 0x' + hex(before.gpr[r], 8) + ' -> 0x' + hex(after.gpr[r], 8));
			}
		}
		if (before.flags !== after.flags) {
			changed.push('flags 0x' + hex(before.flags, 8) + ' -> 0x' + hex(after.flags, 8));
		}
		if (before.ip !== after.ip) {
			changed.push('ip 0x' + hex(before.ip, 8) + ' -> 0x' + hex(after.ip, 8));
		}
		out('executed  ip=0x' + hex(after.ip, 8) + (changed.length ? '' : '  (no visible change)'),
			ok ? 't-ok' : 't-warn');
		changed.forEach(function (line) { out('  ' + line, 't-dim'); });
	}

	function cmdLoadImage(machine, kind, name, out) {
		var file = uploadByName(name);
		if (!file) {
			out('vm: no uploaded file named "' + name + '"', 't-err');
			out('  uploaded: ' + (uploads.length ? uploads.map(function (f) { return f.name; }).join(', ') : '(none)'), 't-dim');
			return;
		}
		if (kind === 'rom') {
			machine.vm.loadRom(file.bytes);
			dropWindow(machine);
			machine.romLabel = file.name + ' (' + file.bytes.length + 'B)';
			out('ROM <- ' + file.name + ' (' + Math.min(file.bytes.length, ROM_SIZE) + ' bytes)', 't-ok');
		} else {
			machine.vm.loadDisk(file.bytes);
			machine.diskLabel = file.name + ' (' + file.bytes.length + 'B)';
			out('disk <- ' + file.name + ' (' + Math.min(file.bytes.length, DISK_SIZE) + ' bytes)', 't-ok');
		}
	}

	function download(machine, kind, out) {
		if (!global.Blob || !global.URL || !global.URL.createObjectURL) { out('save: 浏览器不支持 Blob', 't-err'); return; }
		var data = kind === 'rom' ? machine.vm.romBytes : machine.vm.disk;
		var blob = new global.Blob([data], { type: 'application/octet-stream' });
		var url = global.URL.createObjectURL(blob);
		var link = doc.createElement('a');
		link.href = url;
		link.download = machine.name + (kind === 'rom' ? '.rom.hvd' : '.disk.hvd');
		doc.body.appendChild(link);
		link.click();
		link.remove();
		global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 4000);
		out('saved ' + link.download + ' (' + data.length + ' bytes)', 't-ok');
	}

	/* ------------------------------------------------------- 单台机器子命令 */

	/** 内存被改写后，缓存的反汇编窗口必须作废（ROM / 汇编 / inst 都会改内存） */
	function dropWindow(machine) { if (machine) machine._win = null; }

	function runMachineCommand(machine, args, flags, out) {
		var sub = (args[0] || 'info').toLowerCase();
		var rest = args.slice(1);
		switch (sub) {
			case 'info': cmdInfo(machine, out); return true;
			case 'reset':
				machine.running = false;
				machine.out.length = 0;
				machine.vm.reset();
				dropWindow(machine);
				out('reset ' + machine.name + '  ip=0x' + hex(machine.vm.ip, 8) +
					'  sp=0x' + hex(machine.vm.gpr[7], 8), 't-ok');
				return true;
			case 'demo': {
				var id = (rest[0] || '').toLowerCase();
				var source = H().DEMOS[id];
				if (!source) {
					out('demo: unknown program "' + (rest[0] || '') + '"', 't-err');
					out('  available: ' + H().DEMO_LIST.map(function (d) { return d.id; }).join(' | '), 't-dim');
					return true;
				}
				machine.vm.reset();
				machine.out.length = 0;
				dropWindow(machine);
				assembleInto(machine, source, out);
				machine.romLabel = 'demo:' + id;
				return true;
			}
			case 'asm': {
				if (!rest.length) { out('asm: missing source', 't-err'); return true; }
				machine.vm.reset();
				machine.out.length = 0;
				dropWindow(machine);
				assembleInto(machine, rest.join(' '), out);
				return true;
			}
			case 'inst': cmdInst(machine, rest, flags, out); return true;
			case 'step': cmdStep(machine, num(rest[0]), out); return true;
			case 'run': cmdRun(machine, num(rest[0]), out); return true;
			case 'stop':
				machine.running = false;
				out('stopped ' + machine.name, 't-ok');
				return true;
			case 'regs': cmdRegs(machine, rest, out); return true;
			case 'mem': cmdMem(machine, rest, out); return true;
			case 'dis': cmdDis(machine, rest, out, { hint: true }); return true;
			case 'bp': case 'break': cmdBreak(machine, rest, out); return true;
			case 'go': {
				var target = num(rest[0]);
				if (isNaN(target)) { out('go: bad address', 't-err'); return true; }
				machine.vm.ip = target >>> 0;
				out('ip <- 0x' + hex(machine.vm.ip, 8), 't-ok');
				return true;
			}
			case 'rom': cmdLoadImage(machine, 'rom', rest[0], out); return true;
			case 'disk': cmdLoadImage(machine, 'disk', rest[0], out); return true;
			case 'save': download(machine, (flags.kind || rest[0] || 'rom').toLowerCase(), out); return true;
			case 'input':
				machine.vm.feedInput(rest.join(' ') + '\n');
				out('stdin += ' + JSON.stringify(rest.join(' ') + '\n'), 't-dim');
				return true;
			default:
				out('vm: unknown subcommand "' + sub + '" for machine ' + machine.name, 't-err');
				out('  try: vm ' + machine.name + ' info', 't-dim');
				return false;
		}
	}

	/* ------------------------------------------------------------ 命令入口 */

	/**
	 * 终端 / 按钮共用入口
	 * @param {string[]} args  已切好的参数（不含前面的 vm）
	 * @param {function} out   行输出回调 (text, cls) -> 元素
	 */
	function command(args, out) {
		out = out || function () {};
		withISA(function () {
			var parsed = parseFlags(args);
			var rest = parsed.rest;
			var head = (rest[0] || '').toLowerCase();

			if (!rest.length || head === 'help' || head === '-h') { helpText(null, out); return; }

			if (head === 'new') {
				var name = rest[1] || ('vm' + (machines.length + 1));
				var flags = parsed.flags;
				var options = {
					memSize: flags.mem !== undefined ? num(flags.mem) : MEM_DEFAULT,
					entry: flags.entry !== undefined ? num(flags.entry) : 0,
					sp: flags.sp !== undefined ? num(flags.sp) : undefined,
					syscallVector: flags.syscall !== undefined ? num(flags.syscall) : undefined
				};
				if (isNaN(options.memSize) || options.memSize < 1 || options.memSize > 65536) {
					out('new: --mem must be 1..65536 KB', 't-err');
					return;
				}
				if (flags.rom) {
					var romFile = uploadByName(flags.rom);
					if (!romFile) { out('new: no uploaded file named "' + flags.rom + '"', 't-err'); return; }
					options.rom = romFile.bytes;
					options.romLabel = romFile.name;
				}
				if (flags.disk) {
					var diskFile = uploadByName(flags.disk);
					if (!diskFile) { out('new: no uploaded file named "' + flags.disk + '"', 't-err'); return; }
					options.disk = diskFile.bytes;
					options.diskLabel = diskFile.name;
				}
				var machine = createMachine(name, options, out);
				activeName = machine.name;
				if (flags.demo) {
					var source = H().DEMOS[String(flags.demo).toLowerCase()];
					if (!source) out('new: unknown demo "' + flags.demo + '"', 't-err');
					else {
						assembleInto(machine, source, out);
						machine.romLabel = 'demo:' + String(flags.demo).toLowerCase();
					}
				}
				return;
			}

			if (head === 'ls' || head === 'list') { helpText(null, out); return; }

			if (head === 'rm' || head === 'remove') {
				if (!rest[1]) { out('rm: need a machine name', 't-err'); return; }
				removeMachine(rest[1], out);
				return;
			}

			if (head === 'upload') {
				if (ui) ui.openFilePicker();
				else out('upload: 打开 ~/labs/vm 页面后可以选文件（或把文件拖到那个面板上）', 't-dim');
				return;
			}

			var machine = findMachine(rest[0]);
			if (!machine) {
				out('vm: no machine named "' + rest[0] + '"', 't-err');
				out('  try: vm ls   or   vm new ' + (rest[0] || 'vm1'), 't-dim');
				return;
			}
			activeName = machine.name;
			runMachineCommand(machine, rest.slice(1), parsed.flags, out);
		}, out);
	}

	/* ------------------------------------------------------------- 上传文件 */

	function classify(name, size) {
		var lower = String(name).toLowerCase();
		if (/\.(asm|s|txt|a32)$/.test(lower)) return 'source';
		if (size === ROM_SIZE) return 'rom';
		if (size === DISK_SIZE) return 'disk';
		if (/\.(hvd|hvr|rom|bin)$/.test(lower)) return size >= 1024 * 64 ? 'disk' : 'rom';
		return 'raw';
	}

	function addUpload(file, done) {
		var reader = new global.FileReader();
		reader.onload = function () {
			var bytes = new Uint8Array(reader.result);
			var record = {
				name: file.name,
				size: bytes.length,
				bytes: bytes,
				kind: classify(file.name, bytes.length),
				text: null
			};
			if (record.kind === 'source') {
				record.text = new global.TextDecoder().decode(bytes);
			} else {
				/* 也可能是汇编：能按 utf-8 读成文本且不含 \0 就当源码看待 */
				try {
					var probe = new global.TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 2048));
					if (probe.indexOf('\u0000') === -1 && /[A-Za-z]/.test(probe)) record.text = new global.TextDecoder().decode(bytes);
				} catch (err) { /* 二进制，保持原样 */ }
			}
			uploads.push(record);
			if (done) done(record);
		};
		reader.readAsArrayBuffer(file);
	}

	/* ============================================================ 页面控制器 */

	function esc(text) {
		return String(text).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	function toLogClass(cls) {
		if (cls === 't-err') return 'err';
		if (cls === 't-ok') return 'ok';
		return 'log';
	}

	function createUI(root, scope) {
		var outer = scope || root;
		var dom = {
			select: root.querySelector('[data-vm-select]'),
			demo: root.querySelector('[data-vm-demo]'),
			status: root.querySelector('[data-vm-status]'),
			cur: root.querySelector('[data-vm-cur]'),
			dis: root.querySelector('[data-vm-dis]'),
			regs: root.querySelector('[data-vm-regs]'),
			flags: root.querySelector('[data-vm-flags]'),
			kernel: root.querySelector('[data-vm-kernel]'),
			fprs: root.querySelector('[data-vm-fprs]'),
			stack: root.querySelector('[data-vm-stack]'),
			mem: root.querySelector('[data-vm-mem]'),
			out: root.querySelector('[data-vm-out]'),
			files: root.querySelector('[data-vm-files]'),
			file: root.querySelector('[data-vm-file]'),
			memBase: root.querySelector('[data-vm-mem-base]'),
			memFollow: root.querySelector('[data-vm-mem-follow]'),
			/* 命令速查在 root 外面（独立 section），所以从更大的 scope 里找 */
			cheat: outer.querySelector('[data-vm-cheat]')
		};
		var api = H();
		var self = { root: root, dom: dom };
		var programmatic = false;      /* 自动跟随滚动中，别跟用户的滚动打架（CSS 负责吸附） */

		/* ---- 下拉框：示例程序 / 跟随寄存器 / 机器列表 ---- */
		if (dom.demo && !dom.demo.options.length) {
			api.DEMO_LIST.forEach(function (item) {
				var option = doc.createElement('option');
				option.value = item.id;
				option.textContent = item.title;
				dom.demo.appendChild(option);
			});
		}
		if (dom.memFollow && !dom.memFollow.options.length) {
			var manual = doc.createElement('option');
			manual.value = 'manual';
			manual.textContent = 'manual';
			dom.memFollow.appendChild(manual);
			var ipOption = doc.createElement('option');
			ipOption.value = 'ip';
			ipOption.textContent = 'ip';
			dom.memFollow.appendChild(ipOption);
			api.GPR_NAMES.forEach(function (name, index) {
				var option = doc.createElement('option');
				option.value = String(index);
				option.textContent = name;
				dom.memFollow.appendChild(option);
			});
		}

		function dynamicSink() {
			return function (text, cls) {
				var machine = activeMachine();
				if (machine) machine.log(String(text), toLogClass(cls));
			};
		}

		function act(args) {
			command(args, dynamicSink());
			refresh();
			if (!isa && loadingISA) loadingISA.then(refresh, refresh);
		}

		/** ISA 还没到位时把动作排队（页面刚打开就点按钮的情况） */
		function whenReady(fn) {
			if (isa) { fn(); return; }
			ensureISA().then(function () {
				fn();
				if (ui === self) refresh();
			}, function (err) {
				var machine = activeMachine();
				if (machine) machine.log('ISA 加载失败: ' + (err && err.message ? err.message : err), 'err');
				refresh();
			});
		}

		/* ------------------------------------------------------------ 动作 */

		function action(name) {
			var machine = activeMachine();
			switch (name) {
				case 'new': {
					whenReady(function () {
						var base = machine ? ('vm' + (machines.length + 1)) : 'vm1';
						var created = createMachine(base, {
							memSize: machine ? machine.memSize : MEM_DEFAULT
						}, dynamicSink());
						activeName = created.name;
						refresh();
					});
					return;
				}
				case 'upload': self.openFilePicker(); return;
				case 'save-rom': if (machine) download(machine, 'rom', dynamicSink()); refresh(); return;
				case 'save-disk': if (machine) download(machine, 'disk', dynamicSink()); refresh(); return;
				case 'load-demo': {
					var pick = dom.demo ? dom.demo.value : 'fib';
					if (!machine) return;
					act([machine.name, 'demo', pick]);
					return;
				}
				case 'run': runActive(); return;
				case 'pause': pauseActive(); return;
				case 'step': if (machine) act([machine.name, 'step']); return;
				case 'over': stepOver(); return;
				case 'out': stepOut(); return;
				case 'restart': if (machine) act([machine.name, 'reset']); return;
				case 'clear-bp': if (machine) act([machine.name, 'bp', 'clear']); return;
				default: return;
			}
		}

		/* ------------------------------------------------------- 运行循环 */

		function now() {
			return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
		}

		function setRunningVisual(running) {
			var machine = activeMachine();
			root.dataset.running = running ? 'true' : 'false';
			Array.prototype.forEach.call(root.querySelectorAll('[data-vm-act="run"]'), function (btn) {
				btn.disabled = !!running;
			});
			Array.prototype.forEach.call(root.querySelectorAll('[data-vm-act="pause"]'), function (btn) {
				btn.disabled = !running;
			});
			if (!running && machine && !machine.vm.halted) refresh();
		}

		function finishRun(machine, reason) {
			machine.running = false;
			machine.log('■ ' + reason, 'ok');
			setRunningVisual(false);
			refresh();
		}

		function runActive() {
			var machine = activeMachine();
			if (!machine || machine.running) return;
			if (machine.vm.halted) {
				machine.log('machine is halted — restart it first', 'err');
				refresh();
				return;
			}
			machine.running = true;
			setRunningVisual(true);
			machine.log('▶ run ' + machine.name, 'log');
			var budget = MAX_RUN_STEPS;
			var steps = 0;
			var lastRender = 0;

			function tick() {
				if (!machine.running) return;
				if (!root.isConnected) { machine.running = false; return; }
				var t0 = now();
				while (now() - t0 < 8) {
					if (machine.vm.halted) { finishRun(machine, 'halted at ip=0x' + hex(machine.vm.ip, 8)); return; }
					if (steps > 0 && machine.breakpoints[machine.vm.ip]) {
						finishRun(machine, 'breakpoint 0x' + hex(machine.vm.ip, 8) + ' after ' + steps + ' steps');
						return;
					}
					if (!machine.step()) { finishRun(machine, 'stopped at ip=0x' + hex(machine.vm.ip, 8)); return; }
					steps++;
					if (steps >= budget) {
						finishRun(machine, 'step limit ' + budget + ' reached (ip=0x' + hex(machine.vm.ip, 8) + ')');
						return;
					}
				}
				var stamp = now();
				if (stamp - lastRender > 60) { lastRender = stamp; refresh(); }
				global.requestAnimationFrame(tick);
			}
			global.requestAnimationFrame(tick);
		}

		function pauseActive() {
			var machine = activeMachine();
			if (machine && machine.running) {
				machine.running = false;
				finishRun(machine, 'paused at ip=0x' + hex(machine.vm.ip, 8));
			}
		}

		/** 跳过调用：当前是 CALL/CALLR 就跑过它，否则等效单步 */
		function stepOver() {
			var machine = activeMachine();
			if (!machine || machine.running) return;
			var dec = null;
			try { dec = machine.vm.disasm(machine.vm.ip); } catch (err) { dec = null; }
			if (!dec || (dec.inst.name !== 'CALL' && dec.inst.name !== 'CALLR')) { act([machine.name, 'step']); return; }
			var target = (machine.vm.ip + dec.length) >>> 0;
			var guard = 0;
			while (!machine.vm.halted && machine.vm.ip !== target && guard < 500000) {
				if (!machine.step()) break;
				guard++;
			}
			machine.log('step over done  ip=0x' + hex(machine.vm.ip, 8), 'ok');
			refresh();
		}

		/** 跳出：跑到当前栈帧返回（SP 回到进入时的值） */
		function stepOut() {
			var machine = activeMachine();
			if (!machine || machine.running) return;
			var entrySp = machine.vm.gpr[7];
			var guard = 0;
			while (!machine.vm.halted && machine.vm.gpr[7] < entrySp && guard < 500000) {
				if (!machine.step()) break;
				guard++;
			}
			machine.log('step out done  ip=0x' + hex(machine.vm.ip, 8) + '  sp=0x' + hex(machine.vm.gpr[7], 8), 'ok');
			refresh();
		}

		/* ------------------------------------------------------------ 渲染 */

		function renderSelect(machine) {
			if (!dom.select) return;
			var wanted = machine ? machine.name : '';
			if (dom.select.dataset.signature !== machines.map(function (m) { return m.name; }).join(',')) {
				dom.select.innerHTML = '';
				machines.forEach(function (m) {
					var option = doc.createElement('option');
					option.value = m.name;
					option.textContent = m.name + (m.vm.halted ? ' (halted)' : '');
					dom.select.appendChild(option);
				});
				dom.select.dataset.signature = machines.map(function (m) { return m.name; }).join(',');
			}
			if (dom.select.value !== wanted) dom.select.value = wanted;
		}

		function renderStatus(machine) {
			if (!dom.status) return;
			if (!machine) {
				dom.status.textContent = 'vm: — (vm new vm1 创建一台)';
				dom.status.setAttribute('data-state', 'empty');
				return;
			}
			var vm = machine.vm;
			var state = machine.running ? 'running' : (vm.halted ? 'halted' : 'paused');
			dom.status.setAttribute('data-state', state);
			dom.status.textContent = machine.name + ' · ' + state + ' · ip=0x' + hex(vm.ip, 8) +
				' · steps=' + vm.instructionCount + ' · bp=' + machine.bpSet().length +
				' · mem=' + machine.memSize + 'KB';
		}

		function renderCurrent(machine) {
			if (!dom.cur) return;
			if (!machine) { dom.cur.textContent = '—'; return; }
			var vm = machine.vm;
			var text = '0x' + hex(vm.ip, 8);
			var dec = null;
			try { dec = vm.disasm(vm.ip); } catch (err) { dec = null; }
			if (dec) {
				var parts = vm.disasmParts(dec);
				text += '  ' + parts.mnemonic + ' ' + parts.operands;
			} else if (vm.ip < vm.memSizeBytes) {
				text += '  .byte 0x' + hex(vm.memory[vm.ip], 2);
			}
			dom.cur.textContent = text;
		}

		function windowHas(machine, ip) {
			var win = machine._win;
			if (!win) return false;
			for (var i = 0; i < win.length; i++) if (win[i].addr === ip) return true;
			return false;
		}

		function renderDisasm(machine) {
			if (!dom.dis) return;
			if (!machine) { dom.dis.innerHTML = ''; return; }
			var vm = machine.vm;
			var rebuilt = false;
			if (!windowHas(machine, vm.ip)) {
				machine._win = vm.disasmBlock(vm.ip, W_BEFORE, W_AFTER);
				rebuilt = true;
			}
			var rows = [];
			var currentIndex = -1;
			machine._win.forEach(function (line, index) {
				var isCurrent = line.addr === vm.ip;
				if (isCurrent) currentIndex = index;
				var classes = 'vm-dis__row';
				if (isCurrent) classes += ' is-curr';
				if (machine.breakpoints[line.addr]) classes += ' is-bp';
				var bytes = '??';
				var asm = '.byte 0x' + hex(vm.memory[line.addr] || 0, 2);
				if (line.dec) {
					bytes = bytesToHex(line.dec.raw);
					var parts = vm.disasmParts(line.dec);
					asm = '<b>' + esc(parts.mnemonic) + '</b> ' + esc(parts.operands);
				}
				rows.push('<li class="' + classes + '" data-addr="' + line.addr + '">' +
					'<span class="vm-dis__bp">' + (machine.breakpoints[line.addr] ? '●' : '') + '</span>' +
					'<span class="vm-dis__addr">' + hex(line.addr, 8) + '</span>' +
					'<span class="vm-dis__bytes">' + bytes + '</span>' +
					'<span class="vm-dis__asm">' + asm + '</span></li>');
			});
			dom.dis.innerHTML = rows.join('');
			if (currentIndex >= 0) follow(dom.dis, currentIndex, rebuilt);
		}

		/** 反汇编行高（与 CSS 的 --vm-line 同源，直接从计算样式读） */
		function rowHeight() {
			var value = parseInt(global.getComputedStyle(dom.dis).lineHeight, 10);
			return value > 0 ? value : 19;
		}

		/**
		 * 反汇编窗口尽量用满可视高度：高度取「行高 × 整数行」，
		 * 于是底部永远落在行边界上（不会露出半行），同时把窗口高度都留给地址/字节/指令。
		 */
		function fitHeight() {
			if (!dom.dis || !root.isConnected) return;
			var rowH = rowHeight();
			var top = Math.max(dom.dis.getBoundingClientRect().top, 0);
			/* 底部那条固定坞不能压住最后几行 */
			var dock = doc.getElementById('dock');
			var dockH = 0;
			if (dock) {
				var dockBox = dock.getBoundingClientRect();
				if (dockBox.height > 0 && dockBox.top < global.innerHeight) {
					dockH = global.innerHeight - dockBox.top + 8;
				}
			}
			var avail = global.innerHeight - top - 16 - dockH;
			var rows = Math.max(10, Math.min(60, Math.floor(avail / rowH)));
			dom.dis.style.height = (rows * rowH) + 'px';
		}
		self.fit = fitHeight;
		global.addEventListener('resize', fitHeight);

		/**
		 * 让当前指令停在被吸附的行边界上。
		 * 面板高度 = 行高 × 整数行，所以 scrollTop 也必须是行高的整数倍，
		 * 否则列表底部会露出被切掉一半的指令（之前就是这么截断的）。
		 */
		function follow(box, index, center) {
			var rowH = rowHeight();
			var visible = Math.max(1, Math.floor(box.clientHeight / rowH));
			var top = box.scrollTop;
			var rowTop = index * rowH;
			var fullyVisible = rowTop >= top - 1 && rowTop + rowH <= top + box.clientHeight + 1;
			if (!center && fullyVisible) return;
			var want;
			if (center) {
				want = rowTop - Math.floor((visible - 1) / 2) * rowH;
			} else if (rowTop < top) {
				want = rowTop - rowH * 2;                      /* 往前跑：留两行上下文 */
			} else {
				want = rowTop - (visible - 3) * rowH;          /* 往后跑：留两行上下文 */
			}
			var max = Math.max(0, box.scrollHeight - box.clientHeight);
			want = Math.max(0, Math.min(max, Math.round(want / rowH) * rowH));
			if (want === top) return;
			programmatic = true;
			box.scrollTop = want;
			global.setTimeout(function () { programmatic = false; }, 0);
		}

		function renderRegs(machine) {
			if (!dom.regs) return;
			if (!machine) { dom.regs.innerHTML = ''; return; }
			var vm = machine.vm;
			var names = api.GPR_NAMES;
			var rows = [];
			for (var i = 0; i < 32; i++) {
				rows.push('<div class="vm-reg" data-reg="' + i + '"><b>' + names[i] + '</b><span>' +
					hex(vm.gpr[i], 8) + '</span></div>');
			}
			dom.regs.innerHTML = rows.join('');
		}

		function renderFlags(machine) {
			if (!dom.flags) return;
			if (!machine) { dom.flags.innerHTML = ''; return; }
			var vm = machine.vm;
			var text = api.FLAG_DISPLAY.map(function (name) {
				var on = vm.getFlag(name);
				return name.toUpperCase() + '=<i class="' + (on ? '' : 'is-off') + '">' + on + '</i>';
			}).join('  ');
			dom.flags.innerHTML = '<b>FLAGS</b> 0x' + hex(vm.flags, 8) + '  ' + text;
		}

		function renderKernel(machine) {
			if (!dom.kernel) return;
			if (!machine) { dom.kernel.textContent = ''; return; }
			var vm = machine.vm;
			dom.kernel.textContent = 'ip=0x' + hex(vm.ip, 8) + '  mode=' + vm.mode +
				'  idt=0x' + hex(vm.kernel.idt, 8) +
				'  cr0=0x' + hex(vm.cr[0], 8) + '  cr1=0x' + hex(vm.cr[1], 8) +
				'  cr2=0x' + hex(vm.cr[2], 8) + '  cr3=0x' + hex(vm.cr[3], 8);
		}

		function renderFprs(machine) {
			if (!dom.fprs) return;
			if (!machine) { dom.fprs.innerHTML = ''; return; }
			var vm = machine.vm;
			var rows = [];
			for (var i = 0; i < api.FPR_NAMES.length; i++) {
				rows.push('<div class="vm-reg"><b>' + api.FPR_NAMES[i] + '</b><span>' +
					esc(fmtFloat(vm.fpr[i])) + '</span></div>');
			}
			dom.fprs.innerHTML = rows.join('');
		}

		function fmtFloat(value) {
			if (!isFinite(value)) return String(value);
			if (value === Math.round(value) && Math.abs(value) < 1e15) return String(value);
			return String(Math.round(value * 1e6) / 1e6);
		}

		function renderStack(machine) {
			if (!dom.stack) return;
			if (!machine) { dom.stack.innerHTML = ''; return; }
			var vm = machine.vm;
			var sp = vm.gpr[7];
			var rows = [];
			for (var i = 0; i < STACK_ROWS; i++) {
				var addr = (sp + i * 4) >>> 0;
				var value = '????????';
				if (addr + 4 <= vm.memSizeBytes) {
					value = hex(vm.memory[addr] | (vm.memory[addr + 1] << 8) |
						(vm.memory[addr + 2] << 16) | (vm.memory[addr + 3] << 24), 8);
				}
				rows.push('<li class="' + (addr === sp ? 'is-sp' : '') + '"><span class="a">' + hex(addr, 8) +
					'</span><span class="v">' + value + '</span></li>');
			}
			dom.stack.innerHTML = rows.join('');
		}

		function memBase() {
			var machine = activeMachine();
			if (!machine) return 0;
			var follow = dom.memFollow ? dom.memFollow.value : 'manual';
			if (follow === 'ip') return machine.vm.ip;
			if (follow !== 'manual') {
				var index = parseInt(follow, 10);
				if (!isNaN(index)) return machine.vm.gpr[index];
			}
			var value = num(dom.memBase ? dom.memBase.value : '0');
			return isNaN(value) ? 0 : (value >>> 0);
		}

		function renderMem(machine) {
			if (!dom.mem) return;
			if (!machine) { dom.mem.innerHTML = ''; return; }
			var vm = machine.vm;
			var base = memBase();
			var rows = [];
			for (var r = 0; r < MEM_ROWS; r++) {
				var addr = (base + r * MEM_BYTES) >>> 0;
				if (addr >= vm.memSizeBytes) break;
				var hexParts = [];
				var ascii = '';
				for (var i = 0; i < MEM_BYTES; i++) {
					if (addr + i >= vm.memSizeBytes) { hexParts.push('  '); ascii += ' '; continue; }
					var byte = vm.memory[addr + i];
					hexParts.push((byte + 0x100).toString(16).slice(1).toUpperCase());
					ascii += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
				}
				rows.push('<li><span class="a">' + hex(addr, 8) + '</span>  <span class="h">' +
					pad(hexParts.join(' '), MEM_BYTES * 3 - 1) + '</span>  <span class="s">|' + esc(ascii) + '|</span></li>');
			}
			if (!rows.length) rows.push('<li class="empty">0x' + hex(base, 8) + ' is out of memory</li>');
			dom.mem.innerHTML = rows.join('');
		}

		function renderOut(machine) {
			if (!dom.out) return;
			if (!machine) { dom.out.textContent = ''; return; }
			var html = [];
			machine.logs.forEach(function (line) {
				html.push('<span class="' + esc(line.cls) + '">' + esc(line.text) + '</span>');
			});
			var console = machine.out.join('');
			if (console.length > 4000) console = '…' + console.slice(-4000);
			if (console) html.push('<span class="ok">' + esc(console) + '</span>');
			dom.out.innerHTML = html.join('\n');
			dom.out.scrollTop = dom.out.scrollHeight;
		}

		function renderFiles() {
			if (!dom.files) return;
			if (!uploads.length) {
				dom.files.innerHTML = '<li class="empty">没有文件 —— Upload file 选一个，或者直接把文件拖到这块面板上</li>';
				return;
			}
			var html = uploads.map(function (file, index) {
				var kindText = { source: 'source', rom: 'ROM', disk: 'disk', raw: 'raw' }[file.kind] || file.kind;
				var actions = [];
				if (file.kind === 'source') {
					actions.push('<button type="button" class="vm-btn" data-file-act="assemble" data-index="' + index + '">assemble</button>');
				}
				if (file.kind !== 'disk') {
					actions.push('<button type="button" class="vm-btn" data-file-act="rom" data-index="' + index + '">use as ROM</button>');
				}
				if (file.kind !== 'rom') {
					actions.push('<button type="button" class="vm-btn" data-file-act="disk" data-index="' + index + '">use as disk</button>');
				}
				actions.push('<button type="button" class="vm-btn vm-btn--ghost" data-file-act="remove" data-index="' + index + '">remove</button>');
				return '<li><span class="name">' + esc(file.name) + '</span>' +
					'<span class="meta">' + kindText + ' · ' + file.size + ' B</span>' +
					'<span class="acts">' + actions.join('') + '</span></li>';
			});
			dom.files.innerHTML = html.join('');
		}

		function renderCheat() {
			if (!dom.cheat || dom.cheat.dataset.built === 'true') return;
			var groups = [
				{ title: 'create', rows: [
					['vm new vm1 --demo=fib', 'machine + a built-in program'],
					['vm new vm2 --mem=8192', 'memory size in KB'],
					['vm new vm3 --rom=my.hvd', 'start from an uploaded ROM'],
					['vm ls  ·  vm rm vm2', 'list / remove']
				] },
				{ title: 'run', rows: [
					['vm vm1 inst nop', 'assemble + run one instruction'],
					['vm vm1 inst "IMM ra, 40"', 'with operands'],
					['vm vm1 inst "IMMB ri, 42" --no-run', 'patch only'],
					['vm vm1 step  ·  step 10', 'single step'],
					['vm vm1 run 100  ·  run', 'run (breakpoints / HALT stop it)'],
					['vm vm1 reset', 'back to the entry point']
				] },
				{ title: 'inspect', rows: [
					['vm vm1 regs', 'all GPR + flags'],
					['vm vm1 regs set ra 0x10', 'write a register'],
					['vm vm1 mem 0 64', 'hex dump'],
					['vm vm1 dis 0x10 16', 'disassemble'],
					['vm vm1 info', 'machine summary']
				] },
				{ title: 'debug', rows: [
					['vm vm1 bp 0x0C', 'toggle a breakpoint'],
					['vm vm1 bp  ·  bp clear', 'list / clear'],
					['vm vm1 go 0x20', 'jump the ip'],
					['vm vm1 demo fib3', 'hello | fib | fib3 | intr | mem']
				] },
				{ title: 'files', rows: [
					['vm vm1 rom my.hvd', 'uploaded file -> ROM'],
					['vm vm1 disk disk.hvd', 'uploaded file -> disk'],
					['vm vm1 save rom', 'download the ROM image'],
					['vm vm1 save disk', 'download the disk image']
				] }
			];
			var html = groups.map(function (group) {
				return '<div class="vm-cheat__group"><h3>' + group.title + '</h3>' +
					group.rows.map(function (row) {
						return '<div class="vm-cheat__row is-clickable" data-cheat="' + esc(row[0]) + '">' +
							'<code>' + esc(row[0]) + '</code><span>' + esc(row[1]) + '</span></div>';
					}).join('') + '</div>';
			});
			dom.cheat.innerHTML = html.join('');
			dom.cheat.dataset.built = 'true';
		}

		function refresh() {
			var machine = activeMachine();
			renderSelect(machine);
			renderStatus(machine);
			renderCurrent(machine);
			renderDisasm(machine);
			renderRegs(machine);
			renderFlags(machine);
			renderKernel(machine);
			renderFprs(machine);
			renderStack(machine);
			renderMem(machine);
			renderOut(machine);
			renderFiles();
			renderCheat();
			Array.prototype.forEach.call(root.querySelectorAll('[data-vm-act]'), function (btn) {
				var name = btn.getAttribute('data-vm-act');
				if (name === 'pause') btn.disabled = !(machine && machine.running);
				else if (name === 'run') btn.disabled = !!(machine && machine.running);
				else if (name === 'step' || name === 'over' || name === 'out' || name === 'load-demo') {
					btn.disabled = !machine || machine.running;
				} else {
					btn.disabled = !machine && ['save-rom', 'save-disk', 'restart', 'clear-bp'].indexOf(name) >= 0;
				}
			});
		}

		/* ------------------------------------------------------------ 交互 */

		self.refresh = refresh;
		self.root = root;
		self.run = runActive;
		self.pause = pauseActive;
		self.action = action;
		self.openFilePicker = function () {
			if (dom.file) dom.file.click();
		};

		root.addEventListener('click', function (e) {
			var target = e.target;
			var actBtn = target.closest ? target.closest('[data-vm-act]') : null;
			if (actBtn) { e.preventDefault(); action(actBtn.getAttribute('data-vm-act')); return; }

			var fileBtn = target.closest ? target.closest('[data-file-act]') : null;
			if (fileBtn) {
				e.preventDefault();
				var file = uploads[parseInt(fileBtn.getAttribute('data-index'), 10)];
				var what = fileBtn.getAttribute('data-file-act');
				if (!file) return;
				if (what === 'remove') {
					uploads.splice(uploads.indexOf(file), 1);
					refresh();
					return;
				}
				var machine = activeMachine();
				if (!machine) {
					var sink = dynamicSink();
					machine = createMachine('vm1', { memSize: MEM_DEFAULT }, sink);
					activeName = machine.name;
				}
				if (what === 'assemble') {
					if (!file.text) { machine.log('不是文本文件，无法汇编: ' + file.name, 'err'); refresh(); return; }
					act([machine.name, 'asm', file.text]);
					machine.romLabel = file.name;
				} else {
					act([machine.name, what === 'rom' ? 'rom' : 'disk', file.name]);
				}
				refresh();
				return;
			}

			var cheat = target.closest ? target.closest('[data-cheat]') : null;
			if (cheat) {
				var cmd = cheat.getAttribute('data-cheat');
				if (global.Terminal && global.Terminal.run) global.Terminal.run(cmd);
				return;
			}

			var row = target.closest ? target.closest('.vm-dis__row') : null;
			if (row) {
				var machine2 = activeMachine();
				if (!machine2) return;
				var addr = parseInt(row.getAttribute('data-addr'), 10);
				act([machine2.name, 'bp', '0x' + hex(addr, 8)]);
				return;
			}

			var regValue = target.closest ? target.closest('.vm-reg span') : null;
			if (regValue) editRegister(regValue);
		});

		/** 点寄存器值就地改：Enter 写入，Esc / 失焦取消 */
		function editRegister(span) {
			var row = span.closest('.vm-reg');
			var machine = activeMachine();
			if (!row || !machine) return;
			var index = parseInt(row.getAttribute('data-reg'), 10);
			if (isNaN(index)) return;
			if (index === 0) { machine.log('x0 恒为 0，不能改', 'err'); refresh(); return; }
			var input = doc.createElement('input');
			input.value = '0x' + hex(machine.vm.gpr[index], 8);
			input.spellcheck = false;
			span.replaceWith(input);
			input.focus();
			input.select();
			var done = false;
			function commit(save) {
				if (done) return;
				done = true;
				if (save) {
					var value = num(input.value);
					if (isNaN(value)) machine.log('不是合法数值: ' + input.value, 'err');
					else {
						machine.vm.writeGpr(index, value);
						machine.log(api.GPR_NAMES[index] + ' <- 0x' + hex(machine.vm.gpr[index], 8), 'ok');
					}
				}
				refresh();
			}
			input.addEventListener('keydown', function (e) {
				if (e.key === 'Enter') { e.preventDefault(); commit(true); }
				else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
			});
			input.addEventListener('blur', function () { commit(false); });
		}

		if (dom.select) {
			dom.select.addEventListener('change', function () {
				activeName = dom.select.value;
				var machine = activeMachine();
				if (machine) delete machine._win;
				refresh();
			});
		}

		if (dom.memFollow) {
			dom.memFollow.addEventListener('change', function () {
				if (dom.memBase) dom.memBase.disabled = dom.memFollow.value !== 'manual';
				renderMem(activeMachine());
			});
			dom.memBase.disabled = false;
		}
		if (dom.memBase) {
			dom.memBase.addEventListener('change', function () { renderMem(activeMachine()); });
			dom.memBase.addEventListener('keydown', function (e) {
				if (e.key === 'Enter') { e.preventDefault(); renderMem(activeMachine()); }
			});
		}

		if (dom.file) {
			dom.file.addEventListener('change', function () {
				var files = dom.file.files;
				Array.prototype.forEach.call(files, function (file) {
					addUpload(file, function () { refresh(); });
				});
				dom.file.value = '';
			});
		}

		/* 拖放：把文件拖到工作台就收下 */
		['dragenter', 'dragover'].forEach(function (type) {
			root.addEventListener(type, function (e) {
				if (!e.dataTransfer) return;
				e.preventDefault();
				root.classList.add('is-drop');
			});
		});
		['dragleave', 'dragend'].forEach(function (type) {
			root.addEventListener(type, function () { root.classList.remove('is-drop'); });
		});
		root.addEventListener('drop', function (e) {
			if (!e.dataTransfer) return;
			e.preventDefault();
			root.classList.remove('is-drop');
			Array.prototype.forEach.call(e.dataTransfer.files || [], function (file) {
				addUpload(file, function () { refresh(); });
			});
		});

		/* 键盘：F7 单步 / F8 跳过调用 / Ctrl+F8 跳出 / F9 运行 —— 与 dbg.py 一致 */
		self.handleKey = function (e) {
			var key = e.key;
			if (key !== 'F7' && key !== 'F8' && key !== 'F9') return false;
			e.preventDefault();
			if (key === 'F7') action('step');
			else if (key === 'F8') { if (e.ctrlKey) action('out'); else action('over'); }
			else { var machine = activeMachine(); if (machine && machine.running) action('pause'); else action('run'); }
			return true;
		};

		fitHeight();
		refresh();
		/* 入场动画（上移淡入）会让面板位置偏几像素，落位后再量一次 */
		global.setTimeout(fitHeight, 700);
		return self;
	}

	/* --------------------------------------------------------- 挂载 + 键盘 */

	function mountAll(scope) {
		var root = (scope || doc).querySelector('[data-vm-root]');
		if (!root) return ui;
		if (root.dataset.vmMounted === 'true' && ui && ui.root === root) {
			if (ui.fit) ui.fit();
			ui.refresh();
			return ui;
		}
		root.dataset.vmMounted = 'true';
		ui = createUI(root, scope || doc);
		registerTerminal();
		ensureISA().then(function () {
			if (!machines.length) {
				var machine = createMachine('vm1', { memSize: MEM_DEFAULT }, null);
				assembleInto(machine, H().DEMOS.fib, function (text, cls) {
					machine.log(String(text), toLogClass(cls));
				});
				machine.romLabel = 'demo:fib';
				machine.note('auto-created vm1 with the fib demo — 试试终端里的 vm vm1 inst nop');
				if (ui && ui.dom && ui.dom.demo) ui.dom.demo.value = 'fib';
			}
			ui.refresh();
		}).catch(function (err) {
			if (ui && activeMachine() === null) {
				ui.dom.status.setAttribute('data-state', 'error');
				ui.dom.status.textContent = 'ISA 加载失败: ' + (err && err.message ? err.message : err);
			}
		});
		return ui;
	}

	doc.addEventListener('keydown', function (e) {
		if (!ui || !ui.root.isConnected) return;
		if (doc.documentElement.getAttribute('data-route-current') !== 'labs-vm') return;
		var tag = (e.target && e.target.tagName || '').toLowerCase();
		if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
		if (e.altKey || e.metaKey) return;
		ui.handleKey(e);
	});

	/* -------------------------------------------------- 终端命令（vm ...） */

	var VM_HELP_ROWS = [
		['vm', 'list machines + usage'],
		['vm new <name> [--demo=fib] [--mem=4096]', 'create a machine (same as the New VM button)'],
		['vm <name> inst "<asm>" [--no-run]', 'assemble + run one instruction, e.g. vm vm1 inst nop'],
		['vm <name> step|run [n]|stop|reset', 'execution control'],
		['vm <name> regs|mem|dis|info', 'registers, memory, disassembly'],
		['vm <name> bp <addr>|clear | go <addr>', 'breakpoints / set ip'],
		['vm <name> demo <id>|asm "<src>"', 'built-in programs (hello fib fib3 intr mem)'],
		['vm <name> rom|disk|save <file-type>', 'uploaded images in / out'],
		['vm upload', 'open the ~/labs/vm file picker']
	];

	function registerTerminal() {
		var T = global.Terminal;
		if (!T || typeof T.register !== 'function' || T.__labsVmRegistered) return false;
		T.__labsVmRegistered = true;
		T.register({
			vm: function (args, api) {
				var out = function (text, cls) {
					var el = api && api.print ? api.print(String(text), cls || undefined) : null;
					return el;
				};
				var head = String(args[0] || '').toLowerCase();
				command(args, out);
				if (ui) {
					global.setTimeout(function () { ui.refresh(); }, 30);
				} else if (head === '' || head === 'new' || head === 'ls' || head === 'help') {
					global.setTimeout(function () {
						if (ui) return;
						out('打开 ~/labs/vm 页面可以看到寄存器 / 内存 / 当前指令（终端里敲 open labs-vm）', 't-dim');
					}, 450);
				}
			}
		}, { title: 'arch32 vm', rows: VM_HELP_ROWS });
		return true;
	}

	/* ------------------------------------------------------------------ 导出 */

	global.LabsVM = {
		VERSION: '1.0.0',
		command: command,
		mountAll: mountAll,
		refresh: function () { if (ui) ui.refresh(); },
		register: registerTerminal,
		ensureISA: ensureISA,
		addUpload: addUpload,
		machines: machines,
		uploads: uploads,
		active: activeMachine,
		create: function (name, options) {
			if (!isa) {
				ensureISA().then(function () { createMachine(name, options, null); if (ui) ui.refresh(); });
				return null;
			}
			return createMachine(name, options, null);
		},
		run: runActiveFor,
		isa: function () { return isa; }
	};

	/** 供外部（例如终端脚本）触发的运行入口 */
	function runActiveFor(name) {
		if (name) {
			var found = findMachine(name);
			if (!found) return false;
			activeName = found.name;
		}
		if (ui && ui.run) { ui.run(); return true; }
		var machine = activeMachine();
		if (!machine) return false;
		command([machine.name, 'run'], function (text, cls) {
			machine.log(String(text), toLogClass(cls));
		});
		return true;
	}

	registerTerminal();
	if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', registerTerminal, { once: true });
	global.addEventListener('load', registerTerminal);
})(window);
