#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hayneko_Arch32S 最小汇编器 (as.py)
===================================

一个针对 Hayneko_Arch32S 的小型汇编器，用于把汇编源码汇编为 ROM 镜像
（供 vm.py 模拟器运行）。它直接复用 vm.py 中从 hayneko_arch32S-v1.json
解析出的字段定义，因此只要 JSON 里的格式能描述，就能编码。

支持：
  * 注释：分号 ; 或井号 # 开头
  * 标签：`名字:`（行首）
  * 伪指令：
      .org 地址         设置当前位置
      .equ 名字, 值      定义常量
      .db 值,...         输出字节
      .dw 值,...         输出 16 位小端字
      .dd 值,...         输出 32 位小端双字
      .ascii "字符串"     输出字符串（不含结束符）
  * 操作数：
      寄存器：x0..x31, ra, rb, rc, rd, ri, sp, bp, r8..r23, t0..t7
      立即数：十进制、0x 十六进制、0b 二进制、字符 'A'、标签引用
      （相对分支/OF 字段使用标签时自动计算相对于本指令的偏移）

用法：
    python as.py 源码.asm -o rom.bin [--isa hayneko_arch32S-v1.json]
    python as.py --demo hello -o rom.bin     # 内置示例
"""

import argparse
import os
import sys

# 复用 vm.py 的字段定义与寄存器表
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vm import FIELD_SIZES, FOUR_BIT_FIELDS, NIBBLE_LITERALS, GPR_ID, \
    FPR_ID, CR_ID, ISA

ROM_SIZE = 1024


class AsmError(Exception):
    pass


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------

def strip_comment(line):
    for ch in (";", "#"):
        idx = line.find(ch)
        if idx >= 0:
            line = line[:idx]
    return line.strip()


def split_operands(s):
    """按逗号切分操作数（忽略引号内的逗号）。"""
    parts = []
    cur = ""
    in_str = False
    for ch in s:
        if ch == '"':
            in_str = not in_str
        if ch == "," and not in_str:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


def unquote_string(s):
    s = s.strip()
    if not (s.startswith('"') and s.endswith('"')):
        raise AsmError(f"需要字符串字面量，得到: {s}")
    return s[1:-1]


# ---------------------------------------------------------------------------
# 汇编器
# ---------------------------------------------------------------------------

class Assembler:
    def __init__(self, isa):
        self.isa = isa
        self.labels = {}
        self.constants = {}
        self.lines = []        # (lineno, mnemonic, rest)
        self.pc = 0

    # ---------------- 解析为逻辑行
    def _parse_lines(self, source):
        for lineno, raw in enumerate(source.splitlines(), 1):
            line = strip_comment(raw)
            if not line:
                continue
            # 处理行首标签（可能有多个）
            while ":" in line and not line.startswith("."):
                idx = line.find(":")
                lab = line[:idx].strip()
                if not lab:
                    break
                self.lines.append((lineno, ":", lab))
                line = line[idx + 1:].strip()
            if not line:
                continue
            tokens = line.split(None, 1)
            mnemonic = tokens[0]
            rest = tokens[1] if len(tokens) > 1 else ""
            self.lines.append((lineno, mnemonic, rest))

    # ---------------- 指令查找（支持 "PUSH ra" 这类精确名）
    def _find_inst(self, mnemonic, rest):
        full = (mnemonic + " " + rest).strip()
        inst = self.isa.by_name.get(full)
        if inst is not None:
            return inst, True
        return self.isa.by_name.get(mnemonic), False

    # ---------------- 第一遍：标签与常量
    def _pass1(self):
        pc = 0
        for lineno, mnemonic, rest in self.lines:
            if mnemonic == ":":
                self.labels[rest] = pc
                continue
            if mnemonic == ".org":
                pc = self._resolve(rest, pc)
                continue
            if mnemonic == ".equ":
                name, _, val = rest.partition(",")
                self.constants[name.strip()] = self._resolve(val, pc)
                continue
            if mnemonic in (".db", ".dw", ".dd"):
                n = len(split_operands(rest))
                size = {".db": 1, ".dw": 2, ".dd": 4}[mnemonic]
                pc += n * size
                continue
            if mnemonic == ".ascii":
                pc += len(unquote_string(rest).encode("utf-8"))
                continue
            if mnemonic.startswith("."):
                raise AsmError(f"未知伪指令 {mnemonic} (行 {lineno})")
            inst, exact = self._find_inst(mnemonic, rest)
            if inst is None:
                raise AsmError(f"未知指令 {mnemonic} (行 {lineno})")
            pc += inst.format_length

    def _resolve(self, tok, pc):
        tok = tok.strip()
        if tok in self.constants:
            return self.constants[tok]
        if tok in self.labels:
            return self.labels[tok]
        if tok.startswith("'") and len(tok) >= 3:
            return ord(tok[1])
        if tok.lower().startswith("0x"):
            return int(tok, 16)
        if tok.lower().startswith("0b"):
            return int(tok, 2)
        try:
            return int(tok, 10)
        except ValueError:
            raise AsmError(f"无法解析值: {tok}")

    # ---------------- 第二遍：编码
    def _pass2(self):
        out = bytearray()
        pc = 0
        for lineno, mnemonic, rest in self.lines:
            if mnemonic == ":":
                continue
            if mnemonic == ".org":
                pc = self._resolve(rest, pc)
                if len(out) < pc:
                    out += bytes(pc - len(out))
                continue
            if mnemonic == ".equ":
                continue
            if mnemonic == ".db":
                for tok in split_operands(rest):
                    out.append(self._resolve(tok, pc) & 0xFF)
                    pc += 1
                continue
            if mnemonic == ".dw":
                for tok in split_operands(rest):
                    v = self._resolve(tok, pc) & 0xFFFF
                    out += bytes([v & 0xFF, (v >> 8) & 0xFF])
                    pc += 2
                continue
            if mnemonic == ".dd":
                for tok in split_operands(rest):
                    v = self._resolve(tok, pc) & 0xFFFFFFFF
                    out += bytes([v & 0xFF, (v >> 8) & 0xFF,
                                  (v >> 16) & 0xFF, (v >> 24) & 0xFF])
                    pc += 4
                continue
            if mnemonic == ".ascii":
                data = unquote_string(rest).encode("utf-8")
                out += data
                pc += len(data)
                continue
            if mnemonic.startswith("."):
                raise AsmError(f"未知伪指令 {mnemonic} (行 {lineno})")

            inst, exact = self._find_inst(mnemonic, rest)
            operands = [] if exact else split_operands(rest)
            code = self._encode_instruction(inst, operands, pc, lineno)
            out += code
            pc += len(code)
        return bytes(out)

    # ---------------- 编码单条指令
    def _encode_instruction(self, inst, operands, pc, lineno):
        if inst.format == ["OPC"]:
            if operands:
                raise AsmError(f"{inst.name} 不需要操作数 (行 {lineno})")
            return bytes([inst.opcode])

        field_order = []
        for token in inst.format:
            if token == "OPC" or token == "SOP" or token in NIBBLE_LITERALS:
                continue
            field_order.append(token)

        if len(field_order) != len(operands):
            raise AsmError(
                f"{inst.name} 需要 {len(field_order)} 个操作数，"
                f"实际 {len(operands)} 个 (行 {lineno})")

        fields = {"SOP": inst.sub_opcode}
        for token, tok in zip(field_order, operands):
            fields[token] = self._resolve_field(token, tok, pc, lineno)

        return self._emit(inst, fields)

    def _resolve_field(self, token, tok, pc, lineno):
        if token in ("DRG", "SR1", "SR2", "SR3"):
            num, kind = self._parse_reg(tok, GPR_ID)
            if kind != "reg":
                raise AsmError(f"{token} 需要通用寄存器 (行 {lineno})")
            return num
        if token in ("DRC", "SRC", "CR"):
            num, kind = self._parse_reg(tok, CR_ID)
            if kind != "reg":
                raise AsmError(f"{token} 需要控制寄存器 (行 {lineno})")
            return num
        if token in ("DFR", "SF1", "SF2", "SF3"):
            num, kind = self._parse_reg(tok, FPR_ID)
            if kind != "reg":
                raise AsmError(f"{token} 需要浮点寄存器 (行 {lineno})")
            return num
        if token == "SCL":
            return self._resolve(tok, pc) & 0xF
        if token == "PRT":
            return self._resolve(tok, pc) & 0xFF
        if token in ("O16", "O32"):
            # 相对分支偏移：目标地址 - 本指令地址
            target = self._resolve(tok, pc)
            off = target - pc
            size = FIELD_SIZES[token]
            if off < -(1 << (size - 1)) or off > (1 << (size - 1)) - 1:
                raise AsmError(f"{token} 偏移越界 {off} (行 {lineno})")
            return off & ((1 << size) - 1)
        if token in ("OF8", "OF16"):
            # 寄存器相对偏移：直接使用该数值（有符号字节/字偏移）
            v = self._resolve(tok, pc)
            size = FIELD_SIZES[token]
            if v < -(1 << (size - 1)) or v > (1 << (size - 1)) - 1:
                raise AsmError(f"{token} 偏移越界 {v} (行 {lineno})")
            return v & ((1 << size) - 1)
        if token in ("A16", "A32", "AD8", "IM8", "IM16", "I16", "I32"):
            return self._resolve(tok, pc)
        raise AsmError(f"不支持的字段 {token} (行 {lineno})")

    @staticmethod
    def _parse_reg(tok, table):
        if tok in table:
            return table[tok], "reg"
        return 0, "none"

    def _emit(self, inst, fields):
        out = bytearray([inst.opcode])
        pending = None
        for token in inst.format:
            if token == "OPC":
                continue
            if token in NIBBLE_LITERALS:
                v = int(token, 16)
                if pending is None:
                    pending = (token, v)
                else:
                    out.append((pending[1] << 4) | v)
                    pending = None
            elif token in FOUR_BIT_FIELDS:
                v = fields[token] & 0x0F
                if pending is None:
                    pending = (token, v)
                else:
                    out.append((pending[1] << 4) | v)
                    pending = None
            else:
                size = FIELD_SIZES[token] // 8
                val = fields[token]
                for k in range(size):
                    out.append((val >> (8 * k)) & 0xFF)
                pending = None
        return bytes(out)

    def assemble(self, source):
        self._parse_lines(source)
        self._pass1()
        return self._pass2()


# ---------------------------------------------------------------------------
# 内置示例
# ---------------------------------------------------------------------------

DEMO_PROGRAMS = {
    "hello": """
