/**
 * hayneko-arch32.js — Hayneko_Arch32S 虚拟机（浏览器移植版）
 * ==========================================================
 *
 * 这是 HaynekoArch32VM_python/ 里 vm.py + as.py 的 JavaScript 移植：
 *   - ISA 仍然从 hayneko_arch32S-v1.json 读取（单一事实来源，不抄一份指令表）
 *   - 解码 / 执行 / 中断 / 内存 / 磁盘 / I/O 端口与 vm.py 逐条对齐
 *   - 汇编器与 as.py 对齐（同样的伪指令、同样的操作数写法、同样的编码顺序）
 *
 * 与 vm.py 的差异（都是"文件系统"换成浏览器 API，逻辑不变）：
 *   - ROM / 磁盘是内存里的 Uint8Array，不再开文件句柄；磁盘默认 256KB 全零
 *   - 控制台输出走 onOutput 回调（页面显示），标准输入从 stdin 队列取字节
 *   - 随机数用 Math.random()（RANDOM 指令）
 *
 * 用法：
 *   HaynekoArch32.ISA.fetch('HaynekoArch32VM_python/hayneko_arch32S-v1.json')
 *     .then(function (isa) {
 *       var vm = new HaynekoArch32.VM({ isa: isa, memSize: 4096 });
 *       vm.loadRom(bytes);
 *       vm.step();
 *     });
 */
