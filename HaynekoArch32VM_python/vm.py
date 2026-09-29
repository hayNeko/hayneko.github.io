#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hayneko_Arch32S 模拟器 (vm.py)
===============================

基于 hayneko_arch32S-v1.json 中定义的 Hayneko_Arch32S 指令集架构 (ISA) 编写的
纯 Python 模拟器。它是 simplevm.py 的完整化实现：从 JSON 读取全部指令定义、
前缀、寄存器、标志位、中断向量表，并逐条解码执行。

内存布局 (与 simplevm.py 一致)：
    +------------------------------+  mem_size * 1024 字节
    |  lower 1KB   = ROM           |  (从 ROM 文件载入)
    +------------------------------+
    |  upper (mem_size*1024-1024)  |
    |  = RAM / 数据区              |
    +------------------------------+
    |  disk (独立文件, 256KB)      |  通过磁盘接口访问
    +------------------------------+

设计约定（当 ISA 文档有歧义时采用的解释，请见 README）：
  * 字节序默认为小端 (little-endian)，flags 中的 BE 位置位时使用大端。
  * BTLE / BTBE (0x50 子操作码 0x0 / 0x4)：按子操作码分发，低半字节固定为
    SOP，因此是对 DRG 就地做字节交换（源寄存器字段无法编码，视为 DRG 自身）。
  * SHLR / SHRR / SARR / ROLR / RORR：移位/旋转次数取自字节2低半字节所指向的
    寄存器 (SR2)，取模 32。规范中该字段写为 "0x0"，即 x0（恒为 0，等于不移动）。
  * COPYIP 与 SAR 共用操作码 0x5B：以字节1低半字节区分 —— 为 0 时是 COPYIP
    （长度 2），否则是 SAR（长度 3）。因此 SAR 的源寄存器不能是 x0。
  * IP 相对寻址（LDOFIP/STOFIP/COPYIP/PUSHIP 及相对分支）以当前指令自身的
    起始地址 (self.ip) 为基准。
  * CALL 的返回地址为 CALL 之后那条指令的地址 (ip + length)。
  * ST 的编码为 [OPC, SR1, DRG, OF8]：SR1 字段是被存储的源寄存器（高半字节），
    DRG 字段是基址寄存器（低半字节），即 mem32[GPR[DRG] + OF8] = GPR[SR1]。
  * 中断约定：响应中断时依次压栈 flags、ip（ip 在栈顶）；处理程序地址为
    mem32[idt_reg + vector*4]；IRET 依次弹出 ip、flags。
  * SYSCALL 等价于 INT(SYSCALL_VECTOR)，默认向量 0x40。
  * HALT 设置 halted 标志并停止执行（不自动触发 #HLT 中断）。
  * LD / ST 为 32 位 (dword) 访存。
  * I/O 端口：0x00=控制台字节输出, 0x01=控制台整数输出, 0x02=控制台输入,
    0x10=以 ri 为退出码停止, 0x20/0x21=磁盘扇区读/写（扩展）。

用法示例：
    python vm.py --rom rom.hvd --disk disk.hvd --mem 4096 --entry 0 --max-steps 100000
    python vm.py --trace ...   # 打印每条指令的反汇编与寄存器快照
"""

import argparse
import json
import os
import random
import struct
import sys

# ---------------------------------------------------------------------------
# 全局常量与元数据
# ---------------------------------------------------------------------------

MASK32 = 0xFFFFFFFF
MASK16 = 0xFFFF
MASK8 = 0xFF

# 编码字段位宽（来自 JSON "encode" 节）
FIELD_SIZES = {
    "OPC": 8, "SOP": 4, "ISL": 4, "GB1": 1, "GB2": 2,
    "DRG": 4, "SR1": 4, "SR2": 4, "SR3": 4,
    "DRC": 4, "SRC": 4,
    "DFR": 4, "SF1": 4, "SF2": 4, "SF3": 4,
    "IM8": 8, "IM16": 16, "I16": 16, "I32": 32,   # IM16: PUSHIMMW 用到, 以前漏登记
    "OF8": 8, "OF16": 16, "O16": 16, "O32": 32,
    "AD8": 8, "A16": 16, "A32": 32,
    "SCL": 4, "PRT": 8, "CR": 4,
}

# 4 位寄存器类字段（每字节打包两个，高半字节在前）
FOUR_BIT_FIELDS = {
    "DRG", "SR1", "SR2", "SR3", "DRC", "SRC",
    "DFR", "SF1", "SF2", "SF3", "SCL", "CR", "SOP",
}

# 格式中出现的形式字面量（如 "0x0"），表示固定的 4 位值
NIBBLE_LITERALS = {f"0x{i:x}" for i in range(16)}

# 有符号偏移字段（解析时直接做符号扩展）
SIGNED_FIELDS = {"OF8", "OF16", "O16", "O32"}

# 通用寄存器名称（32 个 GPR）
GPR_NAMES = [
    "x0", "ra", "rb", "rc", "rd", "ri", "bp", "sp",
    "r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15",
    "r16", "r17", "r18", "r19", "r20", "r21", "r22", "r23",
    "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
]
GPR_ID = {name: i for i, name in enumerate(GPR_NAMES)}

# 浮点寄存器名称（32 个 FPR：f0..f15 = 0..15, d0..d15 = 16..31）
FPR_NAMES = [f"f{i}" for i in range(16)] + [f"d{i}" for i in range(16)]
FPR_ID = {name: i for i, name in enumerate(FPR_NAMES)}

CR_NAMES = ["cr0", "cr1", "cr2", "cr3"]
CR_ID = {name: i for i, name in enumerate(CR_NAMES)}

# 标志位位号（来自 JSON "flags" / "status_flags" 节）
FLAG_BITS = {
    "zf": 0, "cf": 1, "of": 2, "nf": 3, "df": 4,
    "flz": 5, "flo": 6, "flv": 7, "if": 8, "be": 12, "ac": 13,
    "xte": 16, "bme": 17, "cie": 18, "vie": 24, "prot": 30,
}

# 中断向量（来自 JSON "interrupt_vectors" 节）
INT_BRK = 0
INT_DIV = 1
INT_NMI = 2
INT_HLT = 3
INT_MCC = 4
INT_MAV = 5
INT_UDI = 6
INT_PGF = 7
SYSCALL_VECTOR = 0x40  # 自定义系统调用向量（可在 CLI 覆盖）

# I/O 端口约定
PORT_CONSOLE_BYTE = 0x00   # OUT: 输出 ri&0xFF 对应的字符
PORT_CONSOLE_INT = 0x01    # OUT: 以十进制输出 ri
PORT_CONSOLE_IN = 0x02     # IN : 从标准输入读一个字节到 ri
PORT_QUIT = 0x10           # OUT: 以 ri 作为退出码停止虚拟机
PORT_DISK_READ = 0x20      # OUT: ri=内存地址, rd=LBA, 读 512 字节扇区到内存
PORT_DISK_WRITE = 0x21     # OUT: ri=内存地址, rd=LBA, 写 512 字节扇区到磁盘

# 256x256 小型显示屏：每个端口按大端收 4 个字节拼成一个 32 位字
PORT_MONITOR_CTRL = 0x04   # MNTRCONTROL: [x(第1字节), y(第0字节), 高2字节空]
PORT_MONITOR_COLOR = 0x05  # MNTRCOLOR  : [R(第3), G(第2), B(第1), refresh(第0)]
MONITOR_SIZE = 256         # 显示屏边长

# 前缀编码
PREFIX_REX = 0xE0          # 0xE0..0xEF
PREFIX_ISL = 0xD0          # 0xD0..0xDF
PREFIX_BRH0 = 0xF2
PREFIX_BRH1 = 0xF3
PREFIX_LOCK = 0xF4
PREFIX_XTU = 0xF5
PREFIX_BMU = 0xF6
PREFIX_DBI = 0xF0
PREFIX_TBI = 0xF1


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------

class VMError(Exception):
    """所有虚拟机错误的基类。"""


class UndefinedInstruction(VMError):
    """未定义的指令（对应 #UDI）。"""


class MemoryViolation(VMError):
    """内存访问越界（对应 #MAV）。"""


class DivideByZero(VMError):
    """除零错误（对应 #DIV）。"""


class HaltSignal(Exception):
    """内部信号：HALT 或退出端口触发，用于终止 run()。"""


# ---------------------------------------------------------------------------
# ISA 定义
# ---------------------------------------------------------------------------