; 使用端口输出字符 'H' 'i' '!'，然后 HALT
        .org 0x0000
start:
        IMMB    ri, 'H'      ; ri = 'H'
        OUT     0x00         ; 输出字符
        IMMB    ri, 'i'
        OUT     0x00
        IMMB    ri, '!'
        OUT     0x00
        IMMB    ri, 10       ; 换行
        OUT     0x00
        HALT
""",
    "fib": """
; 计算并打印前 12 个斐波那契数（每行一个）
        .org 0x0000
start:
        IMM     ra, 0        ; a = 0
        IMM     rb, 1        ; b = 1
        IMM     rc, 12       ; 计数
loop:
        MOV     ri, ra       ; ri = a
        OUT     0x01         ; 打印整数
        IMMB    ri, 10
        OUT     0x00         ; 换行
        ADD     r8, ra, rb   ; r8 = a + b
        MOV     ra, rb
        MOV     rb, r8
        SUBIB   rc, rc, 1    ; rc = rc - 1
        JNZ     loop
        HALT
""",
    "fib3": """
; 用 CALL/RET + 栈 实现递归斐波那契 fib(10)，并打印
; 递归 fib: n 在 rb，结果在 ra
        .org 0x0000
main:
        IMMB    rb, 10       ; n = 10
        CALL    fib
        MOV     ri, ra       ; 结果 -> ri
        OUT     0x01         ; 打印
        IMMB    ri, 10
        OUT     0x00
        HALT