(function (global) {
	'use strict';

	/* ------------------------------------------------------------------ 常量 */

	var MASK32 = 0xFFFFFFFF;
	var MASK16 = 0xFFFF;
	var MASK8 = 0xFF;

	var FIELD_SIZES = {
		OPC: 8, SOP: 4, ISL: 4, GB1: 1, GB2: 2,
		DRG: 4, SR1: 4, SR2: 4, SR3: 4,
		DRC: 4, SRC: 4,
		DFR: 4, SF1: 4, SF2: 4, SF3: 4,
		IM8: 8, IM16: 16, I16: 16, I32: 32,
		OF8: 8, OF16: 16, O16: 16, O32: 32,
		AD8: 8, A16: 16, A32: 32,
		SCL: 4, PRT: 8, CR: 4
	};

	var FOUR_BIT_FIELDS = {
		DRG: 1, SR1: 1, SR2: 1, SR3: 1, DRC: 1, SRC: 1,
		DFR: 1, SF1: 1, SF2: 1, SF3: 1, SCL: 1, CR: 1, SOP: 1
	};

	var NIBBLE_LITERALS = {};
	for (var ni = 0; ni < 16; ni++) NIBBLE_LITERALS['0x' + ni.toString(16)] = ni;

	var SIGNED_FIELDS = { OF8: 1, OF16: 1, O16: 1, O32: 1 };

	var GPR_NAMES = [
		'x0', 'ra', 'rb', 'rc', 'rd', 'ri', 'bp', 'sp',
		'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15',
		'r16', 'r17', 'r18', 'r19', 'r20', 'r21', 'r22', 'r23',
		't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'
	];
	var GPR_ID = {};
	GPR_NAMES.forEach(function (name, i) { GPR_ID[name] = i; });

	var FPR_NAMES = [];
	for (var fi = 0; fi < 16; fi++) FPR_NAMES.push('f' + fi);
	for (var di = 0; di < 16; di++) FPR_NAMES.push('d' + di);
	var FPR_ID = {};
	FPR_NAMES.forEach(function (name, i) { FPR_ID[name] = i; });

	var CR_NAMES = ['cr0', 'cr1', 'cr2', 'cr3'];
	var CR_ID = {};
	CR_NAMES.forEach(function (name, i) { CR_ID[name] = i; });

	var FLAG_BITS = {
		zf: 0, cf: 1, of: 2, nf: 3, df: 4,
		flz: 5, flo: 6, flv: 7, if: 8, be: 12, ac: 13,
		xte: 16, bme: 17, cie: 18, vie: 24, prot: 30
	};

	/* 调试器里展示标志位的顺序（与 dbg.py 的 FLAG_DISPLAY 一致） */
	var FLAG_DISPLAY = ['zf', 'cf', 'of', 'nf', 'df', 'if', 'be', 'ac'];

	var INT_BRK = 0, INT_DIV = 1, INT_NMI = 2, INT_HLT = 3;
	var INT_MCC = 4, INT_MAV = 5, INT_UDI = 6, INT_PGF = 7;
	var SYSCALL_VECTOR = 0x40;

	var PORT_CONSOLE_BYTE = 0x00;
	var PORT_CONSOLE_INT = 0x01;
	var PORT_CONSOLE_IN = 0x02;
	var PORT_QUIT = 0x10;
	var PORT_DISK_READ = 0x20;
	var PORT_DISK_WRITE = 0x21;
	/* 256x256 小型显示屏（每个端口按大端收 4 个字节组成一个字） */
	var PORT_MONITOR_CTRL = 0x04;     /* MNTRCONTROL: [x(第1字节), y(第0字节), 高2字节空] */
	var PORT_MONITOR_COLOR = 0x05;    /* MNTRCOLOR  : [R(第3), G(第2), B(第1), refresh(第0)] */
	var MONITOR_SIZE = 256;

	var PREFIX_REX = 0xE0;
	var PREFIX_ISL = 0xD0;
	var PREFIX_BRH0 = 0xF2;
	var PREFIX_BRH1 = 0xF3;
	var PREFIX_LOCK = 0xF4;
	var PREFIX_XTU = 0xF5;
	var PREFIX_BMU = 0xF6;
	var PREFIX_DBI = 0xF0;
	var PREFIX_TBI = 0xF1;

	var DISK_SIZE = 256 * 1024;
	var ROM_SIZE = 1024;

	/* ------------------------------------------------------------- 小工具 */

	function u32(x) { return x >>> 0; }
	function i32(x) { return x | 0; }

	function signed(value, bits) {
		var sign = 1 << (bits - 1);
		if (value & sign) value -= (1 << bits);
		return value;
	}

	/* 取 bits 位无符号值的十六进制（32 位要绕开 JS 位运算的 int32 陷阱） */
	function maskedHex(value, bits) {
		var masked = bits >= 32 ? u32(value) : (u32(value) % Math.pow(2, bits));
		return masked.toString(16).toUpperCase();
	}

	function hex(value, width) {
		var text = u32(value).toString(16).toUpperCase();
		while (text.length < width) text = '0' + text;
		return text;
	}

	/* --------------------------------------------------------------- 异常 */

	function VMError(message) { Error.call(this, message); this.message = message; }
	VMError.prototype = Object.create(Error.prototype);
	VMError.prototype.name = 'VMError';
	VMError.prototype.constructor = VMError;

	function UndefinedInstruction(message) { VMError.call(this, message); }
	UndefinedInstruction.prototype = Object.create(VMError.prototype);
	UndefinedInstruction.prototype.name = 'UndefinedInstruction';

	function MemoryViolation(message) { VMError.call(this, message); }
	MemoryViolation.prototype = Object.create(VMError.prototype);
	MemoryViolation.prototype.name = 'MemoryViolation';

	function DivideByZero(message) { VMError.call(this, message); }
	DivideByZero.prototype = Object.create(VMError.prototype);
	DivideByZero.prototype.name = 'DivideByZero';

	/* HALT / 退出端口用的控制流信号（与 vm.py 的 HaltSignal 对应） */
	function HaltSignal(message) { this.message = message; }
	HaltSignal.prototype = Object.create(Error.prototype);
	HaltSignal.prototype.name = 'HaltSignal';

	function AsmError(message) { this.message = message; }
	AsmError.prototype = Object.create(Error.prototype);
	AsmError.prototype.name = 'AsmError';

	/* ------------------------------------------------------------ 指令定义 */

	function Instruction(name, category, data) {
		this.name = name;
		this.category = category;
		this.opcode = parseInt(data.opcode, 16);
		this.subOpcode = (data.sub_opcode === undefined || data.sub_opcode === null)
			? null : parseInt(data.sub_opcode, 16);
		this.length = data.length;
		this.format = (data.format || []).slice();
		this.modifyFlags = (data.modify_flags || []).slice();
		this.mode = data.mode;
		this.description = data.description || '';
		this.needsCoprocessor = data.needs_coprocessor;
		/* 按 format 推导的字节长度：CMP 之类 JSON 里 length 与 format 不符的，
		   统一以 format 为准（见 python 版 README 的设计约定 1） */
		this.byteLength = this.computeLength();
	}

	Instruction.prototype.computeLength = function () {
		var bits = 8;
		for (var i = 0; i < this.format.length; i++) {
			var token = this.format[i];
			if (token === 'OPC') continue;
			if (NIBBLE_LITERALS[token] !== undefined || FOUR_BIT_FIELDS[token]) bits += 4;
			else {
				if (FIELD_SIZES[token] === undefined) throw new VMError('未知字段: ' + token);
				bits += FIELD_SIZES[token];
			}
		}
		return bits / 8;
	};

	/* ------------------------------------------------------------------ ISA */

	function ISA(spec) {
		this.data = spec || {};
		this.instructions = {};        /* opcode * 16 + subOpcode -> Instruction */
		this.opcodeMap = {};           /* opcode -> [Instruction, ...] */
		this.byName = {};              /* name -> Instruction */
		this.byNameUpper = {};         /* 大写 name -> Instruction（汇编器大小写不敏感） */
		this.arch = this.data.architecture || {};
		this.flags = this.data.flags || {};
		this.statusFlags = this.data.status_flags || {};
		this.interruptVectors = this.data.interrupt_vectors || {};
		this.prefixes = this.data.prefixes || {};
		this.regs = this.data.registers || {};
		this.abi = this.data.ABI || {};
		this._build();
	}

	ISA.prototype._add = function (inst) {
		var key = (inst.opcode << 4) | (inst.subOpcode === null ? 0 : inst.subOpcode);
		/* 同一个 (opcode, sub) 里后面登记的覆盖前面的 —— 与 python dict 行为一致 */
		this.instructions[key] = inst;
		if (!this.opcodeMap[inst.opcode]) this.opcodeMap[inst.opcode] = [];
		this.opcodeMap[inst.opcode].push(inst);
		this.byName[inst.name] = inst;
		/* 汇编器按大写查表: 这样 vm vm1 inst nop 这种小写写法也能用 */
		this.byNameUpper[String(inst.name).toUpperCase()] = inst;
	};

	ISA.prototype._build = function () {
		var groups = this.data.instructions || {};
		Object.keys(groups).forEach(function (category) {
			var group = groups[category] || {};
			Object.keys(group).forEach(function (name) {
				this._add(new Instruction(name, category, group[name]));
			}, this);
		}, this);
		var pseudo = this.data.psuedo_instructions || {};
		Object.keys(pseudo).forEach(function (name) {
			var data = pseudo[name];
			if (data && data.opcode !== undefined) {
				this._add(new Instruction(name, 'psuedo', data));
			}
		}, this);
	};

	/** 按操作码（必要时结合子操作码）取指令定义，取不到返回 null */
	ISA.prototype.byOpcode = function (opcode, subOpcode) {
		var list = this.opcodeMap[opcode];
		if (!list || !list.length) return null;
		if (list.length === 1) return list[0];
		if (subOpcode === null || subOpcode === undefined) return null;
		return this.instructions[(opcode << 4) | subOpcode] || null;
	};

	ISA.prototype.flagBit = function (name) {
		name = String(name).toLowerCase();
		if (FLAG_BITS[name] !== undefined) return FLAG_BITS[name];
		var entry = this.flags[name] || this.statusFlags[name];
		if (entry) return entry.bit_position;
		throw new VMError('未知标志位: ' + name);
	};

	ISA.fromJSON = function (obj) { return new ISA(obj); };

	ISA.fetch = function (url) {
		return fetch(url, { credentials: 'same-origin' }).then(function (res) {
			if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + url);
			return res.json();
		}).then(function (json) { return new ISA(json); });
	};

	/* -------------------------------------------------------------- 解码结果 */

	function Decoded(inst, fields, length, prefixes, startIp, raw) {
		this.inst = inst;
		this.fields = fields;
		this.length = length;          /* 不含前缀的指令长度，与 python 一致 */
		this.prefixes = prefixes;
		this.startIp = startIp;        /* 含前缀的起始地址 */
		this.raw = raw;                /* Uint8Array，含前缀 */
	}

	/* ------------------------------------------------------------------- VM */

	function VM(options) {
		options = options || {};
		var isa = options.isa;
		if (!(isa instanceof ISA)) isa = new ISA(isa);
		this.isa = isa;

		this.memSize = options.memSize || 4096;          /* KB */
		this.memSizeBytes = this.memSize * 1024;
		if (this.memSize < 1 || this.memSize > 65536) {
			throw new VMError('内存大小必须在 1 到 65536 KB 之间');
		}
		this.entry = u32(options.entry || 0);
		this.syscallVector = (options.syscallVector === undefined ? SYSCALL_VECTOR : options.syscallVector) & 0xFF;

		this.gpr = new Array(32).fill(0);
		this.fpr = new Array(32).fill(0);
		this.cr = [0, 0, 0, 0];
		this.kernel = { mode: 0, status: 0, ip: 0, idt: 0 };
		this.mode = 0;
		this.ip = this.entry;
		this.nextIp = this.entry;    /* 中断入栈用的返回地址（step 里每步更新） */
		this.flags = 0;
		this.halted = false;
		this.quitCode = 0;
		this.instructionCount = 0;
		this.lastError = null;

		this.memory = new Uint8Array(this.memSizeBytes);
		this.disk = new Uint8Array(DISK_SIZE);
		this.romBytes = new Uint8Array(ROM_SIZE);

		if (options.rom) this.loadRom(options.rom);
		if (options.disk) this.loadDisk(options.disk);

		if (options.sp === undefined || options.sp === null) options.sp = this.memSizeBytes;
		this.spInit = u32(options.sp);
		this.gpr[GPR_ID.sp] = this.spInit;

		this.jumped = false;
		this.stdin = [];               /* 端口 0x02 的输入队列 */
		this.onOutput = null;          /* 控制台输出回调 */
		this.onTrace = null;           /* 逐条跟踪回调（调试器可选） */
		this.onFrame = null;           /* 显示屏刷新回调 */
		this.monitor = this._newMonitor();
		this.changes = { regs: null, mem: [], memMore: false };   /* 上一条指令实际改了什么 */
	}

	VM.prototype._newMonitor = function () {
		var pixels = MONITOR_SIZE * MONITOR_SIZE * 4;
		var buffer = new Uint8ClampedArray(pixels);
		var screen = new Uint8ClampedArray(pixels);
		for (var i = 0; i < pixels; i += 4) {
			buffer[i + 3] = 255;
			screen[i + 3] = 255;
		}
		return {
			width: MONITOR_SIZE,
			height: MONITOR_SIZE,
			buffer: buffer,            /* 写入的像素（未刷新也在这里） */
			screen: screen,            /* 已经刷新上屏的像素 */
			x: 0,
			y: 0,
			frames: 0,
			refreshAt: 0,
			shift: [0, 0],             /* 两个端口各自的大端移位寄存器 */
			pending: [0, 0],           /* 已收到的字节数 */
			wordCtrl: 0,
			wordColor: 0
		};
	};

	/* ------------------------------------------------------------ ROM/磁盘 */

	VM.prototype.loadRom = function (bytes) {
		var src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
		this.romBytes = new Uint8Array(ROM_SIZE);
		this.romBytes.set(src.subarray(0, Math.min(src.length, ROM_SIZE)));
		this.memory.set(this.romBytes.subarray(0, Math.min(ROM_SIZE, this.memSizeBytes)));
	};

	VM.prototype.loadDisk = function (bytes) {
		var src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
		this.disk = new Uint8Array(DISK_SIZE);
		this.disk.set(src.subarray(0, Math.min(src.length, DISK_SIZE)));
	};

	VM.prototype.feedInput = function (text) {
		var bytes = new TextEncoder().encode(String(text));
		for (var i = 0; i < bytes.length; i++) this.stdin.push(bytes[i]);
	};

	VM.prototype.reset = function (entry) {
		this.gpr = new Array(32).fill(0);
		this.fpr = new Array(32).fill(0);
		this.cr = [0, 0, 0, 0];
		this.kernel = { mode: 0, status: 0, ip: 0, idt: 0 };
		this.mode = 0;
		this.flags = 0;
		this.halted = false;
		this.quitCode = 0;
		this.instructionCount = 0;
		this.lastError = null;
		this.ip = (entry === undefined || entry === null) ? this.entry : u32(entry);
		this.nextIp = this.ip;
		this.memory = new Uint8Array(this.memSizeBytes);
		this.memory.set(this.romBytes.subarray(0, Math.min(ROM_SIZE, this.memSizeBytes)));
		this.gpr[GPR_ID.sp] = this.spInit;
		this.jumped = false;
		this.monitor = this._newMonitor();
	};

	/* -------------------------------------------------------------- 寄存器 */

	VM.prototype.readGpr = function (idx) { return this.gpr[idx & 31]; };

	/**
	 * 记录"这一步实际改了什么"（调试器标红用，按指令清空）：
	 *   changes.regs[下标] = 改之前的值
	 *   changes.mem         = 这一步写过的内存地址列表（最多留 CHANGES_MEM_MAX 个）
	 */
	var CHANGES_MEM_MAX = 64;
	VM.prototype._resetChanges = function () {
		if (!this.changes) this.changes = { regs: null, mem: [], memMore: false };
		this.changes.regs = null;
		this.changes.mem.length = 0;
		this.changes.memMore = false;
		/* 快照全部寄存器：这样 sp 这种被 PUSH/POP/CALL/RET 隐式改掉的也算数 */
		if (!this._gprSnap) this._gprSnap = new Uint32Array(32);
		for (var i = 0; i < 32; i++) this._gprSnap[i] = this.gpr[i];
	};

	/** 和快照比一比，把真正变了的寄存器和旧值记下来（结束一条指令时调用） */
	VM.prototype._collectChanges = function () {
		var snap = this._gprSnap;
		if (!snap) return;
		for (var i = 1; i < 32; i++) {          /* x0 恒为 0，不比 */
			if (snap[i] !== this.gpr[i]) {
				if (!this.changes.regs) this.changes.regs = {};
				this.changes.regs[i] = snap[i];
			}
		}
	};

	VM.prototype._noteMem = function (addr, size) {
		var c = this.changes;
		if (!c) return;
		if (c.mem.length >= CHANGES_MEM_MAX) { c.memMore = true; return; }
		c.mem.push({ addr: addr, size: size });
	};

	VM.prototype.writeGpr = function (idx, value) {
		var i = idx & 31;
		if (i === 0) return;            /* x0 恒为 0 */
		this.gpr[i] = u32(value);
	};
	VM.prototype.readFpr = function (idx) { return this.fpr[idx & 31]; };
	VM.prototype.writeFpr = function (idx, value) { this.fpr[idx & 31] = Math.fround(Number(value)); };
	VM.prototype.readCr = function (idx) { return this.cr[idx & 3]; };
	VM.prototype.writeCr = function (idx, value) { this.cr[idx & 3] = u32(value); };

	/* ----------------------------------------------------------------- 标志 */

	VM.prototype.getFlag = function (name) {
		var bit = FLAG_BITS[String(name).toLowerCase()];
		if (bit === undefined) throw new VMError('未知标志位: ' + name);
		return (this.flags >> bit) & 1;
	};

	VM.prototype.setFlag = function (name, value) {
		var bit = FLAG_BITS[String(name).toLowerCase()];
		if (bit === undefined) throw new VMError('未知标志位: ' + name);
		if (value) this.flags = u32(this.flags | (1 << bit));
		else this.flags = u32(this.flags & ~(1 << bit));
	};

	VM.prototype._flagsFromArith = function (result, cf, of) {
		result = u32(result);
		this.setFlag('zf', result === 0);
		this.setFlag('nf', (result >>> 31) & 1);
		this.setFlag('cf', cf);
		this.setFlag('of', of);
	};

	VM.prototype._flagsFromLogic = function (result) {
		result = u32(result);
		this.setFlag('zf', result === 0);
		this.setFlag('nf', (result >>> 31) & 1);
		this.setFlag('cf', 0);
		this.setFlag('of', 0);
	};

	VM.prototype._addWithFlags = function (a, b) {
		a = u32(a); b = u32(b);
		var sum = a + b;
		var result = u32(sum);
		var cf = sum > MASK32 ? 1 : 0;
		var sa = (a >>> 31) & 1, sb = (b >>> 31) & 1, sr = (result >>> 31) & 1;
		var of = (sa === sb && sr !== sa) ? 1 : 0;
		this._flagsFromArith(result, cf, of);
		return result;
	};

	VM.prototype._subWithFlags = function (a, b) {
		a = u32(a); b = u32(b);
		var result = u32(a - b);
		var cf = a < b ? 1 : 0;
		var sa = (a >>> 31) & 1, sb = (b >>> 31) & 1, sr = (result >>> 31) & 1;
		var of = (sa !== sb && sr !== sa) ? 1 : 0;
		this._flagsFromArith(result, cf, of);
		return result;
	};

	/* ----------------------------------------------------------------- 内存 */

	VM.prototype._checkAddr = function (addr) {
		addr = u32(addr);
		if (addr >= this.memSizeBytes) {
			throw new MemoryViolation('内存访问越界: 0x' + hex(addr, 8) +
				' (内存大小 0x' + this.memSizeBytes.toString(16).toUpperCase() + ')');
		}
		return addr;
	};

	VM.prototype.readMem8 = function (addr) {
		return this.memory[this._checkAddr(addr)];
	};

	VM.prototype.writeMem8 = function (addr, value) {
		this._noteMem(addr, 1);
		this.memory[this._checkAddr(addr)] = value & MASK8;
	};

	VM.prototype.readMem16 = function (addr) {
		addr = this._checkAddr(addr);
		if (addr + 2 > this.memSizeBytes) throw new MemoryViolation('内存访问越界: 0x' + hex(addr, 8));
		if (this.getFlag('be')) return u32((this.memory[addr] << 8) | this.memory[addr + 1]);
		return u32(this.memory[addr] | (this.memory[addr + 1] << 8));
	};

	VM.prototype.writeMem16 = function (addr, value) {
		this._noteMem(addr, 2);
		addr = this._checkAddr(addr);
		if (addr + 2 > this.memSizeBytes) throw new MemoryViolation('内存访问越界: 0x' + hex(addr, 8));
		value &= MASK16;
		if (this.getFlag('be')) {
			this.memory[addr] = (value >>> 8) & MASK8;
			this.memory[addr + 1] = value & MASK8;
		} else {
			this.memory[addr] = value & MASK8;
			this.memory[addr + 1] = (value >>> 8) & MASK8;
		}
	};

	VM.prototype.readMem32 = function (addr) {
		addr = this._checkAddr(addr);
		if (addr + 4 > this.memSizeBytes) throw new MemoryViolation('内存访问越界: 0x' + hex(addr, 8));
		var m = this.memory;
		if (this.getFlag('be')) {
			return u32((m[addr] << 24) | (m[addr + 1] << 16) | (m[addr + 2] << 8) | m[addr + 3]);
		}
		return u32(m[addr] | (m[addr + 1] << 8) | (m[addr + 2] << 16) | (m[addr + 3] << 24));
	};

	VM.prototype.writeMem32 = function (addr, value) {
		this._noteMem(addr, 4);
		addr = this._checkAddr(addr);
		if (addr + 4 > this.memSizeBytes) throw new MemoryViolation('内存访问越界: 0x' + hex(addr, 8));
		value = u32(value);
		var m = this.memory;
		if (this.getFlag('be')) {
			m[addr] = (value >>> 24) & MASK8;
			m[addr + 1] = (value >>> 16) & MASK8;
			m[addr + 2] = (value >>> 8) & MASK8;
			m[addr + 3] = value & MASK8;
		} else {
			m[addr] = value & MASK8;
			m[addr + 1] = (value >>> 8) & MASK8;
			m[addr + 2] = (value >>> 16) & MASK8;
			m[addr + 3] = (value >>> 24) & MASK8;
		}
	};

	/** 往内存里写一段字节（汇编器 / 调试器用） */
	VM.prototype.writeBytes = function (addr, bytes) {
		addr = this._checkAddr(addr);
		var src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		if (addr + src.length > this.memSizeBytes) throw new MemoryViolation('写入越界: 0x' + hex(addr, 8));
		this.memory.set(src, addr);
	};

	/* ------------------------------------------------------------------- 栈 */

	VM.prototype.push32 = function (value) {
		var sp = u32(this.gpr[GPR_ID.sp] - 4);
		this.writeMem32(sp, value);
		this.gpr[GPR_ID.sp] = sp;
	};

	VM.prototype.pop32 = function () {
		var sp = this.gpr[GPR_ID.sp];
		var value = this.readMem32(sp);
		this.gpr[GPR_ID.sp] = u32(sp + 4);
		return value;
	};

	/* ----------------------------------------------------------------- 磁盘 */

	VM.prototype.readDisk = function (position, length) {
		position = u32(position);
		var out = new Uint8Array(Math.max(0, length));
		for (var i = 0; i < out.length; i++) {
			var at = position + i;
			out[i] = at < DISK_SIZE ? this.disk[at] : 0;
		}
		return out;
	};

	VM.prototype.writeDisk = function (position, bytes) {
		position = u32(position);
		var src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		for (var i = 0; i < src.length; i++) {
			var at = position + i;
			if (at >= DISK_SIZE) break;
			this.disk[at] = src[i];
		}
	};

	/* ----------------------------------------------------------------- 端口 */

	VM.prototype.readPort = function (port) {
		port &= MASK8;
		if (port === PORT_CONSOLE_IN) {
			if (this.stdin.length) return this.stdin.shift() & MASK8;
			return 0;
		}
		return 0;
	};

	VM.prototype.writePort = function (port, value) {
		port &= MASK8;
		value &= MASK8;
		var self = this;
		function emit(text) {
			if (self.onOutput) self.onOutput(text);
		}
		if (port === PORT_CONSOLE_BYTE) {
			emit(String.fromCharCode(value));
		} else if (port === PORT_CONSOLE_INT) {
			emit(String(this.gpr[GPR_ID.ri]));
		} else if (port === PORT_QUIT) {
			this.quitCode = this.gpr[GPR_ID.ri];
			this.halted = true;
			throw new HaltSignal('退出端口: 退出码 ' + this.quitCode);
		} else if (port === PORT_DISK_READ) {
			var base = this.gpr[GPR_ID.ri];
			var lba = this.gpr[GPR_ID.rd];
			var data = this.readDisk(u32(lba * 512), 512);
			for (var i = 0; i < data.length; i++) this.writeMem8(base + i, data[i]);
		} else if (port === PORT_DISK_WRITE) {
			var wbase = this.gpr[GPR_ID.ri];
			var wlba = this.gpr[GPR_ID.rd];
			var chunk = this.memory.slice(u32(wbase), u32(wbase) + 512);
			this.writeDisk(u32(wlba * 512), chunk);
		} else if (port === PORT_MONITOR_CTRL || port === PORT_MONITOR_COLOR) {
			this.monitorByte(port, value);
		}
		/* 未定义端口：忽略 */
	};

	/* ------------------------------------------------------------ 小型显示屏 */

	/**
	 * 显示屏总线：OUT 每次送 1 个字节，同一端口每收满 4 个字节按**大端**拼成一个 32 位字。
	 *   MNTRCONTROL (0x04): [x(第1字节), y(第0字节), 高 2 字节空] —— 设置光标
	 *   MNTRCOLOR   (0x05): [R(第3字节), G(第2字节), B(第1字节), refresh(第0字节)]
	 *     refresh = 0x00 -> 只写进缓冲区（不上屏）
	 *     refresh = 0xFF -> 写进缓冲区并立即刷新屏幕
	 *     其他值          -> 整帧数据丢弃
	 */
	VM.prototype.monitorByte = function (port, byte) {
		var mon = this.monitor;
		var index = port === PORT_MONITOR_CTRL ? 0 : 1;
		mon.shift[index] = u32((mon.shift[index] << 8) | (byte & MASK8));
		mon.pending[index] += 1;
		if (mon.pending[index] < 4) return;
		mon.pending[index] = 0;
		var word = mon.shift[index];
		if (port === PORT_MONITOR_CTRL) {
			mon.wordCtrl = word;
			mon.x = (word >>> 8) & MASK8;      /* 第1字节 = x */
			mon.y = word & MASK8;              /* 第0字节 = y */
			return;
		}
		mon.wordColor = word;
		var refresh = word & MASK8;
		if (refresh !== 0x00 && refresh !== 0xFF) return;   /* 未定义 -> 丢弃 */
		var r = (word >>> 24) & MASK8;
		var g = (word >>> 16) & MASK8;
		var b = (word >>> 8) & MASK8;
		var off = ((mon.y * MONITOR_SIZE) + mon.x) * 4;
		mon.buffer[off] = r;
		mon.buffer[off + 1] = g;
		mon.buffer[off + 2] = b;
		mon.buffer[off + 3] = 255;
		if (refresh === 0xFF) this.monitorFlush();
	};

	VM.prototype.monitorFlush = function () {
		var mon = this.monitor;
		mon.screen.set(mon.buffer);
		mon.frames += 1;
		mon.refreshAt = this.instructionCount;
		if (this.onFrame) this.onFrame(mon);
	};

	/** 清屏（缓冲与屏幕都清成黑色），调试器用 */
	VM.prototype.monitorClear = function () {
		var mon = this.monitor;
		for (var i = 0; i < mon.buffer.length; i += 4) {
			mon.buffer[i] = 0;
			mon.buffer[i + 1] = 0;
			mon.buffer[i + 2] = 0;
			mon.buffer[i + 3] = 255;
			mon.screen[i] = 0;
			mon.screen[i + 1] = 0;
			mon.screen[i + 2] = 0;
			mon.screen[i + 3] = 255;
		}
		mon.x = 0;
		mon.y = 0;
		mon.pending[0] = 0;
		mon.pending[1] = 0;
		mon.shift[0] = 0;
		mon.shift[1] = 0;
	};

	/* ----------------------------------------------------------------- 中断 */

	VM.prototype.interrupt = function (vector, fromException) {
		var idt = this.kernel.idt;
		if (idt === 0 || idt >= this.memSizeBytes) {
			/* vm.py 在这里抛的是 RuntimeError（不参与 VMError 的异常路由），保持一致 */
			var err = new Error('IDT 未配置 (idt=0x' + idt.toString(16).toUpperCase() +
				')，无法响应中断向量 ' + vector);
			err.name = 'RuntimeError';
			throw err;
		}
		var handler = this.readMem32(u32(idt + vector * 4));
		this.push32(this.flags);
		/* 软件中断压"下一条指令"的地址（否则 IRET 回到 INT 自己 → 死循环）；
		   异常压出错那条指令的地址，处理程序可以修正后重试（x86 fault 语义） */
		this.push32(fromException ? this.ip : this.nextIp);
		this.ip = u32(handler);
		this.jumped = true;
	};

	VM.prototype.fault = function (vector, message) {
		var idt = this.kernel.idt;
		if (idt !== 0 && idt < this.memSizeBytes) {
			this.interrupt(vector, true);
			return 'routed';
		}
		this.halted = true;
		this.lastError = '致命异常 #' + vector + ': ' + message;
		throw new HaltSignal(this.lastError);
	};

	/* ----------------------------------------------------------------- 解码 */

	VM.prototype.isPrefix = function (b) {
		if (b >= PREFIX_REX && b <= PREFIX_REX + 0x0F) return 'rex';
		if (b >= PREFIX_ISL && b <= PREFIX_ISL + 0x0F) return 'isl';
		if (b === PREFIX_LOCK) return 'lock';
		if (b === PREFIX_BRH0 || b === PREFIX_BRH1) return 'brh';
		if (b === PREFIX_XTU) return 'xtu';
		if (b === PREFIX_BMU) return 'bmu';
		if (b === PREFIX_DBI) return 'dbi';
		if (b === PREFIX_TBI) return 'tbi';
		return null;
	};

	VM.prototype.fetchDecode = function () {
		var start = this.ip;
		var ip = this.ip;
		var prefixes = { rex: 0, isl: 0, lock: false, brh: 0, xtu: false, bmu: false, dbi: false, tbi: false };
		var guard = 0;
		while (true) {
			if (ip >= this.memSizeBytes) throw new MemoryViolation('指令指针越界: 0x' + hex(ip, 8));
			var byte = this.memory[ip];
			var kind = this.isPrefix(byte);
			if (kind === null) break;
			if (kind === 'rex') prefixes.rex = byte & 0x0F;
			else if (kind === 'isl') prefixes.isl = byte & 0x0F;
			else if (kind === 'brh') prefixes.brh = byte & 0x01;
			else prefixes[kind] = true;
			ip += 1;
			if (++guard > 32) throw new UndefinedInstruction('前缀过多 @ 0x' + hex(start, 8));
		}

		var opcode = this.memory[ip];
		var list = this.isa.opcodeMap[opcode];
		if (!list || !list.length) {
			throw new UndefinedInstruction('未定义的操作码 0x' + hex(opcode, 2) + ' @ 0x' + hex(ip, 8));
		}

		var inst;
		if (list.length > 1) {
			if (ip + 1 >= this.memSizeBytes) throw new MemoryViolation('指令越界 @ 0x' + hex(ip, 8));
			if (opcode === 0x5B) {
				/* COPYIP 与 SAR 共用 0x5B：字节1低半字节为 0 时是 COPYIP */
				var low = this.memory[ip + 1] & 0x0F;
				inst = this.isa.byName[low === 0 ? 'COPYIP' : 'SAR'];
			} else {
				var sub = this.memory[ip + 1] & 0x0F;
				inst = this.isa.instructions[(opcode << 4) | sub] || null;
				if (!inst) {
					throw new UndefinedInstruction('未定义的子操作码 0x' + hex(opcode, 2) + '/0x' +
						sub.toString(16).toUpperCase() + ' @ 0x' + hex(ip, 8));
				}
			}
		} else {
			inst = list[0];
		}

		var length = inst.byteLength;
		var end = ip + length;
		if (end > this.memSizeBytes) throw new MemoryViolation('指令长度越界 @ 0x' + hex(ip, 8));

		var fields = this.parseFields(inst, ip);
		this.applyRex(fields, prefixes.rex);
		var raw = this.memory.slice(start, end);
		return new Decoded(inst, fields, length, prefixes, start, raw);
	};

	VM.prototype.parseFields = function (inst, ip) {
		var mem = this.memory;
		var fields = {};
		var off = 1;
		var pendingField = null;
		var pendingHigh = 0;

		for (var i = 0; i < inst.format.length; i++) {
			var token = inst.format[i];
			if (token === 'OPC') continue;
			if (NIBBLE_LITERALS[token] !== undefined) {
				var literal = NIBBLE_LITERALS[token];
				if (pendingField === null) {
					pendingField = token;
					pendingHigh = literal;
				} else {
					if (NIBBLE_LITERALS[pendingField] === undefined) fields[pendingField] = pendingHigh;
					off += 1;
					pendingField = null;
				}
			} else if (FOUR_BIT_FIELDS[token]) {
				if (pendingField === null) {
					pendingField = token;
					pendingHigh = (mem[ip + off] >>> 4) & 0x0F;
				} else {
					var lowNibble = mem[ip + off] & 0x0F;
					if (NIBBLE_LITERALS[pendingField] === undefined) fields[pendingField] = pendingHigh;
					fields[token] = lowNibble;
					off += 1;
					pendingField = null;
				}
			} else {
				var size = FIELD_SIZES[token] / 8;
				var value = 0;
				for (var k = 0; k < size; k++) value |= mem[ip + off + k] << (8 * k);
				value = u32(value);
				if (SIGNED_FIELDS[token]) value = signed(value, size * 8);
				fields[token] = value;
				off += size;
				pendingField = null;
			}
		}
		return fields;
	};

	VM.prototype.applyRex = function (fields, rex) {
		if (!rex) return;
		var mapping = { DRG: 0x8, SR1: 0x4, SR2: 0x2, SR3: 0x1 };
		Object.keys(mapping).forEach(function (name) {
			if (fields[name] !== undefined && (rex & mapping[name])) {
				fields[name] = (fields[name] + 16) & 31;
			}
		});
	};

	VM.prototype.disasm = function (addr) {
		var saved = this.ip;
		this.ip = u32(addr);
		try {
			return this.fetchDecode();
		} finally {
			this.ip = saved;
		}
	};

	/* 向前找恰好结束于 addr 的指令起始地址（变长指令集的线性回扫） */
	VM.prototype.findPrevInstruction = function (addr) {
		var low = Math.max(0, addr - 16);
		for (var a = addr - 1; a >= low; a--) {
			var dec;
			try { dec = this.disasm(a); } catch (err) { continue; }
			if (a + dec.raw.length === addr) return a;
		}
		return null;
	};

	VM.prototype.disasmBlock = function (ip, before, after) {
		if (before === undefined) before = 14;
		if (after === undefined) after = 14;
		var starts = [u32(ip)];
		var cur = u32(ip);
		for (var i = 0; i < before; i++) {
			var prev = this.findPrevInstruction(cur);
			if (prev === null) break;
			starts.push(prev);
			cur = prev;
		}
		starts.reverse();
		var lines = [];
		var addr = starts.length ? starts[0] : u32(ip);
		var count = 0;
		while (count < before + after + 1 && addr < this.memSizeBytes) {
			var dec = null;
			try { dec = this.disasm(addr); } catch (err) { dec = null; }
			lines.push({ addr: addr, dec: dec });
			addr = dec ? addr + dec.raw.length : addr + 1;
			count += 1;
		}
		return lines;
	};

	/* -------------------------------------------------------------- 控制流 */

	VM.prototype.jump = function (target) {
		this.ip = u32(target);
		this.jumped = true;
	};

	VM.prototype.branchCond = function (cond, offset) {
		if (cond) this.jump(this.ip + offset);
	};

	/* ---------------------------------------------------------------- 执行 */

	VM.prototype.step = function () {
		if (this.halted) return false;
		this._resetChanges();            /* 每次执行前清空"这一步改了什么" */
		this.jumped = false;
		var dec = this.fetchDecode();
		/* 中断入栈用的"下一条指令"地址（raw 含前缀，所以用它而不是 dec.length） */
		this.nextIp = u32(dec.startIp + dec.raw.length);
		if (this.onTrace) this.onTrace(dec);

		try {
			var handler = this['_i_' + dec.inst.name.replace(/ /g, '_')];
			if (typeof handler !== 'function') {
				throw new UndefinedInstruction('指令 ' + dec.inst.name + ' 未实现 (0x' + hex(dec.inst.opcode, 2) + ')');
			}
			handler.call(this, dec);
		} catch (err) {
			if (err instanceof HaltSignal) throw err;
			if (err instanceof DivideByZero) this.fault(INT_DIV, '除零错误');
			else if (err instanceof MemoryViolation) this.fault(INT_MAV, err.message);
			else if (err instanceof UndefinedInstruction) this.fault(INT_UDI, err.message);
			else throw err;
		}

		/* 用 raw 长度（含 REX 等前缀）；dec.length 只是指令本体长度 */
		if (!this.jumped) this.ip = u32(this.ip + dec.raw.length);
		this.instructionCount += 1;
		this._collectChanges();
		return !this.halted;
	};

	/**
	 * 直接执行一条已解析的指令（调试器 "#立即执行" 用）：
	 * 不取指、不把指令写进内存 / ROM、跑完也不推进 ip（jmp / call 这类自己会改 ip 的按语义走）。
	 * @param {{inst: object, fields: object, raw: Uint8Array}} spec
	 * @returns {{regs: number[]}} 被改动的通用寄存器下标
	 */
	VM.prototype.execDirect = function (spec) {
		var dec = {
			inst: spec.inst,
			fields: spec.fields,
			raw: spec.raw instanceof Uint8Array ? spec.raw : new Uint8Array(spec.raw || []),
			length: spec.inst.byteLength,
			startIp: this.ip
		};
		this._resetChanges();
		var before = this.gpr.slice();
		this.jumped = false;
		this.nextIp = this.ip;                  /* 之后若发生中断，返回地址就是当前 ip */
		if (this.onTrace) this.onTrace(dec);
		try {
			var handler = this['_i_' + dec.inst.name.replace(/ /g, '_')];
			if (typeof handler !== 'function') {
				throw new UndefinedInstruction('指令 ' + dec.inst.name + ' 未实现');
			}
			handler.call(this, dec);
		} catch (err) {
			if (err instanceof HaltSignal) throw err;
			if (err instanceof DivideByZero) this.fault(INT_DIV, '除零错误');
			else if (err instanceof MemoryViolation) this.fault(INT_MAV, err.message);
			else if (err instanceof UndefinedInstruction) this.fault(INT_UDI, err.message);
			else throw err;
		}
		this.instructionCount += 1;
		this._collectChanges();
		var changed = [];
		for (var i = 0; i < 32; i++) if (this.gpr[i] !== before[i]) changed.push(i);
		return { regs: changed };
	};

	VM.prototype.run = function (maxSteps) {
		var steps = 0;
		try {
			while (!this.halted) {
				if (maxSteps && steps >= maxSteps) return true;
				this.step();
				steps += 1;
			}
		} catch (err) {
			if (err instanceof HaltSignal) {
				this.lastError = err.message;
				return false;
			}
			throw err;
		}
		return true;
	};

	/* ------------------------------------------------------------ 反汇编文本 */

	/** NOP2..NOP15 是"填充"指令：操作数字段只是占位，反汇编只显示助记符 */
	function isPaddingInstruction(name) {
		return /^NOP\d+$/.test(String(name));
	}

	VM.prototype.formatOperands = function (inst, fields) {
		var parts = [];
		if (isPaddingInstruction(inst.name)) {
			var bare = String(inst.name);
			while (bare.length < 12) bare += ' ';
			return bare + ' ';
		}
		for (var i = 0; i < inst.format.length; i++) {
			var token = inst.format[i];
			if (token === 'OPC') continue;
			if (NIBBLE_LITERALS[token] !== undefined || token === 'SOP') continue;
			var value = fields[token];
			if (token === 'DRG' || token === 'SR1' || token === 'SR2' || token === 'SR3') {
				parts.push(GPR_NAMES[value & 31]);
			} else if (token === 'DRC' || token === 'SRC' || token === 'CR') {
				parts.push(CR_NAMES[value & 3]);
			} else if (token === 'DFR' || token === 'SF1' || token === 'SF2' || token === 'SF3') {
				parts.push(FPR_NAMES[value & 31]);
			} else if (token === 'SCL') {
				parts.push(String(value));
			} else if (token === 'IM8' || token === 'IM16' || token === 'I16' || token === 'I32') {
				parts.push('0x' + maskedHex(value, FIELD_SIZES[token]));
			} else if (token === 'OF8' || token === 'OF16' || token === 'O16' || token === 'O32') {
				parts.push(String(value));
			} else if (token === 'A16' || token === 'A32' || token === 'AD8') {
				parts.push('0x' + maskedHex(value, FIELD_SIZES[token]));
			} else if (token === 'PRT') {
				parts.push('port 0x' + value.toString(16).toUpperCase());
			}
		}
		/* 与 vm.py 的 _format_operands 完全一致：助记符左对齐到 12 列 */
		var mnemonic = String(inst.name);
		while (mnemonic.length < 12) mnemonic += ' ';
		return mnemonic + ' ' + parts.join(', ');
	};

	VM.prototype.disasmText = function (dec) {
		return this.formatOperands(dec.inst, dec.fields);
	};

	/* 只写内存、不写目的寄存器的指令（标红"将要被修改"时会用到） */
	var MEM_WRITE_INSTS = { ST: 1, STB: 1, STW: 1, STD: 1, PUSH: 1, PUSHIMMW: 1, CALL: 1, CALLR: 1 };
	/* 目的寄存器字段并不是"被写"的指令（地址 / 端口 / 只读标志位之类） */
	var NO_REG_DST_INSTS = {
		CMP: 1, TEST: 1, OUT: 1, JMP: 1, JMPR: 1, JMPFAR: 1, JZ: 1, JNZ: 1, JC: 1, JNC: 1,
		JO: 1, JNO: 1, JN: 1, JNN: 1, JL: 1, JGE: 1, JA: 1, JBE: 1, JLE: 1, JAG: 1,
		RET: 1, IRET: 1, SYSRET: 1, HALT: 1, NOP: 1, SETIDT: 1, MODIDT: 1, INT: 1, SYSCALL: 1
	};

	/**
	 * 这条指令执行后会改写什么（调试器标红"将要被修改"的寄存器 / 内存）。
	 * @returns {{regs: number[], mem: number|null, port: number|null, preview: object|null}}
	 */
	VM.prototype.writeTargets = function (dec) {
		var out = { regs: [], mem: null, port: null, preview: null };
		if (!dec || !dec.inst || !dec.fields) return out;
		var name = dec.inst.name;
		var f = dec.fields;
		if (name === 'OUT' || name === 'OUTB' || name === 'OUTW') {
			out.port = f.PRT === undefined ? null : f.PRT;
			return out;
		}
		/* 有一部分指令把寄存器写进了助记符（"PUSH ra" / "POP r9"），字段里没有 DRG */
		var named = /^(PUSH|PUSHIMMW|POP)\s+(\S+)$/.exec(name);
		if (named && GPR_ID[named[2].toLowerCase()] !== undefined) {
			if (named[1] === 'POP') out.regs.push(GPR_ID[named[2].toLowerCase()]);
			else out.mem = u32(this.gpr[GPR_ID.sp] - 4);
			out.regs.push(GPR_ID.sp);          /* 顺带 sp 也会变 */
			return out;
		}
		if (name === 'CALL' || name === 'CALLR' || name === 'RET' || name === 'IRET' || name === 'SYSRET') {
			out.regs.push(GPR_ID.sp);
		}
		if (MEM_WRITE_INSTS[name]) {
			if (name === 'PUSH' || name === 'PUSHIMMW' || name === 'CALL' || name === 'CALLR') {
				out.mem = u32(this.gpr[GPR_ID.sp] - 4);
			} else if (f.DRG !== undefined) {
				out.mem = u32(this.readGpr(f.DRG) + (f.OF8 === undefined ? 0 : f.OF8));   /* OF8 解码时已符号扩展 */
			}
			return out;
		}
		if (f.DRG === undefined || NO_REG_DST_INSTS[name]) return out;
		out.regs.push(f.DRG);
		if ((name === 'MUL' || name === 'IMUL' || name === 'DIV' || name === 'IDIV') && f.SR3 !== undefined) out.regs.push(f.SR3);
		var v = null;
		if (name === 'IMM' && f.I32 !== undefined) v = f.I32;
		else if (name === 'IMMB' && f.IM8 !== undefined) v = f.IM8;
		else if (name === 'MOV' && f.SR1 !== undefined) v = this.readGpr(f.SR1);
		else if (name === 'ADDIB' && f.IM8 !== undefined) v = u32(this.readGpr(f.SR1) + f.IM8);
		else if (name === 'SUBIB' && f.IM8 !== undefined) v = u32(this.readGpr(f.SR1) - f.IM8);
		else if (name === 'ADDIDW' && f.I32 !== undefined) v = u32(this.readGpr(f.SR1) + f.I32);
		else if (name === 'ANDI' && f.IM8 !== undefined) v = u32(this.readGpr(f.SR1) & f.IM8);
		if (v !== null) {
			out.preview = {};
			out.preview[out.regs[0]] = u32(v);
		}
		return out;
	};

	/** 调试器用：把助记符与操作数拆开（页面自己排版，不依赖空格对齐） */
	VM.prototype.disasmParts = function (dec) {
		var text = this.formatOperands(dec.inst, dec.fields);
		var name = String(dec.inst.name);
		return { mnemonic: name, operands: text.slice(name.length).trim() };
	};

	/* ---------------------------------------------------------------- 快照 */

	VM.prototype.snapshot = function () {
		return {
			ip: this.ip,
			flags: this.flags,
			gpr: this.gpr.slice(),
			fpr: this.fpr.slice(),
			cr: this.cr.slice(),
			mode: this.mode,
			idt: this.kernel.idt,
			halted: this.halted,
			quitCode: this.quitCode,
			instructionCount: this.instructionCount,
			lastError: this.lastError,
			sp: this.gpr[GPR_ID.sp]
		};
	};

	/* ==========================================================================
	   指令处理器 —— 与 vm.py 的 InstructionHandlers 一一对应
	   ======================================================================== */

	var P = VM.prototype;

	/* ------------------------------------------------------------- control */

	P._i_NOP = function () {};
	P._i_ENTR = function () { this.writeGpr(GPR_ID.bp, this.readGpr(GPR_ID.sp)); };
	P._i_LEAV = function () { this.writeGpr(GPR_ID.sp, this.readGpr(GPR_ID.bp)); };

	P._i_CMP = function (dec) {
		this._subWithFlags(this.readGpr(dec.fields.SR1), this.readGpr(dec.fields.SR2));
	};
	P._i_JMP = function (dec) { this.jump(dec.fields.A16); };
	P._i_JMPR = function (dec) { this.jump(this.readGpr(dec.fields.DRG)); };
	P._i_JMPFAR = function (dec) { this.jump(dec.fields.A32); };
	P._i_CALL = function (dec) {
		this.push32(dec.startIp + dec.raw.length);
		this.jump(dec.fields.A16);
	};
	P._i_CALLR = function (dec) {
		this.push32(dec.startIp + dec.raw.length);
		this.jump(this.readGpr(dec.fields.DRG));
	};
	P._i_RET = function () { this.jump(this.pop32()); };
	P._i_IMM = function (dec) { this.writeGpr(dec.fields.DRG, dec.fields.I32); };
	P._i_IMMB = function (dec) { this.writeGpr(dec.fields.DRG, dec.fields.IM8 & MASK8); };
	P._i_IMMBSX = function (dec) { this.writeGpr(dec.fields.DRG, signed(dec.fields.IM8 & MASK8, 8)); };
	P._i_LEA = function (dec) {
		this.writeGpr(dec.fields.DRG, u32(this.readGpr(dec.fields.SR1) + dec.fields.OF8));
	};
	P._i_LEASC = function (dec) {
		var f = dec.fields;
		this.writeGpr(f.DRG, u32(this.readGpr(f.SR1) + this.readGpr(f.SR2) * f.SCL + f.OF8));
	};
	P._i_CLI = function () { this.setFlag('if', 0); };
	P._i_STI = function () { this.setFlag('if', 1); };
	P._i_COPYIP = function (dec) { this.writeGpr(dec.fields.DRG, dec.startIp); };

	for (var nopIndex = 2; nopIndex <= 15; nopIndex++) P['_i_NOP' + nopIndex] = function () {};

	/* --------------------------------------------------------------- stack */

	P._i_PUSH = function (dec) { this.push32(this.readGpr(dec.fields.DRG)); };
	P._i_POP = function (dec) { this.writeGpr(dec.fields.DRG, this.pop32()); };

	[['ra', 1], ['rb', 2], ['rc', 3], ['rd', 4], ['ri', 5], ['bp', 6]].forEach(function (pair) {
		P['_i_PUSH_' + pair[0]] = function () { this.push32(this.readGpr(pair[1])); };
		P['_i_POP_' + pair[0]] = function () { this.writeGpr(pair[1], this.pop32()); };
	});

	P._i_PUSHIMMB = function (dec) { this.push32(dec.fields.IM8 & MASK8); };
	P._i_PUSHIMMW = function (dec) { this.push32(dec.fields.IM16 & MASK16); };
	P._i_PUSHIMMDW = function (dec) { this.push32(dec.fields.I32); };
	P._i_ADDSP = function (dec) {
		this.writeGpr(GPR_ID.sp, u32(this.gpr[GPR_ID.sp] + signed(dec.fields.IM8 & MASK8, 8)));
	};
	P._i_SUBSP = function (dec) {
		this.writeGpr(GPR_ID.sp, u32(this.gpr[GPR_ID.sp] - signed(dec.fields.IM8 & MASK8, 8)));
	};
	P._i_PUSHF = function () { this.push32(this.flags); };
	P._i_POPF = function () { this.flags = u32(this.pop32()); };
	P._i_PUSHIP = function (dec) { this.push32(dec.startIp); };
	P._i_LDSTVAL = function (dec) {
		this.writeGpr(dec.fields.DRG, this.readMem32(u32(this.gpr[GPR_ID.sp] + dec.fields.OF8)));
	};
	P._i_STSTVAL = function (dec) {
		this.writeMem32(u32(this.gpr[GPR_ID.sp] + dec.fields.OF8), this.readGpr(dec.fields.DRG));
	};
	P._i_LDSTVALOW = function (dec) {
		this.writeGpr(dec.fields.DRG, this.readMem32(u32(this.gpr[GPR_ID.sp] + dec.fields.OF16)));
	};
	P._i_STSTVALOW = function (dec) {
		this.writeMem32(u32(this.gpr[GPR_ID.sp] + dec.fields.OF16), this.readGpr(dec.fields.DRG));
	};
	P._i_PUSHTR = function (dec) {
		var f = dec.fields;
		this.push32(this.readGpr(f.SR1));
		this.push32(this.readGpr(f.SR2));
		this.push32(this.readGpr(f.SR3));
	};
	P._i_POPTR = function (dec) {
		var f = dec.fields;
		[f.DRG, f.SR1, f.SR2].forEach(function (reg) { this.writeGpr(reg, this.pop32()); }, this);
	};

	/* ------------------------------------------------------------ arithmetic */

	P._i_ADD = function (dec) {
		var f = dec.fields;
		this.writeGpr(f.DRG, this._addWithFlags(this.readGpr(f.SR1), this.readGpr(f.SR2)));
	};
	P._i_SUB = function (dec) {
		var f = dec.fields;
		this.writeGpr(f.DRG, this._subWithFlags(this.readGpr(f.SR1), this.readGpr(f.SR2)));
	};
	P._i_INC = function (dec) {
		this.writeGpr(dec.fields.DRG, this._addWithFlags(this.readGpr(dec.fields.SR1), 1));
	};
	P._i_DEC = function (dec) {
		this.writeGpr(dec.fields.DRG, this._subWithFlags(this.readGpr(dec.fields.SR1), 1));
	};
	P._i_NEG = function (dec) {
		var v = this.readGpr(dec.fields.SR1);
		var result = u32(0 - v);
		this._flagsFromArith(result, v !== 0 ? 1 : 0, v === 0x80000000 ? 1 : 0);
		this.writeGpr(dec.fields.DRG, result);
	};
	P._i_ABS = function (dec) {
		var v = this.readGpr(dec.fields.SR1);
		this.writeGpr(dec.fields.DRG, (v & 0x80000000) ? u32(0 - v) : v);
		this._flagsFromArith((v & 0x80000000) ? u32(0 - v) : v, 0, 0);
	};
	P._i_INC_rc = function () { this.writeGpr(3, this._addWithFlags(this.readGpr(3), 1)); };
	P._i_DEC_rc = function () { this.writeGpr(3, this._subWithFlags(this.readGpr(3), 1)); };
	P._i_ADDIB = function (dec) {
		var f = dec.fields;
		this.writeGpr(f.DRG, this._addWithFlags(this.readGpr(f.SR1), f.IM8 & MASK8));
	};
	P._i_SUBIB = function (dec) {
		var f = dec.fields;
		this.writeGpr(f.DRG, this._subWithFlags(this.readGpr(f.SR1), f.IM8 & MASK8));
	};
	P._i_ADDIDW = function (dec) {
		var f = dec.fields;
		this.writeGpr(f.DRG, this._addWithFlags(this.readGpr(f.SR1), f.I32));
	};
	P._i_SUBIDW = function (dec) {
		var f = dec.fields;
		this.writeGpr(f.DRG, this._subWithFlags(this.readGpr(f.SR1), f.I32));
	};
	P._i_MUL = function (dec) {
		var f = dec.fields;
		var product = BigInt(this.readGpr(f.SR1)) * BigInt(this.readGpr(f.SR2));
		var low = Number(product & 0xFFFFFFFFn) >>> 0;
		var high = Number((product >> 32n) & 0xFFFFFFFFn) >>> 0;
		this.writeGpr(f.DRG, low);
		this.writeGpr(f.SR3, high);
		this._flagsFromArith(low, high !== 0 ? 1 : 0, high !== 0 ? 1 : 0);
	};
	P._i_DIV = function (dec) {
		var f = dec.fields;
		var a = this.readGpr(f.SR1), b = this.readGpr(f.SR2);
		if (b === 0) throw new DivideByZero('除零: ' + a + ' / 0');
		var q = Math.floor(a / b);
		this.writeGpr(f.DRG, u32(q));
		this.writeGpr(f.SR3, u32(a - q * b));
		this._flagsFromArith(u32(q), 0, 0);
	};
	P._i_SMUL = function (dec) {
		var f = dec.fields;
		var a = BigInt(signed(this.readGpr(f.SR1), 32));
		var b = BigInt(signed(this.readGpr(f.SR2), 32));
		var product = a * b;
		var low = Number(product & 0xFFFFFFFFn) >>> 0;
		var high = Number((product >> 32n) & 0xFFFFFFFFn) >>> 0;
		this.writeGpr(f.DRG, low);
		this.writeGpr(f.SR3, high);
		var overflow = (high !== 0 && high !== MASK32) ? 1 : 0;
		this._flagsFromArith(low, overflow, overflow);
	};
	P._i_SDIV = function (dec) {
		var f = dec.fields;
		var a = signed(this.readGpr(f.SR1), 32);
		var b = signed(this.readGpr(f.SR2), 32);
		if (b === 0) throw new DivideByZero('有符号除零: ' + a + ' / 0');
		var q, r;
		if (a === -0x80000000 && b === -1) { q = -0x80000000; r = 0; }
		else { q = Math.trunc(a / b); r = a - b * q; }
		this.writeGpr(f.DRG, u32(q));
		this.writeGpr(f.SR3, u32(r));
		this._flagsFromArith(u32(q), 0, 0);
	};
	P._i_RANDOM = function () { this.writeGpr(4, Math.floor(Math.random() * 0x100000000) >>> 0); };

	/* ---------------------------------------------------------------- logic */

	function logic2(op) {
		return function (dec) {
			var f = dec.fields;
			var r = u32(op(this.readGpr(f.SR1), this.readGpr(f.SR2)));
			this._flagsFromLogic(r);
			this.writeGpr(f.DRG, r);
		};
	}
	function logicImm(op) {
		return function (dec) {
			var f = dec.fields;
			var r = u32(op(this.readGpr(f.SR1), f.IM8 & MASK8));
			this._flagsFromLogic(r);
			this.writeGpr(f.DRG, r);
		};
	}
	function logicImmDw(op) {
		return function (dec) {
			var f = dec.fields;
			var r = u32(op(this.readGpr(f.SR1), u32(f.I32)));
			this._flagsFromLogic(r);
			this.writeGpr(f.DRG, r);
		};
	}

	P._i_XOR = logic2(function (a, b) { return a ^ b; });
	P._i_AND = logic2(function (a, b) { return a & b; });
	P._i_OR = logic2(function (a, b) { return a | b; });
	P._i_XNOR = logic2(function (a, b) { return ~(a ^ b); });
	P._i_NAND = logic2(function (a, b) { return ~(a & b); });
	P._i_NOR = logic2(function (a, b) { return ~(a | b); });
	P._i_NOT = function (dec) {
		var f = dec.fields;
		var r = u32(~this.readGpr(f.SR1));
		this._flagsFromLogic(r);
		this.writeGpr(f.DRG, r);
	};
	P._i_XORI = logicImm(function (a, b) { return a ^ b; });
	P._i_ANDI = logicImm(function (a, b) { return a & b; });
	P._i_ORI = logicImm(function (a, b) { return a | b; });
	P._i_XNORI = logicImm(function (a, b) { return ~(a ^ b); });
	P._i_NANDI = logicImm(function (a, b) { return ~(a & b); });
	P._i_NORI = logicImm(function (a, b) { return ~(a | b); });
	P._i_XORIDW = logicImmDw(function (a, b) { return a ^ b; });
	P._i_ANDIDW = logicImmDw(function (a, b) { return a & b; });
	P._i_ORIDW = logicImmDw(function (a, b) { return a | b; });
	P._i_XNORIDW = logicImmDw(function (a, b) { return ~(a ^ b); });
	P._i_NANDIDW = logicImmDw(function (a, b) { return ~(a & b); });
	P._i_NORIDW = logicImmDw(function (a, b) { return ~(a | b); });

	/* 移位 / 循环：立即数版与寄存器版共用一份实现 */
	P._shiftValue = function (kind, v, n) {
		v = u32(v);
		n = n & 31;
		var result, cf, of = 0;
		if (n === 0) {
			result = v; cf = 0;
		} else if (kind === 'shl') {
			cf = (v >>> (32 - n)) & 1;
			result = u32(v << n);
			of = ((v ^ result) >>> 31) & 1;
		} else if (kind === 'shr') {
			cf = (v >>> (n - 1)) & 1;
			result = v >>> n;
		} else if (kind === 'sar') {
			var sign = (v >>> 31) & 1;
			cf = (v >>> (n - 1)) & 1;
			result = u32((v >>> n) | (sign ? (~0 << (32 - n)) : 0));
		} else if (kind === 'rol') {
			result = u32((v << n) | (v >>> (32 - n)));
			cf = result & 1;
		} else {
			result = u32((v >>> n) | (v << (32 - n)));
			cf = (result >>> 31) & 1;
		}
		return { result: u32(result), cf: cf, of: of };
	};

	function shiftImm(kind) {
		return function (dec) {
			var f = dec.fields;
			var out = this._shiftValue(kind, this.readGpr(f.SR1), f.IM8);
			this._flagsFromArith(out.result, out.cf, out.of);
			this.writeGpr(f.DRG, out.result);
		};
	}
	function shiftReg(kind) {
		return function (dec) {
			var f = dec.fields;
			/* 这一族的"移位次数寄存器"字段在规范里写死 0x0（= x0，恒为 0），解码后没有 SR2 */
			var out = this._shiftValue(kind, this.readGpr(f.SR1), this.readGpr(f.SR2 === undefined ? 0 : f.SR2));
			this._flagsFromArith(out.result, out.cf, out.of);
			this.writeGpr(f.DRG, out.result);
		};
	}

	P._i_SHL = shiftImm('shl');
	P._i_SHR = shiftImm('shr');
	P._i_SAR = shiftImm('sar');
	P._i_ROL = shiftImm('rol');
	P._i_ROR = shiftImm('ror');
	P._i_SHLR = shiftReg('shl');
	P._i_SHRR = shiftReg('shr');
	P._i_SARR = shiftReg('sar');
	P._i_ROLR = shiftReg('rol');
	P._i_RORR = shiftReg('ror');

	function byteSwap(v) {
		v = u32(v);
		return u32(((v & 0xFF) << 24) | ((v & 0xFF00) << 8) |
			((v >>> 8) & 0xFF00) | ((v >>> 24) & 0xFF));
	}
	P._i_BTLE = function (dec) { this.writeGpr(dec.fields.DRG, byteSwap(this.readGpr(dec.fields.DRG))); };
	P._i_BTBE = function (dec) { this.writeGpr(dec.fields.DRG, byteSwap(this.readGpr(dec.fields.DRG))); };

	P._i_XCHG = function (dec) {
		var f = dec.fields;
		var a = this.readGpr(f.DRG);
		var b = this.readGpr(f.SR1);
		this.writeGpr(f.DRG, b);
		this.writeGpr(f.SR1, a);
	};

	/* ------------------------------------------------------- data transfer */

	P._i_MOV = function (dec) {
		this.writeGpr(dec.fields.DRG, this.readGpr(dec.fields.SR1));
	};
	P._i_CLR_ra = function () { this.writeGpr(1, 0); };

	/* -------------------------------------------------------------- branch */

	P._i_JZ = function (dec) { this.branchCond(this.getFlag('zf'), dec.fields.O16); };
	P._i_JC = function (dec) { this.branchCond(this.getFlag('cf'), dec.fields.O16); };
	P._i_JO = function (dec) { this.branchCond(this.getFlag('of'), dec.fields.O16); };
	P._i_JN = function (dec) { this.branchCond(this.getFlag('nf'), dec.fields.O16); };
	P._i_JNZ = function (dec) { this.branchCond(!this.getFlag('zf'), dec.fields.O16); };
	P._i_JNC = function (dec) { this.branchCond(!this.getFlag('cf'), dec.fields.O16); };
	P._i_JNO = function (dec) { this.branchCond(!this.getFlag('of'), dec.fields.O16); };
	P._i_JNN = function (dec) { this.branchCond(!this.getFlag('nf'), dec.fields.O16); };
	P._i_JL = function (dec) { this.branchCond(this.getFlag('nf') !== this.getFlag('of'), dec.fields.O16); };
	P._i_JGE = function (dec) { this.branchCond(this.getFlag('nf') === this.getFlag('of'), dec.fields.O16); };
	P._i_JA = function (dec) {
		this.branchCond(this.getFlag('cf') === 0 && this.getFlag('zf') === 0, dec.fields.O16);
	};
	P._i_JBE = function (dec) {
		this.branchCond(this.getFlag('cf') === 1 || this.getFlag('zf') === 1, dec.fields.O16);
	};
	P._i_JLE = function (dec) {
		this.branchCond(this.getFlag('zf') === 1 ||
			this.getFlag('nf') !== this.getFlag('of'), dec.fields.O16);
	};
	P._i_JAG = function (dec) {
		this.branchCond(this.getFlag('cf') === 0 && this.getFlag('zf') === 0 &&
			this.getFlag('nf') === this.getFlag('of'), dec.fields.O16);
	};

	/* ------------------------------------------------------ condition move */

	P._movc = function (dec, cond) {
		if (cond) this.writeGpr(dec.fields.DRG, this.readGpr(dec.fields.SR1));
	};
	P._i_MOVZ = function (dec) { this._movc(dec, this.getFlag('zf')); };
	P._i_MOVC = function (dec) { this._movc(dec, this.getFlag('cf')); };
	P._i_MOVO = function (dec) { this._movc(dec, this.getFlag('of')); };
	P._i_MOVN = function (dec) { this._movc(dec, this.getFlag('nf')); };
	P._i_MOVNZ = function (dec) { this._movc(dec, !this.getFlag('zf')); };
	P._i_MOVNC = function (dec) { this._movc(dec, !this.getFlag('cf')); };
	P._i_MOVNO = function (dec) { this._movc(dec, !this.getFlag('of')); };
	P._i_MOVNN = function (dec) { this._movc(dec, !this.getFlag('nf')); };
	P._i_MOVL = function (dec) { this._movc(dec, this.getFlag('nf') !== this.getFlag('of')); };
	P._i_MOVGE = function (dec) { this._movc(dec, this.getFlag('nf') === this.getFlag('of')); };
	P._i_MOVA = function (dec) {
		this._movc(dec, this.getFlag('cf') === 0 && this.getFlag('zf') === 0);
	};
	P._i_MOVBE = function (dec) {
		this._movc(dec, this.getFlag('cf') === 1 || this.getFlag('zf') === 1);
	};
	P._i_MOVLE = function (dec) {
		this._movc(dec, this.getFlag('zf') === 1 || this.getFlag('nf') !== this.getFlag('of'));
	};
	P._i_MOVAG = function (dec) {
		this._movc(dec, this.getFlag('cf') === 0 && this.getFlag('zf') === 0 &&
			this.getFlag('nf') === this.getFlag('of'));
	};
	P._i_MOVCTRL = function (dec) { this.writeCr(dec.fields.DRC, this.readGpr(dec.fields.SR1)); };

	/* ------------------------------------------------------------------- io */

	P._i_IN = function (dec) { this.writeGpr(5, this.readPort(dec.fields.PRT) & MASK8); };
	P._i_OUT = function (dec) { this.writePort(dec.fields.PRT, this.readGpr(5) & MASK8); };

	/* ----------------------------------------------------------- load/store */

	P._i_LD = function (dec) {
		var f = dec.fields;
		this.writeGpr(f.DRG, this.readMem32(u32(this.readGpr(f.SR1) + f.OF8)));
	};
	P._i_ST = function (dec) {
		var f = dec.fields;
		this.writeMem32(u32(this.readGpr(f.DRG) + f.OF8), this.readGpr(f.SR1));
	};
	P._i_LDOFIP = function (dec) {
		this.writeGpr(dec.fields.DRG, this.readMem32(u32(dec.startIp + dec.fields.OF16)));
	};
	P._i_STOFIP = function (dec) {
		this.writeMem32(u32(dec.startIp + dec.fields.OF16), this.readGpr(dec.fields.SR1));
	};

	/* --------------------------------------------------------------- system */

	P._i_SYSCALL = function () { this.interrupt(this.syscallVector); };
	P._i_SYSRET = function (dec) { this._i_IRET(dec); };
	P._i_HALT = function () {
		this.halted = true;
		throw new HaltSignal('HALT 指令');
	};
	P._i_LDIDT = function () { this.writeGpr(2, this.kernel.idt); };
	P._i_MODIDT = function (dec) {
		this.writeMem32(u32(this.kernel.idt + dec.fields.OF8), dec.fields.A32);
	};
	P._i_SETIDT = function (dec) { this.kernel.idt = u32(dec.fields.A32); };
	P._i_COPCTRL = function () {
		throw new UndefinedInstruction('COPCTRL: 未安装协处理器 (XTU/BMU)');
	};
	/* vm.py 里方法名写作 COPC（JSON 里真实的指令名是 COPCTRL），两个名字都兜住 */
	P._i_COPC = P._i_COPCTRL;
	P._i_BRK = function () { this.interrupt(INT_BRK); };
	P._i_INT = function (dec) { this.interrupt(dec.fields.IM8 & MASK8); };
	P._i_IRET = function () {
		this.jump(this.pop32());
		this.flags = u32(this.pop32());
	};

	/* ==========================================================================
	   汇编器 —— as.py 的移植
	   ======================================================================== */

	function stripComment(line) {
		var cut = -1;
		[';', '#'].forEach(function (ch) {
			var idx = line.indexOf(ch);
			if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
		});
		if (cut >= 0) line = line.slice(0, cut);
		return line.trim();
	}

	function splitOperands(text) {
		var parts = [];
		var cur = '';
		var inString = false;
		for (var i = 0; i < text.length; i++) {
			var ch = text.charAt(i);
			if (ch === '"') inString = !inString;
			if (ch === ',' && !inString) {
				parts.push(cur.trim());
				cur = '';
			} else {
				cur += ch;
			}
		}
		if (cur.trim()) parts.push(cur.trim());
		return parts;
	}

	function unquoteString(text) {
		text = String(text).trim();
		if (!(text.charAt(0) === '"' && text.charAt(text.length - 1) === '"')) {
			throw new AsmError('需要字符串字面量，得到: ' + text);
		}
		return text.slice(1, -1);
	}

	function Assembler(isa) {
		this.isa = isa;
		this.labels = {};
		this.constants = {};
		this.lines = [];
		this.startPc = 0;
	}

	Assembler.prototype._parseLines = function (source) {
		this.lines = [];
		var rows = String(source).split(/\r?\n/);
		for (var i = 0; i < rows.length; i++) {
			var lineno = i + 1;
			var line = stripComment(rows[i]);
			if (!line) continue;
			while (line.indexOf(':') !== -1 && line.charAt(0) !== '.') {
				var idx = line.indexOf(':');
				var label = line.slice(0, idx).trim();
				if (!label) break;
				this.lines.push({ lineno: lineno, mnemonic: ':', rest: label });
				line = line.slice(idx + 1).trim();
			}
			if (!line) continue;
			var match = line.match(/^(\S+)\s*([\s\S]*)$/);
			this.lines.push({
				lineno: lineno,
				mnemonic: match[1],
				rest: match[2] ? match[2].trim() : ''
			});
		}
	};

	Assembler.prototype._findInst = function (mnemonic, rest) {
		var full = String(mnemonic + ' ' + rest).trim().toUpperCase();
		var upper = this.isa.byNameUpper || {};
		if (upper[full]) return { inst: upper[full], exact: true };
		var plain = String(mnemonic).trim().toUpperCase();
		if (upper[plain]) return { inst: upper[plain], exact: false };
		return { inst: null, exact: false };
	};

	Assembler.prototype._resolve = function (token, pc) {
		token = String(token).trim();
		/* 反汇编会把端口打印成 "port 0x04"，这里容错一下，保证"反汇编文本再汇编"能还原 */
		if (/^port\s+/i.test(token)) token = token.replace(/^port\s+/i, '');
		if (this.constants[token] !== undefined) return this.constants[token];
		if (this.labels[token] !== undefined) return this.labels[token];
		if (token.charAt(0) === "'" && token.length >= 3) return token.charCodeAt(1);
		var lower = token.toLowerCase();
		if (lower.indexOf('0x') === 0) return parseInt(token, 16);
		if (lower.indexOf('0b') === 0) return parseInt(token.slice(2), 2);
		if (lower.indexOf('0o') === 0) return parseInt(token.slice(2), 8);
		if (/^[+-]?\d+$/.test(token)) return parseInt(token, 10);
		throw new AsmError('无法解析值: ' + token);
	};

	Assembler.prototype._pass1 = function () {
		var pc = this.startPc;
		for (var i = 0; i < this.lines.length; i++) {
			var row = this.lines[i];
			if (row.mnemonic === ':') { this.labels[row.rest] = pc; continue; }
			if (row.mnemonic === '.org') { pc = this._resolve(row.rest, pc); continue; }
			if (row.mnemonic === '.equ') {
				var parts = row.rest.split(',');
				this.constants[parts[0].trim()] = this._resolve(parts.slice(1).join(',').trim(), pc);
				continue;
			}
			if (row.mnemonic === '.db' || row.mnemonic === '.dw' || row.mnemonic === '.dd') {
				var count = splitOperands(row.rest).length;
				var size = row.mnemonic === '.db' ? 1 : (row.mnemonic === '.dw' ? 2 : 4);
				pc += count * size;
				continue;
			}
			if (row.mnemonic === '.ascii') {
				pc += new TextEncoder().encode(unquoteString(row.rest)).length;
				continue;
			}
			if (row.mnemonic.charAt(0) === '.') {
				throw new AsmError('未知伪指令 ' + row.mnemonic + ' (行 ' + row.lineno + ')');
			}
			var found = this._findInst(row.mnemonic, row.rest);
			if (!found.inst) throw new AsmError('未知指令 ' + row.mnemonic + ' (行 ' + row.lineno + ')');
			/* 用了 r16..r23 / t0..t7 的话会多一个 REX 前缀字节，算标签地址时必须算上 */
			pc += found.inst.byteLength +
				(this._needsRex(found.inst, found.exact ? [] : splitOperands(row.rest)) ? 1 : 0);
		}
	};

	Assembler.prototype._resolveField = function (token, text, pc, lineno) {
		/* 寄存器名大小写都认: RA / Ra / ra 一样 */
		var lower = String(text).toLowerCase();
		if (token === 'DRG' || token === 'SR1' || token === 'SR2' || token === 'SR3') {
			if (GPR_ID[lower] === undefined) throw new AsmError(token + ' 需要通用寄存器 (行 ' + lineno + ')');
			return GPR_ID[lower];
		}
		if (token === 'DRC' || token === 'SRC' || token === 'CR') {
			if (CR_ID[lower] === undefined) throw new AsmError(token + ' 需要控制寄存器 (行 ' + lineno + ')');
			return CR_ID[lower];
		}
		if (token === 'DFR' || token === 'SF1' || token === 'SF2' || token === 'SF3') {
			if (FPR_ID[lower] === undefined) throw new AsmError(token + ' 需要浮点寄存器 (行 ' + lineno + ')');
			if (FPR_ID[lower] >= 16) {
				throw new AsmError(token + ' 暂不支持 d0..d15（REX 只扩展 DRG/SR1/SR2/SR3）(行 ' + lineno + ')');
			}
			return FPR_ID[lower];
		}
		if (token === 'SCL') return this._resolve(text, pc) & 0xF;
		if (token === 'PRT') return this._resolve(text, pc) & 0xFF;
		if (token === 'O16' || token === 'O32') {
			var offset = this._resolve(text, pc) - pc;
			var bits = FIELD_SIZES[token];
			/* 用 Math.pow 而不是 << : 32 位时 << 会按模 32 位移, 范围判断会算反 */
			var halfRange = Math.pow(2, bits - 1);
			if (offset < -halfRange || offset > halfRange - 1) {
				throw new AsmError(token + ' 偏移越界 ' + offset + ' (行 ' + lineno + ')');
			}
			return u32(offset);
		}
		if (token === 'OF8' || token === 'OF16') {
			var value = this._resolve(text, pc);
			var size = FIELD_SIZES[token];
			var halfSize = Math.pow(2, size - 1);
			if (value < -halfSize || value > halfSize - 1) {
				throw new AsmError(token + ' 偏移越界 ' + value + ' (行 ' + lineno + ')');
			}
			return u32(value);
		}
		if (token === 'A16' || token === 'A32' || token === 'AD8' ||
			token === 'IM8' || token === 'IM16' || token === 'I16' || token === 'I32') {
			return this._resolve(text, pc);
		}
		throw new AsmError('不支持的字段 ' + token + ' (行 ' + lineno + ')');
	};

	/* REX 前缀能扩展的寄存器字段（与 VM.applyRex 的映射一致） */
	var REX_BITS = { DRG: 0x8, SR1: 0x4, SR2: 0x2, SR3: 0x1 };

	Assembler.prototype._emit = function (inst, fields) {
		var out = [inst.opcode & 0xFF];
		/* 寄存器号 >= 16 时自动加 REX 前缀：DRG/SR1/SR2/SR3 的高位分别放在 0x8/0x4/0x2/0x1。
		   以前这里直接把寄存器号 & 0x0F，r20 会被静默改成 r4 —— 高位寄存器根本没法用。 */
		var rex = 0;
		Object.keys(REX_BITS).forEach(function (name) {
			var index = fields[name];
			if (index === undefined) return;
			if (index >= 16) {
				rex |= REX_BITS[name];
				fields[name] = index & 0x0F;
			}
		});
		if (rex) out.unshift(0xE0 | rex);
		var pending = null;
		for (var i = 0; i < inst.format.length; i++) {
			var token = inst.format[i];
			if (token === 'OPC') continue;
			if (NIBBLE_LITERALS[token] !== undefined) {
				var literal = NIBBLE_LITERALS[token];
				if (pending === null) pending = literal;
				else { out.push(((pending << 4) | literal) & 0xFF); pending = null; }
			} else if (FOUR_BIT_FIELDS[token]) {
				var value = (fields[token] === undefined ? 0 : fields[token]) & 0x0F;
				if (pending === null) pending = value;
				else { out.push(((pending << 4) | value) & 0xFF); pending = null; }
			} else {
				var size = FIELD_SIZES[token] / 8;
				var raw = u32(fields[token] === undefined ? 0 : fields[token]);
				for (var k = 0; k < size; k++) out.push((raw >>> (8 * k)) & 0xFF);
				pending = null;
			}
		}
		return new Uint8Array(out);
	};

	/** 一条指令 -> fields（REX 之外的全部字段），_encodeInstruction 与 encodeOne 共用 */
	Assembler.prototype._fieldsFor = function (inst, operands, pc, lineno) {
		if (inst.format.length === 1 && inst.format[0] === 'OPC') {
			if (operands.length) throw new AsmError(inst.name + ' 不需要操作数 (行 ' + lineno + ')');
			return { SOP: 0 };
		}
		var order = [];
		for (var i = 0; i < inst.format.length; i++) {
			var token = inst.format[i];
			if (token === 'OPC' || token === 'SOP' || NIBBLE_LITERALS[token] !== undefined) continue;
			order.push(token);
		}
		/* NOP 系列（填充指令）允许少写操作数：缺的字段直接按数值 0 编码（不能填 "0" 这种
		   数字串 —— 寄存器字段只认寄存器名）*/
		var padding = isPaddingInstruction(inst.name) && operands.length < order.length;
		if (!padding && order.length !== operands.length) {
			throw new AsmError(inst.name + ' 需要 ' + order.length + ' 个操作数，实际 ' +
				operands.length + ' 个 (行 ' + lineno + ')');
		}
		var fields = { SOP: inst.subOpcode === null ? 0 : inst.subOpcode };
		for (var k = 0; k < order.length; k++) {
			fields[order[k]] = k >= operands.length
				? 0
				: this._resolveField(order[k], operands[k], pc, lineno);
		}
		return fields;
	};

	Assembler.prototype._encodeInstruction = function (inst, operands, pc, lineno) {
		return this._emit(inst, this._fieldsFor(inst, operands, pc, lineno));
	};

	/**
	 * 解析并编码"单独一条"指令，返回 { inst, fields, raw } —— 供调试器 "#立即执行" 用，
	 * 完全不碰内存 / ROM（只是把文本变成指令对象 + 机器码）。
	 */
	Assembler.prototype.encodeOne = function (text) {
		this.startPc = 0;
		this.labels = {};
		this.constants = {};
		this._parseLines(String(text) + '\n');
		var row = null;
		for (var i = 0; i < this.lines.length; i++) {
			var line = this.lines[i];
			if (!line.mnemonic) continue;
			if (row) throw new AsmError('一次只能直接执行一条指令 (行 ' + line.lineno + ')');
			row = line;
		}
		if (!row) throw new AsmError('没有指令');
		if (row.mnemonic.charAt(0) === '.') throw new AsmError('伪指令不能直接执行 (行 ' + row.lineno + ')');
		var found = this._findInst(row.mnemonic, row.rest);
		if (!found.inst) throw new AsmError('未知指令 ' + row.mnemonic + ' (行 ' + row.lineno + ')');
		var operands = found.exact ? [] : splitOperands(row.rest);
		var fields = this._fieldsFor(found.inst, operands, 0, row.lineno);
		/* _emit 会就地改写 fields（加 REX 前缀时把寄存器号压低 4 位），所以给它一份拷贝 */
		var copy = {};
		Object.keys(fields).forEach(function (k) { copy[k] = fields[k]; });
		return { inst: found.inst, fields: fields, raw: this._emit(found.inst, copy) };
	};

	/** 这条指令的寄存器操作数里有没有 >= 16 的（有就得加 REX 前缀） */
	Assembler.prototype._needsRex = function (inst, operands) {
		var order = [];
		for (var i = 0; i < inst.format.length; i++) {
			var token = inst.format[i];
			if (token === 'OPC' || token === 'SOP' || NIBBLE_LITERALS[token] !== undefined) continue;
			order.push(token);
		}
		for (var k = 0; k < order.length && k < operands.length; k++) {
			if (!REX_BITS[order[k]]) continue;
			var index = GPR_ID[String(operands[k]).toLowerCase()];
			if (index !== undefined && index >= 16) return true;
		}
		return false;
	};

	Assembler.prototype._pass2 = function () {
		var self = this;
		var chunks = [];
		var total = 0;
		var pc = this.startPc;
		var base = this.startPc;
		function push(bytes) {
			chunks.push(bytes);
			total += bytes.length;
		}
		for (var i = 0; i < this.lines.length; i++) {
			var row = this.lines[i];
			if (row.mnemonic === ':') continue;
			if (row.mnemonic === '.org') {
				pc = this._resolve(row.rest, pc);
				var need = pc - base - total;
				if (need > 0) push(new Uint8Array(need));
				continue;
			}
			if (row.mnemonic === '.equ') continue;
			if (row.mnemonic === '.db' || row.mnemonic === '.dw' || row.mnemonic === '.dd') {
				var size = row.mnemonic === '.db' ? 1 : (row.mnemonic === '.dw' ? 2 : 4);
				var toks = splitOperands(row.rest);
				var buf = new Uint8Array(toks.length * size);
				for (var t = 0; t < toks.length; t++) {
					var value = u32(this._resolve(toks[t], pc));
					for (var b = 0; b < size; b++) buf[t * size + b] = (value >>> (8 * b)) & 0xFF;
					pc += size;
				}
				push(buf);
				continue;
			}
			if (row.mnemonic === '.ascii') {
				var data = new TextEncoder().encode(unquoteString(row.rest));
				push(data);
				pc += data.length;
				continue;
			}
			if (row.mnemonic.charAt(0) === '.') {
				throw new AsmError('未知伪指令 ' + row.mnemonic + ' (行 ' + row.lineno + ')');
			}
			var found = this._findInst(row.mnemonic, row.rest);
			var operands = found.exact ? [] : splitOperands(row.rest);
			var code = this._encodeInstruction(found.inst, operands, pc, row.lineno);
			push(code);
			pc += code.length;
		}
		var out = new Uint8Array(total);
		var at = 0;
		chunks.forEach(function (chunk) { out.set(chunk, at); at += chunk.length; });
		return out;
	};

	/**
	 * 汇编源码 -> 机器码
	 * @param {string} source 汇编源码
	 * @param {number} [org]  起始地址（默认 0；.org 与标签都以它为基准）
	 * @returns {Uint8Array}
	 */
	Assembler.prototype.assemble = function (source, org) {
		this.startPc = org || 0;
		this.labels = {};
		this.constants = {};
		this._parseLines(source);
		this._pass1();
		return this._pass2();
	};

	/** 汇编并返回标签表（调试器展开窗口用） */
	Assembler.prototype.assembleWithLabels = function (source, org) {
		var bytes = this.assemble(source, org);
		return { bytes: bytes, labels: this.labels, constants: this.constants, size: bytes.length };
	};

/* ------------------------------------------------- 示例程序（asmdemo/） */

	/* 示例源码都在仓库的 asmdemo/ 目录里，这里只放清单，用的时候再取。
	   网页里用 fetch，Node 里可以直接读文件（见 loadDemo 的用法）。 */
	var DEMO_DIR = 'asmdemo/';

	/**
	 * 取一份示例源码。
	 * @param {string} id 示例名（对应 asmdemo/<id>.asm）
	 * @param {function} [readFile] 可选：Node 环境下的读文件函数（path => string）
	 * @returns {Promise<string>}
	 */
	function loadDemo(id, readFile) {
		var name = String(id || '').toLowerCase();
		var path = DEMO_DIR + name + '.asm';
		if (readFile) {
			try { return Promise.resolve(readFile(path)); }
			catch (err) { return Promise.reject(err); }
		}
		if (typeof global.fetch !== 'function') {
			return Promise.reject(new Error('no fetch — 需要本地 HTTP 服务器，或直接读 asmdemo/' + name + '.asm'));
		}
		return global.fetch(path, { credentials: 'same-origin' }).then(function (res) {
			if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + path);
			return res.text();
		});
	}

	var DEMO_LIST = [
		{ id: 'hello', title: 'hello — 端口输出 Hi!' },
		{ id: 'fib', title: 'fib — 前 12 个斐波那契数' },
		{ id: 'fib3', title: 'fib3 — 递归 fib(10)（CALL/RET + 栈）' },
		{ id: 'intr', title: 'intr — SETIDT / INT / IRET' },
		{ id: 'mem', title: 'mem — LEA / LD / ST / PUSH / POP' },
		{ id: 'screen', title: 'screen — 显示屏：32x32 渐变点阵' },
		{ id: 'helloworld', title: 'helloworld — 5x7 方块字 HELLO / WORLD' },
		{ id: 'syscall-font', title: 'syscall-font — SYSCALL 调字体绘制库（初稿 723B）' },
		{ id: 'syscall-font-opt', title: 'syscall-font-opt — 同上，最短编码优化版（650B）' },
		{ id: 'isa-coverage', title: 'isa-coverage — ISA 体检：156 条指令 + 全部寄存器 + 内存/屏幕/中断' }
	];

	var DEMO_IDS = DEMO_LIST.map(function (d) { return d.id; });


	/* ------------------------------------------------------------------ 导出 */

	global.HaynekoArch32 = {
		VERSION: '1.0.0',
		ISA: ISA,
		VM: VM,
		Assembler: Assembler,
		Instruction: Instruction,
		loadDemo: loadDemo,
		DEMO_DIR: DEMO_DIR,
		DEMO_IDS: DEMO_IDS,
		DEMO_LIST: DEMO_LIST,
		GPR_NAMES: GPR_NAMES,
		GPR_ID: GPR_ID,
		FPR_NAMES: FPR_NAMES,
		CR_NAMES: CR_NAMES,
		FLAG_BITS: FLAG_BITS,
		FLAG_DISPLAY: FLAG_DISPLAY,
		FIELD_SIZES: FIELD_SIZES,
		MASK32: MASK32,
		ROM_SIZE: ROM_SIZE,
		DISK_SIZE: DISK_SIZE,
		ISA_URL: 'HaynekoArch32VM_python/hayneko_arch32S-v1.json',
		errors: {
			VMError: VMError,
			UndefinedInstruction: UndefinedInstruction,
			MemoryViolation: MemoryViolation,
			DivideByZero: DivideByZero,
			HaltSignal: HaltSignal,
			AsmError: AsmError
		},
		u32: u32,
		i32: i32,
		hex: hex,
		signed: signed
	};
})(typeof window !== 'undefined' ? window : globalThis);