class Instruction:
    """一条指令的完整定义（来自 JSON）。"""

    __slots__ = ("name", "category", "opcode", "sub_opcode", "length",
                 "format", "modify_flags", "mode", "description", "needs_coprocessor")

    def __init__(self, name, category, data):
        self.name = name
        self.category = category
        self.opcode = int(data["opcode"], 16)
        self.sub_opcode = int(data["sub_opcode"], 16) if "sub_opcode" in data else None
        self.length = data["length"]
        self.format = list(data["format"])
        self.modify_flags = list(data.get("modify_flags", []))
        self.mode = data.get("mode")
        self.description = data.get("description", "")
        self.needs_coprocessor = data.get("needs_coprocessor")

    def __repr__(self):
        return (f"<Instr {self.name} op=0x{self.opcode:02X} "
                f"sub={None if self.sub_opcode is None else hex(self.sub_opcode)} "
                f"len={self.length}>")

    @property
    def format_length(self):
        """按 format 字段计算的指令字节长度（与汇编器一致）。

        个别指令（如 CMP）在 JSON 中写的 length 与其 format 不符，
        统一以 format 推导为准，保证解码与编码一致。
        """
        bits = 8
        for token in self.format:
            if token == "OPC":
                continue
            if token in NIBBLE_LITERALS or token in FOUR_BIT_FIELDS:
                bits += 4
            else:
                bits += FIELD_SIZES[token]
        return bits // 8


class ISA:
    """从 JSON 文件加载并索引整套 ISA。"""

    def __init__(self, path):
        with open(path, "r", encoding="utf-8") as f:
            self.data = json.load(f)

        self.instructions = {}          # (opcode, sub_opcode) -> Instruction
        self.opcode_map = {}            # opcode -> [Instruction, ...]
        self.by_name = {}               # name -> Instruction（含冲突时取最后一个）
        self.arch = self.data.get("architecture", {})
        self.flags = self.data.get("flags", {})
        self.status_flags = self.data.get("status_flags", {})
        self.interrupt_vectors = self.data.get("interrupt_vectors", {})
        self.prefixes = self.data.get("prefixes", {})
        self.regs = self.data.get("registers", {})
        self.abi = self.data.get("ABI", {})

        self._build_instructions()

    def _build_instructions(self):
        for category, group in self.data.get("instructions", {}).items():
            for name, data in group.items():
                inst = Instruction(name, category, data)
                self._add(inst)
        # 伪指令 / 微码翻译（SAL -> SHL 等），注册为可执行指令
        for name, data in self.data.get("psuedo_instructions", {}).items():
            if "opcode" in data:
                inst = Instruction(name, "psuedo", data)
                self._add(inst)

    def _add(self, inst):
        key = (inst.opcode, inst.sub_opcode)
        self.instructions[key] = inst
        self.opcode_map.setdefault(inst.opcode, []).append(inst)
        self.by_name[inst.name] = inst

    def lookup(self, opcode, sub_opcode=None):
        """返回指令定义，或 None。"""
        insts = self.opcode_map.get(opcode, [])
        if not insts:
            return None
        if len(insts) == 1:
            return insts[0]
        return self.instructions.get((opcode, sub_opcode))

    def flag_bit(self, name):
        name = name.lower()
        if name in FLAG_BITS:
            return FLAG_BITS[name]
        for table in (self.flags, self.status_flags):
            entry = table.get(name)
            if entry:
                return entry["bit_position"]
        raise KeyError(f"未知标志位: {name}")


# ---------------------------------------------------------------------------
# 解码器
# ---------------------------------------------------------------------------

class Decoded:
    """一次取指解码的结果。"""

    __slots__ = ("inst", "fields", "length", "prefixes", "start_ip", "raw")

    def __init__(self, inst, fields, length, prefixes, start_ip, raw):
        self.inst = inst
        self.fields = fields
        self.length = length
        self.prefixes = prefixes
        self.start_ip = start_ip
        self.raw = raw


def _is_padding_instruction(name):
    """NOP2..NOP15（填充指令）：汇编时可以省略操作数，反汇编时也不显示它们。"""
    name = str(name)
    return name.startswith("NOP") and name[3:].isdigit()


def _signed(value, bits):
    """对 bits 位宽的无符号值做符号扩展。"""
    sign = 1 << (bits - 1)
    if value & sign:
        value -= (1 << bits)
    return value


# ---------------------------------------------------------------------------
# 虚拟机
# ---------------------------------------------------------------------------