fib:                        ; 保存被调用者使用的寄存器
        PUSH    rb
        PUSH    rc
        IMMB    r8, 2
        CMP     rb, r8       ; 比较 n 与 2
        JC      base         ; n < 2 -> base
        MOV     rc, rb       ; 保存 n
        SUBIB   rb, rb, 1    ; fib(n-1)
        CALL    fib
        PUSH    ra           ; 暂存 fib(n-1)（避免被后续调用覆盖）
        SUBIB   rb, rc, 2    ; fib(n-2)
        CALL    fib
        POP     r9           ; r9 = fib(n-1)
        ADD     ra, r9, ra   ; ra = fib(n-1) + fib(n-2)
        JMP     done
base:
        MOV     ra, rb       ; fib(0)=0, fib(1)=1
done:
        POP     rc
        POP     rb
        RET
""",
    "intr": """
; 中断演示：设置 IDT，触发 INT，处理器进入中断处理并 IRET
        .org 0x0000
start:
        SETIDT  idt          ; IDT 寄存器 = idt 表地址
        MODIDT  0, handler   ; idt[0] = handler (向量 0 = #BRK)
        IMM     ra, 1234
        INT     0            ; 触发向量 0
        MOV     ri, ra
        OUT     0x01
        HALT
handler:                      ; 中断处理程序：ra *= 2
        ADD     ra, ra, ra
        IRET
idt:
""",
    "mem": """
; 内存与栈演示：LEA / LD / ST / PUSH / POP
        .org 0x0000
start:
        IMM     rb, 0x1000    ; 缓冲区基址
        IMM     ra, 0x11223344
        ST      ra, rb, 0     ; [rb+0] = ra
        LEA     r8, rb, 4     ; r8 = rb + 4
        ST      ra, r8, 0     ; [r8] = ra
        LD      rd, r8, 0     ; rd = [r8]
        MOV     ri, rd
        OUT     0x01
        IMMB    ri, 10
        OUT     0x00
        PUSH    ra            ; 压栈
        POP     r9            ; 弹栈
        MOV     ri, r9
        OUT     0x01
        HALT
""",
}


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="as.py",
        description="Hayneko_Arch32S 最小汇编器")
    parser.add_argument("source", nargs="?", help="汇编源文件（省略则用 --demo）")
    parser.add_argument("-o", "--output", default="rom.hvd", help="输出 ROM 文件")
    parser.add_argument("--isa", default="hayneko_arch32S-v1.json",
                        help="ISA 定义文件")
    parser.add_argument("--demo", default=None,
                        choices=list(DEMO_PROGRAMS.keys()),
                        help="使用内置示例程序")
    parser.add_argument("--no-pad", action="store_true",
                        help="不把输出补齐到 1024 字节")
    parser.add_argument("--list", action="store_true", help="显示标签表")
    args = parser.parse_args(argv)

    if args.source:
        with open(args.source, "r", encoding="utf-8") as f:
            source = f.read()
    elif args.demo:
        source = DEMO_PROGRAMS[args.demo]
    else:
        parser.error("需要提供源文件或 --demo")

    isa = ISA(args.isa)
    asm = Assembler(isa)
    data = asm.assemble(source)

    if not args.no_pad:
        if len(data) > ROM_SIZE:
            raise AsmError(f"程序 {len(data)} 字节超过 ROM 大小 {ROM_SIZE}")
        data = data + bytes(ROM_SIZE - len(data))

    with open(args.output, "wb") as f:
        f.write(data)
    print(f"已写出 {len(data)} 字节 -> {args.output}")
    if args.list:
        for name, addr in sorted(asm.labels.items(), key=lambda x: x[1]):
            print(f"  0x{addr:04X}  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