class VM:
    def __init__(self, isa, rom_file, disk_file, mem_size, entry=0,
                 initial_sp=None, syscall_vector=SYSCALL_VECTOR):
        if not isinstance(isa, ISA):
            isa = ISA(isa)
        self.isa = isa

        self.rom_file = rom_file
        self.disk_file = disk_file
        self.mem_size = mem_size                    # KB
        self.mem_size_bytes = mem_size * 1024
        self.entry = entry & MASK32
        self.syscall_vector = syscall_vector & 0xFF

        if mem_size < 1 or mem_size > 65536:
            raise ValueError("内存大小必须在 1 到 65536 KB 之间")

        # 32 个 GPR、32 个 FPR（float32）、4 个控制寄存器
        self.gpr = [0] * 32
        self.fpr = [0.0] * 32
        self.cr = [0] * 4
        # 内核寄存器
        self.kernel = {"mode": 0, "status": 0, "ip": 0, "idt": 0}
        self.mode = 0                     # 当前特权级 L0..L7
        self.ip = self.entry
        self._next_ip = self.entry       # 中断/异常入栈用的返回地址（step 里每步更新）
        self.flags = 0
        self.halted = False
        self.quit_code = 0
        self.instruction_count = 0

        self.memory = bytearray(self.mem_size_bytes)
        self._load_rom()

        self._open_devices()

        if initial_sp is None:
            initial_sp = self.mem_size_bytes
        self.sp_init = initial_sp & MASK32
        self.gpr[GPR_ID["sp"]] = self.sp_init

        self._jumped = False
        self._trace = False
        self._trace_limit = 0
        self._output_cb = None       # 控制台输出回调（GUI 调试器使用）
        self._frame_cb = None        # 显示屏刷新回调（GUI 调试器使用）
        self.monitor = self._new_monitor()

    # ------------------------------------------------------------------ 设备
    def _open_devices(self):
        self.rom = open(self.rom_file, "r+b")
        if not os.path.exists(self.disk_file):
            # 磁盘不存在则创建一个 256KB 的空白磁盘
            with open(self.disk_file, "wb") as f:
                f.write(bytes(256 * 1024))
        self.disk = open(self.disk_file, "r+b")

    def _load_rom(self):
        try:
            with open(self.rom_file, "rb") as f:
                rom_data = f.read(1024)
        except FileNotFoundError:
            rom_data = b""
        if len(rom_data) < 1024:
            rom_data += b"\x00" * (1024 - len(rom_data))
        self.memory[:1024] = rom_data

    def close(self):
        for f in (self.rom, self.disk):
            if f is not None and not f.closed:
                f.close()

    def reset(self, entry=None):
        """将 VM 恢复到初始状态（重新载入 ROM，清空寄存器与内存）。"""
        self.gpr = [0] * 32
        self.fpr = [0.0] * 32
        self.cr = [0] * 4
        self.kernel = {"mode": 0, "status": 0, "ip": 0, "idt": 0}
        self.mode = 0
        self.flags = 0
        self.halted = False
        self.quit_code = 0
        self.instruction_count = 0
        self.ip = self.entry if entry is None else (entry & MASK32)
        self._next_ip = self.ip
        self.monitor = self._new_monitor()
        self.memory = bytearray(self.mem_size_bytes)
        self._load_rom()
        self.gpr[GPR_ID["sp"]] = self.sp_init
        self._jumped = False

    # ---------------------------------------------------------------- 寄存器
    def read_gpr(self, idx):
        return self.gpr[idx & 31]

    def write_gpr(self, idx, value):
        idx &= 31
        if idx == 0:              # x0 恒为 0
            return
        self.gpr[idx] = value & MASK32

    def read_fpr(self, idx):
        return self.fpr[idx & 31]

    def write_fpr(self, idx, value):
        self.fpr[idx & 31] = struct.unpack("<f", struct.pack("<f", float(value)))[0]

    def read_cr(self, idx):
        return self.cr[idx & 3]

    def write_cr(self, idx, value):
        self.cr[idx & 3] = value & MASK32

    # ------------------------------------------------------------------ 标志
    def get_flag(self, name):
        return (self.flags >> FLAG_BITS[name.lower()]) & 1

    def set_flag(self, name, val):
        bit = FLAG_BITS[name.lower()]
        if val:
            self.flags |= (1 << bit)
        else:
            self.flags &= ~(1 << bit)

    def _flags_from_arith(self, result_masked, cf, of):
        self.set_flag("zf", result_masked == 0)
        self.set_flag("nf", (result_masked >> 31) & 1)
        self.set_flag("cf", cf)
        self.set_flag("of", of)

    def _flags_from_logic(self, result):
        self.set_flag("zf", result == 0)
        self.set_flag("nf", (result >> 31) & 1)
        self.set_flag("cf", 0)
        self.set_flag("of", 0)

    def _add_with_flags(self, a, b):
        a &= MASK32
        b &= MASK32
        s = a + b
        result = s & MASK32
        cf = 1 if s > MASK32 else 0
        sa, sb, sr = (a >> 31) & 1, (b >> 31) & 1, (result >> 31) & 1
        of = 1 if (sa == sb and sr != sa) else 0
        self._flags_from_arith(result, cf, of)
        return result

    def _sub_with_flags(self, a, b):
        a &= MASK32
        b &= MASK32
        result = (a - b) & MASK32
        cf = 1 if a < b else 0
        sa, sb, sr = (a >> 31) & 1, (b >> 31) & 1, (result >> 31) & 1
        of = 1 if (sa != sb and sr != sa) else 0
        self._flags_from_arith(result, cf, of)
        return result

    # ---------------------------------------------------------------- 内存
    def _check_addr(self, addr):
        addr &= MASK32
        if addr >= self.mem_size_bytes:
            raise MemoryViolation(f"内存访问越界: 0x{addr:08X} (内存大小 0x{self.mem_size_bytes:X})")
        return addr

    def read_mem8(self, addr):
        addr = self._check_addr(addr)
        return self.memory[addr]

    def write_mem8(self, addr, val):
        addr = self._check_addr(addr)
        self.memory[addr] = val & MASK8

    def read_mem16(self, addr):
        addr = self._check_addr(addr)
        if addr + 2 > self.mem_size_bytes:
            raise MemoryViolation(f"内存访问越界: 0x{addr:08X}")
        if self.get_flag("be"):
            return (self.memory[addr] << 8) | self.memory[addr + 1]
        return self.memory[addr] | (self.memory[addr + 1] << 8)

    def write_mem16(self, addr, val):
        addr = self._check_addr(addr)
        if addr + 2 > self.mem_size_bytes:
            raise MemoryViolation(f"内存访问越界: 0x{addr:08X}")
        val &= MASK16
        if self.get_flag("be"):
            self.memory[addr] = (val >> 8) & MASK8
            self.memory[addr + 1] = val & MASK8
        else:
            self.memory[addr] = val & MASK8
            self.memory[addr + 1] = (val >> 8) & MASK8

    def read_mem32(self, addr):
        addr = self._check_addr(addr)
        if addr + 4 > self.mem_size_bytes:
            raise MemoryViolation(f"内存访问越界: 0x{addr:08X}")
        if self.get_flag("be"):
            return (self.memory[addr] << 24 | self.memory[addr + 1] << 16 |
                    self.memory[addr + 2] << 8 | self.memory[addr + 3])
        return (self.memory[addr] | self.memory[addr + 1] << 8 |
                self.memory[addr + 2] << 16 | self.memory[addr + 3] << 24)

    def write_mem32(self, addr, val):
        addr = self._check_addr(addr)
        if addr + 4 > self.mem_size_bytes:
            raise MemoryViolation(f"内存访问越界: 0x{addr:08X}")
        val &= MASK32
        if self.get_flag("be"):
            self.memory[addr] = (val >> 24) & MASK8
            self.memory[addr + 1] = (val >> 16) & MASK8
            self.memory[addr + 2] = (val >> 8) & MASK8
            self.memory[addr + 3] = val & MASK8
        else:
            self.memory[addr] = val & MASK8
            self.memory[addr + 1] = (val >> 8) & MASK8
            self.memory[addr + 2] = (val >> 16) & MASK8
            self.memory[addr + 3] = (val >> 24) & MASK8

    # ------------------------------------------------------------------ 栈
    def push32(self, value):
        sp = self.gpr[GPR_ID["sp"]] - 4
        self.write_mem32(sp, value & MASK32)
        self.gpr[GPR_ID["sp"]] = sp

    def pop32(self):
        sp = self.gpr[GPR_ID["sp"]]
        value = self.read_mem32(sp)
        self.gpr[GPR_ID["sp"]] = sp + 4
        return value

    # ------------------------------------------------------------------ 磁盘
    def read_disk(self, position, length):
        assert self.disk is not None
        self.disk.seek(position)
        return self.disk.read(length)

    def write_disk(self, position, data_bytes):
        assert self.disk is not None
        self.disk.seek(position)
        self.disk.write(data_bytes)
        self.disk.flush()

    # ------------------------------------------------------------------ 端口
    def read_port(self, port):
        port &= MASK8
        if port == PORT_CONSOLE_IN:
            try:
                line = sys.stdin.buffer.read(1)
                return line[0] if line else 0
            except Exception:
                return 0
        # 其他端口读入 0
        return 0

    def write_port(self, port, value):
        port &= MASK8
        value &= MASK8
        if port == PORT_CONSOLE_BYTE:
            text = chr(value)
            if self._output_cb is not None:
                self._output_cb(text)
            else:
                sys.stdout.write(text)
                sys.stdout.flush()
        elif port == PORT_CONSOLE_INT:
            text = str(self.gpr[GPR_ID["ri"]])
            if self._output_cb is not None:
                self._output_cb(text)
            else:
                sys.stdout.write(text)
                sys.stdout.flush()
        elif port == PORT_QUIT:
            self.quit_code = self.gpr[GPR_ID["ri"]]
            self.halted = True
            raise HaltSignal(f"退出端口: 退出码 {self.quit_code}")
        elif port == PORT_DISK_READ:
            base = self.gpr[GPR_ID["ri"]]
            lba = self.gpr[GPR_ID["rd"]]
            data = self.read_disk(lba * 512, 512)
            for i, b in enumerate(data):
                self.write_mem8(base + i, b)
        elif port == PORT_DISK_WRITE:
            base = self.gpr[GPR_ID["ri"]]
            lba = self.gpr[GPR_ID["rd"]]
            chunk = bytes(self.memory[base:base + 512])
            self.write_disk(lba * 512, chunk)
        elif port in (PORT_MONITOR_CTRL, PORT_MONITOR_COLOR):
            self.monitor_byte(port, value)
        else:
            # 未定义端口：忽略
            pass

    # -------------------------------------------------------- 小型显示屏总线
    def _new_monitor(self):
        """256x256 显示屏状态：buffer=写入的像素, screen=已经刷新上屏的像素。"""
        return {
            "size": MONITOR_SIZE,
            "buffer": bytearray([0, 0, 0, 255] * (MONITOR_SIZE * MONITOR_SIZE)),
            "screen": bytearray([0, 0, 0, 255] * (MONITOR_SIZE * MONITOR_SIZE)),
            "x": 0, "y": 0, "frames": 0, "refresh_at": 0,
            "shift": [0, 0],       # 两个端口各自的大端移位寄存器
            "pending": [0, 0],     # 已收到的字节数
            "word_ctrl": 0, "word_color": 0,
        }

    def monitor_byte(self, port, byte):
        """OUT 每次送 1 个字节；同一端口每收满 4 个字节按大端拼成一个字。

        MNTRCONTROL: [x(第1字节), y(第0字节), 高 2 字节空] -> 设置光标
        MNTRCOLOR  : [R(第3), G(第2), B(第1), refresh(第0)]
                     refresh 0x00 -> 只写缓冲区；0xFF -> 写缓冲区并立即刷新；其余丢弃
        """
        mon = self.monitor
        index = 0 if port == PORT_MONITOR_CTRL else 1
        mon["shift"][index] = ((mon["shift"][index] << 8) | (byte & MASK8)) & MASK32
        mon["pending"][index] += 1
        if mon["pending"][index] < 4:
            return
        mon["pending"][index] = 0
        word = mon["shift"][index]
        if port == PORT_MONITOR_CTRL:
            mon["word_ctrl"] = word
            mon["x"] = (word >> 8) & MASK8      # 第1字节 = x
            mon["y"] = word & MASK8             # 第0字节 = y
            return
        mon["word_color"] = word
        refresh = word & MASK8
        if refresh not in (0x00, 0xFF):
            return                              # 未定义 -> 丢弃
        r = (word >> 24) & MASK8
        g = (word >> 16) & MASK8
        b = (word >> 8) & MASK8
        off = ((mon["y"] * MONITOR_SIZE) + mon["x"]) * 4
        mon["buffer"][off] = r
        mon["buffer"][off + 1] = g
        mon["buffer"][off + 2] = b
        mon["buffer"][off + 3] = 255
        if refresh == 0xFF:
            self.monitor_flush()

    def monitor_flush(self):
        """把缓冲区贴到屏幕上（一次刷新算一帧）。"""
        mon = self.monitor
        mon["screen"][:] = mon["buffer"]
        mon["frames"] += 1
        mon["refresh_at"] = self.instruction_count
        if self._frame_cb is not None:
            self._frame_cb(mon)

    def monitor_clear(self):
        """清屏（缓冲与屏幕都清成黑色），调试器用。"""
        mon = self.monitor
        mon["buffer"] = bytearray([0, 0, 0, 255] * (MONITOR_SIZE * MONITOR_SIZE))
        mon["screen"] = bytearray([0, 0, 0, 255] * (MONITOR_SIZE * MONITOR_SIZE))
        mon["x"] = mon["y"] = 0
        mon["pending"] = [0, 0]
        mon["shift"] = [0, 0]

    # ------------------------------------------------------------------ 中断
    def _interrupt(self, vector, from_exception=False):
        """响应中断/异常：压栈 flags、返回地址，跳转到 IDT 处理程序。

        返回地址（栈顶）的取值：
          * 软件中断 INT / BRK / SYSCALL：**下一条指令**的地址。以前压的是 INT
            自己的地址，IRET 之后又回到 INT，处理程序永远退不出来（无限循环）。
          * 异常（除零 / 越界 / 未定义指令，from_exception=True）：出错的那条
            指令的地址，处理程序可以自行修正后重试（x86 的 fault 语义）。
        """
        idt = self.kernel["idt"]
        if idt == 0 or idt >= self.mem_size_bytes:
            raise RuntimeError(f"IDT 未配置 (idt=0x{idt:X})，无法响应中断向量 {vector}")
        handler = self.read_mem32(idt + vector * 4)
        self.push32(self.flags)
        self.push32(self.ip if from_exception else self._next_ip)
        self.ip = handler & MASK32
        self._jumped = True

    def _fault(self, vector, message):
        """触发异常。若 IDT 已配置则路由到处理程序，否则打印并停机。"""
        idt = self.kernel["idt"]
        if idt != 0 and idt < self.mem_size_bytes:
            if not self._trace:
                print(f"[VM] 异常 #向量{vector}: {message}", file=sys.stderr)
            self._interrupt(vector, from_exception=True)
        else:
            print(f"[VM] 致命异常 #向量{vector}: {message}", file=sys.stderr)
            self.halted = True
            raise HaltSignal(f"致命异常 #向量{vector}: {message}")

    # ------------------------------------------------------------------ 解码
    def _is_prefix(self, b):
        if PREFIX_REX <= b <= PREFIX_REX + 0x0F:
            return "rex"
        if PREFIX_ISL <= b <= PREFIX_ISL + 0x0F:
            return "isl"
        if b == PREFIX_LOCK:
            return "lock"
        if b in (PREFIX_BRH0, PREFIX_BRH1):
            return "brh"
        if b == PREFIX_XTU:
            return "xtu"
        if b == PREFIX_BMU:
            return "bmu"
        if b == PREFIX_DBI:
            return "dbi"
        if b == PREFIX_TBI:
            return "tbi"
        return None

    def fetch_decode(self):
        """取指并解码一条指令。返回 Decoded 对象。"""
        ip = self.ip
        start = ip
        prefixes = {"rex": 0, "isl": 0, "lock": False, "brh": 0,
                    "xtu": False, "bmu": False, "dbi": False, "tbi": False}
        while True:
            if ip >= self.mem_size_bytes:
                raise MemoryViolation(f"指令指针越界: 0x{ip:08X}")
            b = self.memory[ip]
            p = self._is_prefix(b)
            if p is None:
                break
            if p == "rex":
                prefixes["rex"] = b & 0x0F
            elif p == "isl":
                prefixes["isl"] = b & 0x0F
            elif p == "brh":
                prefixes["brh"] = b & 0x01
            elif p == "lock":
                prefixes["lock"] = True
            elif p == "xtu":
                prefixes["xtu"] = True
            elif p == "bmu":
                prefixes["bmu"] = True
            elif p == "dbi":
                prefixes["dbi"] = True
            elif p == "tbi":
                prefixes["tbi"] = True
            ip += 1

        opcode = self.memory[ip]
        insts = self.isa.opcode_map.get(opcode)
        if not insts:
            raise UndefinedInstruction(f"未定义的操作码 0x{opcode:02X} @ 0x{ip:08X}")

        if len(insts) > 1:
            if ip + 1 >= self.mem_size_bytes:
                raise MemoryViolation(f"指令越界 @ 0x{ip:08X}")
            # 特例：COPYIP 与 SAR 共用操作码 0x5B 且都无子操作码字段。
            # 约定：字节1低半字节为 0 时是 COPYIP（长度2），否则是 SAR（长度3）。
            if opcode == 0x5B:
                low = self.memory[ip + 1] & 0x0F
                inst = self.isa.by_name["COPYIP"] if low == 0 else self.isa.by_name["SAR"]
            else:
                sub = self.memory[ip + 1] & 0x0F
                inst = self.isa.instructions.get((opcode, sub))
                if inst is None:
                    raise UndefinedInstruction(
                        f"未定义的子操作码 0x{opcode:02X}/0x{sub:X} @ 0x{ip:08X}")
        else:
            inst = insts[0]

        length = inst.format_length
        end = ip + length
        if end > self.mem_size_bytes:
            raise MemoryViolation(f"指令长度越界 @ 0x{ip:08X}")

        fields = self._parse_fields(inst, ip)
        self._apply_rex(fields, prefixes["rex"])
        raw = bytes(self.memory[start:end])
        return Decoded(inst, fields, length, prefixes, start, raw)

    def disasm(self, addr):
        """在任意地址解码一条指令（不改变状态）。返回 Decoded 对象。

        地址非法（越界 / 未定义操作码）时抛出对应的 VMError。
        """
        saved = self.ip
        self.ip = addr & MASK32
        try:
            return self.fetch_decode()
        finally:
            self.ip = saved

    def find_prev_instruction(self, addr):
        """向前查找恰好结束于 addr 的指令起始地址；找不到返回 None。

        用于反汇编窗口向后展开指令流（变长指令集的线性扫描）。
        """
        low = max(0, addr - 16)
        for a in range(addr - 1, low - 1, -1):
            try:
                dec = self.disasm(a)
            except VMError:
                continue
            if a + len(dec.raw) == addr:
                return a
        return None

    def disasm_block(self, ip, before=14, after=14):
        """返回以 ip 为中心的一串指令：[(addr, Decoded 或 None), ...]。"""
        starts = [ip]
        cur = ip
        for _ in range(before):
            prev = self.find_prev_instruction(cur)
            if prev is None:
                break
            starts.append(prev)
            cur = prev
        starts.reverse()
        lines = []
        addr = starts[0] if starts else (ip & MASK32)
        count = 0
        while count < before + after + 1 and addr < self.mem_size_bytes:
            try:
                dec = self.disasm(addr)
                lines.append((addr, dec))
                addr += len(dec.raw)
            except VMError:
                lines.append((addr, None))
                addr += 1
            count += 1
        return lines

    def _parse_fields(self, inst, ip):
        """按 format 列表解析操作数字段。"""
        mem = self.memory
        fields = {}
        off = 1                      # 第 0 字节是操作码
        pending_field = None         # 已取得高半字节的 4 位字段名
        pending_high = 0

        for token in inst.format:
            if token == "OPC":
                continue
            if token in NIBBLE_LITERALS:
                v = int(token, 16)
                if pending_field is None:
                    pending_field = token
                    pending_high = v
                else:
                    # 字面量作为低半字节：若高半字节是真实字段则保存
                    if pending_field not in NIBBLE_LITERALS:
                        fields[pending_field] = pending_high
                    off += 1
                    pending_field = None
            elif token in FOUR_BIT_FIELDS:
                if pending_field is None:
                    pending_field = token
                    pending_high = (mem[ip + off] >> 4) & 0x0F
                else:
                    low = mem[ip + off] & 0x0F
                    if pending_field not in NIBBLE_LITERALS:
                        fields[pending_field] = pending_high
                    fields[token] = low
                    off += 1
                    pending_field = None
            else:
                # 8/16/32 位字段（小端）
                size = FIELD_SIZES[token] // 8
                val = 0
                for k in range(size):
                    val |= mem[ip + off + k] << (8 * k)
                if token in SIGNED_FIELDS:
                    val = _signed(val, size * 8)
                fields[token] = val
                off += size
                pending_field = None
        return fields

    def _apply_rex(self, fields, rex):
        """REX 前缀：将 0-15 的寄存器字段扩展到 16-31。"""
        if rex == 0:
            return
        mapping = {"DRG": 0x8, "SR1": 0x4, "SR2": 0x2, "SR3": 0x1}
        for name, bit in mapping.items():
            if name in fields and (rex & bit):
                fields[name] = (fields[name] + 16) & 31

    # -------------------------------------------------------------- 控制流
    def _jump(self, target):
        self.ip = target & MASK32
        self._jumped = True

    def _branch_cond(self, cond, offset):
        if cond:
            self._jump(self.ip + offset)
        # 不跳转时由 step() 正常自增

    # ------------------------------------------------------------------ 执行
    def step(self):
        """执行一条指令。返回 False 表示已停机。"""
        if self.halted:
            return False
        self._jumped = False
        dec = self.fetch_decode()
        # 中断入栈用的"下一条指令"地址（raw 含前缀，所以用它而不是 dec.length）
        self._next_ip = (dec.start_ip + len(dec.raw)) & MASK32

        if self._trace and (self._trace_limit == 0 or self.instruction_count < self._trace_limit):
            self._print_trace(dec)

        try:
            handler = getattr(self, "_i_" + dec.inst.name.replace(" ", "_"), None)
            if handler is None:
                raise UndefinedInstruction(
                    f"指令 {dec.inst.name} 未实现 (0x{dec.inst.opcode:02X})")
            handler(dec)
        except HaltSignal:
            raise
        except DivideByZero:
            self._fault(INT_DIV, "除零错误")
        except MemoryViolation as e:
            self._fault(INT_MAV, str(e))
        except UndefinedInstruction as e:
            self._fault(INT_UDI, str(e))

        if not self._jumped:
            # 用 raw 长度（含 REX 等前缀）；dec.length 只是指令本体长度
            self.ip += len(dec.raw)
        self.instruction_count += 1
        return not self.halted

    def run(self, max_steps=0):
        """循环执行直到 HALT、出错或达到 max_steps。"""
        try:
            while not self.halted:
                if max_steps and self.instruction_count >= max_steps:
                    print(f"[VM] 达到最大指令数 {max_steps}", file=sys.stderr)
                    break
                self.step()
        except HaltSignal as e:
            if not self._trace:
                print(f"[VM] {e}")
        except VMError as e:
            print(f"[VM] 执行错误: {e}", file=sys.stderr)
            self.halted = True
        return not self.halted

    # ------------------------------------------------------------------ 打印
    def _print_trace(self, dec):
        line = f"[0x{dec.start_ip:08X}] {self._format_operands(dec.inst, dec.fields):<42} | "
        line += " ".join(f"{n}={self.gpr[i]:08X}" for i, n in enumerate(GPR_NAMES[1:5]))
        line += f"  sp={self.gpr[7]:08X}  fl=0x{self.flags:08X}"
        print(line)

    def _format_operands(self, inst, fields):
        # NOP2..NOP15 是"填充"指令：操作数字段只是占位，反汇编只显示助记符
        if _is_padding_instruction(inst.name):
            return f"{inst.name:12} "
        parts = []
        for token in inst.format:
            if token == "OPC":
                continue
            if token in NIBBLE_LITERALS or token == "SOP":
                continue
            if token in ("DRG", "SR1", "SR2", "SR3"):
                parts.append(GPR_NAMES[fields[token] & 31])
            elif token in ("DRC", "SRC", "CR"):
                parts.append(CR_NAMES[fields[token] & 3])
            elif token in ("DFR", "SF1", "SF2", "SF3"):
                parts.append(FPR_NAMES[fields[token] & 31])
            elif token == "SCL":
                parts.append(str(fields[token]))
            elif token in ("IM8", "IM16", "I16", "I32"):
                parts.append(f"0x{fields[token] & ((1 << FIELD_SIZES[token]) - 1):X}")
            elif token in ("OF8", "OF16", "O16", "O32"):
                parts.append(str(fields[token]))
            elif token in ("A16", "A32", "AD8"):
                parts.append(f"0x{fields[token] & ((1 << FIELD_SIZES[token]) - 1):X}")
            elif token == "PRT":
                parts.append(f"port 0x{fields[token]:X}")
        return f"{inst.name:12} " + ", ".join(parts)

    def dump_regs(self):
        print("=== 寄存器 ===")
        for i in range(0, 32, 4):
            print("  ".join(f"{GPR_NAMES[j]}={self.gpr[j]:08X}" for j in range(i, i + 4)))
        print(f"  ip=0x{self.ip:08X}  flags=0x{self.flags:08X}")
        print(f"  mode={self.mode}  idt=0x{self.kernel['idt']:08X}  "
              f"CR0=0x{self.cr[0]:08X} CR1=0x{self.cr[1]:08X} "
              f"CR2=0x{self.cr[2]:08X} CR3=0x{self.cr[3]:08X}")

    def dump_memory(self, start, length, base=None):
        if base is None:
            base = start
        for off in range(0, length, 16):
            chunk = bytes(self.memory[start + off: start + off + 16])
            hexs = " ".join(f"{b:02X}" for b in chunk)
            print(f"0x{start + off:08X}: {hexs}")


# ---------------------------------------------------------------------------
# 指令处理器
# ---------------------------------------------------------------------------

# 以下每个方法对应一条指令，方法名 _i_<NAME>。
# 所有处理器均在 vm.step() 内通过 getattr 分发调用。

class InstructionHandlers(VM):
    """指令处理器：继承 VM 以访问寄存器 / 内存 / 标志等辅助方法。

    每个方法对应一条指令，方法名 `_i_<NAME>`，
    由 vm.step() 通过 getattr 分发调用。
    """

    # ------------------------------------------------------------- control
    def _i_NOP(self, dec):
        pass

    def _i_ENTR(self, dec):            # MOV bp, sp
        self.write_gpr(GPR_ID["bp"], self.read_gpr(GPR_ID["sp"]))

    def _i_LEAV(self, dec):            # MOV sp, bp
        self.write_gpr(GPR_ID["sp"], self.read_gpr(GPR_ID["bp"]))

    def _i_CMP(self, dec):
        a = self.read_gpr(dec.fields["SR1"])
        b = self.read_gpr(dec.fields["SR2"])
        self._sub_with_flags(a, b)

    def _i_JMP(self, dec):
        self._jump(dec.fields["A16"])

    def _i_JMPR(self, dec):
        self._jump(self.read_gpr(dec.fields["DRG"]))

    def _i_JMPFAR(self, dec):
        self._jump(dec.fields["A32"])

    def _i_CALL(self, dec):
        self.push32(dec.start_ip + len(dec.raw))
        self._jump(dec.fields["A16"])

    def _i_CALLR(self, dec):
        self.push32(dec.start_ip + len(dec.raw))
        self._jump(self.read_gpr(dec.fields["DRG"]))

    def _i_RET(self, dec):
        self._jump(self.pop32())

    def _i_IMM(self, dec):
        self.write_gpr(dec.fields["DRG"], dec.fields["I32"])

    def _i_IMMB(self, dec):
        self.write_gpr(dec.fields["DRG"], dec.fields["IM8"] & MASK8)

    def _i_IMMBSX(self, dec):
        self.write_gpr(dec.fields["DRG"], _signed(dec.fields["IM8"], 8))

    def _i_LEA(self, dec):
        ea = (self.read_gpr(dec.fields["SR1"]) + dec.fields["OF8"]) & MASK32
        self.write_gpr(dec.fields["DRG"], ea)

    def _i_LEASC(self, dec):
        f = dec.fields
        ea = (self.read_gpr(f["SR1"]) +
              self.read_gpr(f["SR2"]) * f["SCL"] + f["OF8"]) & MASK32
        self.write_gpr(f["DRG"], ea)

    def _i_CLI(self, dec):
        self.set_flag("if", 0)

    def _i_STI(self, dec):
        self.set_flag("if", 1)

    def _i_COPYIP(self, dec):
        self.write_gpr(dec.fields["DRG"], dec.start_ip)

    def _i_NOP2(self, dec):
        pass

    def _i_NOP3(self, dec):
        pass

    def _i_NOP4(self, dec):
        pass

    def _i_NOP5(self, dec):
        pass

    def _i_NOP6(self, dec):
        pass

    def _i_NOP7(self, dec):
        pass

    def _i_NOP8(self, dec):
        pass

    def _i_NOP9(self, dec):
        pass

    def _i_NOP10(self, dec):
        pass

    def _i_NOP11(self, dec):
        pass

    def _i_NOP12(self, dec):
        pass

    def _i_NOP13(self, dec):
        pass

    def _i_NOP14(self, dec):
        pass

    def _i_NOP15(self, dec):
        pass

    # -------------------------------------------------------------- stack
    def _i_PUSH(self, dec):
        self.push32(self.read_gpr(dec.fields["DRG"]))

    def _i_POP(self, dec):
        self.write_gpr(dec.fields["DRG"], self.pop32())

    def _i_PUSH_ra(self, dec):
        self.push32(self.read_gpr(1))

    def _i_POP_ra(self, dec):
        self.write_gpr(1, self.pop32())

    def _i_PUSH_rb(self, dec):
        self.push32(self.read_gpr(2))

    def _i_POP_rb(self, dec):
        self.write_gpr(2, self.pop32())

    def _i_PUSH_rc(self, dec):
        self.push32(self.read_gpr(3))

    def _i_POP_rc(self, dec):
        self.write_gpr(3, self.pop32())

    def _i_PUSH_rd(self, dec):
        self.push32(self.read_gpr(4))

    def _i_POP_rd(self, dec):
        self.write_gpr(4, self.pop32())

    def _i_PUSH_ri(self, dec):
        self.push32(self.read_gpr(5))

    def _i_POP_ri(self, dec):
        self.write_gpr(5, self.pop32())

    def _i_PUSH_bp(self, dec):
        self.push32(self.read_gpr(6))

    def _i_POP_bp(self, dec):
        self.write_gpr(6, self.pop32())

    def _i_PUSHIMMB(self, dec):
        self.push32(dec.fields["IM8"] & MASK8)

    def _i_PUSHIMMW(self, dec):
        self.push32(dec.fields["IM16"] & MASK16)

    def _i_PUSHIMMDW(self, dec):
        self.push32(dec.fields["I32"])

    def _i_ADDSP(self, dec):
        sp = (self.gpr[GPR_ID["sp"]] + _signed(dec.fields["IM8"], 8)) & MASK32
        self.write_gpr(GPR_ID["sp"], sp)

    def _i_SUBSP(self, dec):
        sp = (self.gpr[GPR_ID["sp"]] - _signed(dec.fields["IM8"], 8)) & MASK32
        self.write_gpr(GPR_ID["sp"], sp)

    def _i_PUSHF(self, dec):
        self.push32(self.flags)

    def _i_POPF(self, dec):
        self.flags = self.pop32() & MASK32

    def _i_PUSHIP(self, dec):
        self.push32(dec.start_ip)

    def _i_LDSTVAL(self, dec):
        addr = (self.gpr[GPR_ID["sp"]] + dec.fields["OF8"]) & MASK32
        self.write_gpr(dec.fields["DRG"], self.read_mem32(addr))

    def _i_STSTVAL(self, dec):
        addr = (self.gpr[GPR_ID["sp"]] + dec.fields["OF8"]) & MASK32
        self.write_mem32(addr, self.read_gpr(dec.fields["DRG"]))

    def _i_LDSTVALOW(self, dec):
        addr = (self.gpr[GPR_ID["sp"]] + dec.fields["OF16"]) & MASK32
        self.write_gpr(dec.fields["DRG"], self.read_mem32(addr))

    def _i_STSTVALOW(self, dec):
        addr = (self.gpr[GPR_ID["sp"]] + dec.fields["OF16"]) & MASK32
        self.write_mem32(addr, self.read_gpr(dec.fields["DRG"]))

    def _i_PUSHTR(self, dec):
        f = dec.fields
        self.push32(self.read_gpr(f["SR1"]))
        self.push32(self.read_gpr(f["SR2"]))
        self.push32(self.read_gpr(f["SR3"]))

    def _i_POPTR(self, dec):
        f = dec.fields
        regs = [f["DRG"], f["SR1"], f["SR2"]]
        for r in regs:
            self.write_gpr(r, self.pop32())

    # ----------------------------------------------------------- arithmetic
    def _i_ADD(self, dec):
        f = dec.fields
        result = self._add_with_flags(self.read_gpr(f["SR1"]), self.read_gpr(f["SR2"]))
        self.write_gpr(f["DRG"], result)

    def _i_SUB(self, dec):
        f = dec.fields
        result = self._sub_with_flags(self.read_gpr(f["SR1"]), self.read_gpr(f["SR2"]))
        self.write_gpr(f["DRG"], result)

    def _i_INC(self, dec):
        v = self.read_gpr(dec.fields["SR1"])
        result = self._add_with_flags(v, 1)
        self.write_gpr(dec.fields["DRG"], result)

    def _i_DEC(self, dec):
        v = self.read_gpr(dec.fields["SR1"])
        result = self._sub_with_flags(v, 1)
        self.write_gpr(dec.fields["DRG"], result)

    def _i_NEG(self, dec):
        v = self.read_gpr(dec.fields["SR1"])
        result = (0 - v) & MASK32
        self._flags_from_arith(result, 1 if v != 0 else 0, 1 if v == 0x80000000 else 0)
        self.write_gpr(dec.fields["DRG"], result)

    def _i_ABS(self, dec):
        v = self.read_gpr(dec.fields["SR1"])
        if v & 0x80000000:
            result = (0 - v) & MASK32
        else:
            result = v
        self._flags_from_arith(result, 0, 0)
        self.write_gpr(dec.fields["DRG"], result)

    def _i_INC_rc(self, dec):
        v = self.read_gpr(3)
        result = self._add_with_flags(v, 1)
        self.write_gpr(3, result)

    def _i_DEC_rc(self, dec):
        v = self.read_gpr(3)
        result = self._sub_with_flags(v, 1)
        self.write_gpr(3, result)

    def _i_ADDIB(self, dec):
        f = dec.fields
        result = self._add_with_flags(self.read_gpr(f["SR1"]), f["IM8"] & MASK8)
        self.write_gpr(f["DRG"], result)

    def _i_SUBIB(self, dec):
        f = dec.fields
        result = self._sub_with_flags(self.read_gpr(f["SR1"]), f["IM8"] & MASK8)
        self.write_gpr(f["DRG"], result)

    def _i_ADDIDW(self, dec):
        f = dec.fields
        result = self._add_with_flags(self.read_gpr(f["SR1"]), f["I32"])
        self.write_gpr(f["DRG"], result)

    def _i_SUBIDW(self, dec):
        f = dec.fields
        result = self._sub_with_flags(self.read_gpr(f["SR1"]), f["I32"])
        self.write_gpr(f["DRG"], result)

    def _i_MUL(self, dec):
        f = dec.fields
        a, b = self.read_gpr(f["SR1"]), self.read_gpr(f["SR2"])
        result64 = a * b
        low = result64 & MASK32
        high = (result64 >> 32) & MASK32
        self.write_gpr(f["DRG"], low)
        self.write_gpr(f["SR3"], high)
        self._flags_from_arith(low, 1 if high != 0 else 0, 1 if high != 0 else 0)

    def _i_DIV(self, dec):
        f = dec.fields
        a, b = self.read_gpr(f["SR1"]), self.read_gpr(f["SR2"])
        if b == 0:
            raise DivideByZero(f"除零: {a} / 0")
        q, r = divmod(a, b)
        self.write_gpr(f["DRG"], q & MASK32)
        self.write_gpr(f["SR3"], r & MASK32)
        self._flags_from_arith(q & MASK32, 0, 0)

    def _i_SMUL(self, dec):
        f = dec.fields
        a = _signed(self.read_gpr(f["SR1"]), 32)
        b = _signed(self.read_gpr(f["SR2"]), 32)
        result64 = a * b
        low = result64 & MASK32
        high = (result64 >> 32) & MASK32
        self.write_gpr(f["DRG"], low)
        self.write_gpr(f["SR3"], high)
        self._flags_from_arith(low, 1 if high not in (0, MASK32) else 0,
                               1 if high not in (0, MASK32) else 0)

    def _i_SDIV(self, dec):
        f = dec.fields
        a = _signed(self.read_gpr(f["SR1"]), 32)
        b = _signed(self.read_gpr(f["SR2"]), 32)
        if b == 0:
            raise DivideByZero(f"有符号除零: {a} / 0")
        if a == -0x80000000 and b == -1:
            q, r = -0x80000000, 0
        else:
            q = int(a / b)
            r = a - b * q
        self.write_gpr(f["DRG"], q & MASK32)
        self.write_gpr(f["SR3"], r & MASK32)
        self._flags_from_arith(q & MASK32, 0, 0)

    def _i_RANDOM(self, dec):
        self.write_gpr(4, random.getrandbits(32))

    # ---------------------------------------------------------------- logic
    def _i_XOR(self, dec):
        f = dec.fields
        r = self.read_gpr(f["SR1"]) ^ self.read_gpr(f["SR2"])
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_AND(self, dec):
        f = dec.fields
        r = self.read_gpr(f["SR1"]) & self.read_gpr(f["SR2"])
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_OR(self, dec):
        f = dec.fields
        r = self.read_gpr(f["SR1"]) | self.read_gpr(f["SR2"])
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_NOT(self, dec):
        f = dec.fields
        r = (~self.read_gpr(f["SR1"])) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_XNOR(self, dec):
        f = dec.fields
        r = (~(self.read_gpr(f["SR1"]) ^ self.read_gpr(f["SR2"]))) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_NAND(self, dec):
        f = dec.fields
        r = (~(self.read_gpr(f["SR1"]) & self.read_gpr(f["SR2"]))) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_NOR(self, dec):
        f = dec.fields
        r = (~(self.read_gpr(f["SR1"]) | self.read_gpr(f["SR2"]))) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_XORI(self, dec):
        f = dec.fields
        r = self.read_gpr(f["SR1"]) ^ (f["IM8"] & MASK8)
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_ANDI(self, dec):
        f = dec.fields
        r = self.read_gpr(f["SR1"]) & (f["IM8"] & MASK8)
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_ORI(self, dec):
        f = dec.fields
        r = self.read_gpr(f["SR1"]) | (f["IM8"] & MASK8)
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_XNORI(self, dec):
        f = dec.fields
        r = (~(self.read_gpr(f["SR1"]) ^ (f["IM8"] & MASK8))) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_NANDI(self, dec):
        f = dec.fields
        r = (~(self.read_gpr(f["SR1"]) & (f["IM8"] & MASK8))) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_NORI(self, dec):
        f = dec.fields
        r = (~(self.read_gpr(f["SR1"]) | (f["IM8"] & MASK8))) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_XORIDW(self, dec):
        f = dec.fields
        r = self.read_gpr(f["SR1"]) ^ f["I32"]
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_ANDIDW(self, dec):
        f = dec.fields
        r = self.read_gpr(f["SR1"]) & f["I32"]
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_ORIDW(self, dec):
        f = dec.fields
        r = self.read_gpr(f["SR1"]) | f["I32"]
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_XNORIDW(self, dec):
        f = dec.fields
        r = (~(self.read_gpr(f["SR1"]) ^ f["I32"])) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_NANDIDW(self, dec):
        f = dec.fields
        r = (~(self.read_gpr(f["SR1"]) & f["I32"])) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_NORIDW(self, dec):
        f = dec.fields
        r = (~(self.read_gpr(f["SR1"]) | f["I32"])) & MASK32
        self._flags_from_logic(r)
        self.write_gpr(f["DRG"], r)

    def _i_SHL(self, dec):
        f = dec.fields
        v = self.read_gpr(f["SR1"])
        n = f["IM8"] & 31
        if n == 0:
            result, cf, of = v, 0, 0
        else:
            cf = (v >> (32 - n)) & 1
            result = (v << n) & MASK32
            of = ((v ^ result) >> 31) & 1
        self._flags_from_arith(result, cf, of)
        self.write_gpr(f["DRG"], result)

    def _i_SHR(self, dec):
        f = dec.fields
        v = self.read_gpr(f["SR1"])
        n = f["IM8"] & 31
        if n == 0:
            result, cf, of = v, 0, 0
        else:
            cf = (v >> (n - 1)) & 1
            result = v >> n
            of = 0
        self._flags_from_arith(result, cf, of)
        self.write_gpr(f["DRG"], result)

    def _i_SAR(self, dec):
        f = dec.fields
        v = self.read_gpr(f["SR1"])
        n = f["IM8"] & 31
        sign = (v >> 31) & 1
        if n == 0:
            result, cf, of = v, 0, 0
        else:
            cf = (v >> (n - 1)) & 1
            result = ((v >> n) | (-sign << (32 - n))) & MASK32
            of = 0
        self._flags_from_arith(result, cf, of)
        self.write_gpr(f["DRG"], result)

    def _i_ROL(self, dec):
        f = dec.fields
        v = self.read_gpr(f["SR1"])
        n = f["IM8"] & 31
        if n == 0:
            result, cf = v, 0
        else:
            result = ((v << n) | (v >> (32 - n))) & MASK32
            cf = result & 1
        self._flags_from_arith(result, cf, 0)
        self.write_gpr(f["DRG"], result)

    def _i_ROR(self, dec):
        f = dec.fields
        v = self.read_gpr(f["SR1"])
        n = f["IM8"] & 31
        if n == 0:
            result, cf = v, 0
        else:
            result = ((v >> n) | (v << (32 - n))) & MASK32
            cf = (result >> 31) & 1
        self._flags_from_arith(result, cf, 0)
        self.write_gpr(f["DRG"], result)

    # R 后缀：次数来自寄存器（字节2低半字节指向的 GPR，取模 32）
    def _i_SHLR(self, dec):
        self._shift_register(dec.fields, "shl")

    def _i_SHRR(self, dec):
        self._shift_register(dec.fields, "shr")

    def _i_SARR(self, dec):
        self._shift_register(dec.fields, "sar")

    def _i_ROLR(self, dec):
        self._shift_register(dec.fields, "rol")

    def _i_RORR(self, dec):
        self._shift_register(dec.fields, "ror")

    def _shift_register(self, f, kind):
        v = self.read_gpr(f["SR1"])
        # 规范里这一族指令的"移位次数寄存器"字段写死为 0x0（即 x0，恒为 0 = 不移动），
        # 解码后 fields 里没有 SR2，所以缺省按寄存器 0 处理（网页版同样行为）
        n = self.read_gpr(f.get("SR2", 0)) & 31
        if n == 0:
            result, cf, of = v, 0, 0
        elif kind == "shl":
            cf = (v >> (32 - n)) & 1
            result = (v << n) & MASK32
            of = ((v ^ result) >> 31) & 1
        elif kind == "shr":
            cf = (v >> (n - 1)) & 1
            result = v >> n
            of = 0
        elif kind == "sar":
            sign = (v >> 31) & 1
            cf = (v >> (n - 1)) & 1
            result = ((v >> n) | (-sign << (32 - n))) & MASK32
            of = 0
        elif kind == "rol":
            result = ((v << n) | (v >> (32 - n))) & MASK32
            cf = result & 1
            of = 0
        else:  # ror
            result = ((v >> n) | (v << (32 - n))) & MASK32
            cf = (result >> 31) & 1
            of = 0
        self._flags_from_arith(result, cf, of)
        self.write_gpr(f["DRG"], result)

    def _i_BTLE(self, dec):          # 对 DRG 就地做字节交换（见 README）
        v = self.read_gpr(dec.fields["DRG"])
        self.write_gpr(dec.fields["DRG"], struct.unpack(
            "<I", struct.pack(">I", v))[0] & MASK32)

    def _i_BTBE(self, dec):
        v = self.read_gpr(dec.fields["DRG"])
        self.write_gpr(dec.fields["DRG"], struct.unpack(
            "<I", struct.pack(">I", v))[0] & MASK32)

    def _i_XCHG(self, dec):
        f = dec.fields
        a = self.read_gpr(f["DRG"])
        b = self.read_gpr(f["SR1"])
        self.write_gpr(f["DRG"], b)
        self.write_gpr(f["SR1"], a)

    # --------------------------------------------------------- data transfer
    def _i_MOV(self, dec):
        self.write_gpr(dec.fields["DRG"], self.read_gpr(dec.fields["SR1"]))

    def _i_CLR_ra(self, dec):
        self.write_gpr(1, 0)

    # --------------------------------------------------------------- branch
    def _i_JZ(self, dec):
        self._branch_cond(self.get_flag("zf"), dec.fields["O16"])

    def _i_JC(self, dec):
        self._branch_cond(self.get_flag("cf"), dec.fields["O16"])

    def _i_JO(self, dec):
        self._branch_cond(self.get_flag("of"), dec.fields["O16"])

    def _i_JN(self, dec):
        self._branch_cond(self.get_flag("nf"), dec.fields["O16"])

    def _i_JNZ(self, dec):
        self._branch_cond(not self.get_flag("zf"), dec.fields["O16"])

    def _i_JNC(self, dec):
        self._branch_cond(not self.get_flag("cf"), dec.fields["O16"])

    def _i_JNO(self, dec):
        self._branch_cond(not self.get_flag("of"), dec.fields["O16"])

    def _i_JNN(self, dec):
        self._branch_cond(not self.get_flag("nf"), dec.fields["O16"])

    def _i_JL(self, dec):
        self._branch_cond(self.get_flag("nf") != self.get_flag("of"), dec.fields["O16"])

    def _i_JGE(self, dec):
        self._branch_cond(self.get_flag("nf") == self.get_flag("of"), dec.fields["O16"])

    def _i_JA(self, dec):
        self._branch_cond(self.get_flag("cf") == 0 and self.get_flag("zf") == 0,
                          dec.fields["O16"])

    def _i_JBE(self, dec):
        self._branch_cond(self.get_flag("cf") == 1 or self.get_flag("zf") == 1,
                          dec.fields["O16"])

    def _i_JLE(self, dec):
        self._branch_cond(self.get_flag("zf") == 1 or
                          self.get_flag("nf") != self.get_flag("of"),
                          dec.fields["O16"])

    def _i_JAG(self, dec):
        self._branch_cond(self.get_flag("cf") == 0 and self.get_flag("zf") == 0 and
                          self.get_flag("nf") == self.get_flag("of"),
                          dec.fields["O16"])

    # -------------------------------------------------------- condition move
    def _movc(self, dec, cond):
        if cond:
            self.write_gpr(dec.fields["DRG"], self.read_gpr(dec.fields["SR1"]))

    def _i_MOVZ(self, dec):
        self._movc(dec, self.get_flag("zf"))

    def _i_MOVC(self, dec):            # 0x31: CF=1 时 DRG = GPR[SR1]（条件移动）
        self._movc(dec, self.get_flag("cf"))

    def _i_MOVCTRL(self, dec):         # 0x95: DRC = GPR[SR1]（移动到控制寄存器）
        self._i_MOVC_ctl(dec)

    def _i_MOVO(self, dec):
        self._movc(dec, self.get_flag("of"))

    def _i_MOVN(self, dec):
        self._movc(dec, self.get_flag("nf"))

    def _i_MOVNZ(self, dec):
        self._movc(dec, not self.get_flag("zf"))

    def _i_MOVNC(self, dec):
        self._movc(dec, not self.get_flag("cf"))

    def _i_MOVNO(self, dec):
        self._movc(dec, not self.get_flag("of"))

    def _i_MOVNN(self, dec):
        self._movc(dec, not self.get_flag("nf"))

    def _i_MOVL(self, dec):
        self._movc(dec, self.get_flag("nf") != self.get_flag("of"))

    def _i_MOVGE(self, dec):
        self._movc(dec, self.get_flag("nf") == self.get_flag("of"))

    def _i_MOVA(self, dec):
        self._movc(dec, self.get_flag("cf") == 0 and self.get_flag("zf") == 0)

    def _i_MOVBE(self, dec):
        self._movc(dec, self.get_flag("cf") == 1 or self.get_flag("zf") == 1)

    def _i_MOVLE(self, dec):
        self._movc(dec, self.get_flag("zf") == 1 or
                   self.get_flag("nf") != self.get_flag("of"))

    def _i_MOVAG(self, dec):
        self._movc(dec, self.get_flag("cf") == 0 and self.get_flag("zf") == 0 and
                   self.get_flag("nf") == self.get_flag("of"))

    # ------------------------------------------------------------------- io
    def _i_IN(self, dec):
        self.write_gpr(5, self.read_port(dec.fields["PRT"]) & MASK8)

    def _i_OUT(self, dec):
        self.write_port(dec.fields["PRT"], self.read_gpr(5) & MASK8)

    # ------------------------------------------------------------ load/store
    def _i_LD(self, dec):
        f = dec.fields
        addr = (self.read_gpr(f["SR1"]) + f["OF8"]) & MASK32
        self.write_gpr(f["DRG"], self.read_mem32(addr))

    def _i_ST(self, dec):
        f = dec.fields
        addr = (self.read_gpr(f["DRG"]) + f["OF8"]) & MASK32
        self.write_mem32(addr, self.read_gpr(f["SR1"]))

    def _i_LDOFIP(self, dec):
        addr = (dec.start_ip + dec.fields["OF16"]) & MASK32
        self.write_gpr(dec.fields["DRG"], self.read_mem32(addr))

    def _i_STOFIP(self, dec):
        addr = (dec.start_ip + dec.fields["OF16"]) & MASK32
        self.write_mem32(addr, self.read_gpr(dec.fields["SR1"]))

    # --------------------------------------------------------------- system
    def _i_SYSCALL(self, dec):
        self._interrupt(self.syscall_vector)

    def _i_SYSRET(self, dec):
        self._i_IRET(dec)

    def _i_HALT(self, dec):
        self.halted = True
        raise HaltSignal("HALT 指令")

    def _i_LDIDT(self, dec):         # LD rb, [IDT]
        self.write_gpr(2, self.kernel["idt"])

    def _i_MODIDT(self, dec):        # mem32[idt + OF8] = A32
        addr = (self.kernel["idt"] + dec.fields["OF8"]) & MASK32
        self.write_mem32(addr, dec.fields["A32"])

    def _i_SETIDT(self, dec):        # idt = A32
        self.kernel["idt"] = dec.fields["A32"] & MASK32

    def _i_MOVC_ctl(self, dec):      # 0x95 MOVCTRL: DRC = GPR[SR1]
        self.write_cr(dec.fields["DRC"], self.read_gpr(dec.fields["SR1"]))

    def _i_COPC(self, dec):
        raise UndefinedInstruction("COPC: 未安装协处理器 (XTU/BMU)")

    def _i_BRK(self, dec):
        self._interrupt(INT_BRK)

    def _i_INT(self, dec):
        self._interrupt(dec.fields["IM8"] & MASK8)

    def _i_IRET(self, dec):
        self._jump(self.pop32())                 # 弹出 ip
        self.flags = self.pop32() & MASK32       # 弹出 flags


class HaynekoVM(InstructionHandlers):
    """最终 VM 类：框架 + 全部指令处理器。"""
    pass


# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------

def _default_rom():
    here = os.path.dirname(os.path.abspath(__file__))
    for name in ("rom.hvd", "rom.hvr"):
        p = os.path.join(here, name)
        if os.path.exists(p):
            return p
    return os.path.join(here, "rom.hvd")


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="vm.py",
        description="Hayneko_Arch32S 模拟器（基于 hayneko_arch32S-v1.json）")
    parser.add_argument("--isa", default="hayneko_arch32S-v1.json",
                        help="ISA 定义文件 (JSON)")
    parser.add_argument("--rom", default=None, help="ROM 文件 (1024 字节)")
    parser.add_argument("--disk", default="disk.hvd", help="磁盘文件 (256KB)")
    parser.add_argument("--mem", type=int, default=4096,
                        help="内存大小，单位 KB（1-65536）")
    parser.add_argument("--entry", default="0",
                        help="入口地址（十六进制或十进制，默认 0）")
    parser.add_argument("--sp", default=None,
                        help="初始栈指针（默认：内存顶部）")
    parser.add_argument("--syscall-vector", default=hex(SYSCALL_VECTOR),
                        help=f"SYSCALL 使用的向量（默认 {hex(SYSCALL_VECTOR)}）")
    parser.add_argument("--max-steps", type=int, default=0,
                        help="最大执行指令数（0 = 不限）")
    parser.add_argument("--trace", action="store_true",
                        help="逐条打印指令执行跟踪")
    parser.add_argument("--dump-regs", action="store_true",
                        help="执行结束后打印寄存器状态")
    parser.add_argument("--dump-mem", default=None, metavar="START:LEN",
                        help="执行结束后转储内存区域，如 0:64")
    parser.add_argument("--stats", action="store_true",
                        help="打印执行统计")
    args = parser.parse_args(argv)

    isa = ISA(args.isa)
    entry = int(args.entry, 0)
    sp = int(args.sp, 0) if args.sp else None
    syscall_vec = int(args.syscall_vector, 0)

    vm = HaynekoVM(isa, args.rom or _default_rom(), args.disk,
                   args.mem, entry=entry, initial_sp=sp,
                   syscall_vector=syscall_vec)
    vm._trace = args.trace
    vm._trace_limit = args.max_steps if args.trace else 0

    try:
        ok = vm.run(max_steps=args.max_steps)
    finally:
        vm.close()

    if args.dump_regs:
        vm.dump_regs()
    if args.dump_mem:
        start, _, length = args.dump_mem.partition(":")
        start = int(start, 0)
        length = int(length, 0) if length else 64
        vm.dump_memory(start, length)
    if args.stats:
        print(f"[VM] 指令数: {vm.instruction_count}  "
              f"ip=0x{vm.ip:08X}  halted={vm.halted}  "
              f"退出码={vm.quit_code}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
