#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hayneko_Arch32S 图形调试器 (dbg.py)
====================================

仿照 x86dbg 布局的 PyQt5 图形调试界面，用于调试 Hayneko_Arch32S 虚拟机：

    +--------------------------------------------------------------+
    | 工具栏: 重启 | 运行(F9) | 暂停 | 单步(F7) | 跳过(F8) | 跳出   |
    +-----------------------------------+--------------------------+
    |  CPU 反汇编窗口（当前指令高亮）    |  寄存器面板             |
    |  单击行 = 切换断点                +--------------------------+
    |                                   |  栈窗口（跟随 SP）       |
    |                                   +--------------------------+
    |                                   |  内存转储（可跟随寄存器）|
    +-----------------------------------+--------------------------+
    |  输出 / 日志（控制台端口输出 + 调试消息）                     |
    +--------------------------------------------------------------+

快捷键：F7=单步, F8=跳过调用, F9=运行, 单击反汇编行=切换断点。

用法：
    py -3.13 dbg.py [--rom rom.hvd] [--mem 4096] [--isa hayneko_arch32S-v1.json]
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PyQt5 import QtCore, QtGui, QtWidgets
from PyQt5.QtCore import Qt, pyqtSignal, QThread

from vm import (ISA, HaynekoVM, GPR_NAMES, CR_NAMES, GPR_ID, VMError,
                HaltSignal, _default_rom)

# 反汇编/寄存器面板中展示的标志位顺序
FLAG_DISPLAY = ["zf", "cf", "of", "nf", "df", "if", "be", "ac"]

# 界面配色（暗色主题，仿 x86dbg）
C_BG = "#1e1e1e"
C_PANEL = "#252526"
C_TEXT = "#dcdcdc"
C_DIM = "#9c9c9c"
C_REGNAME = "#4fc1ff"
C_REGVAL = "#ffffff"
C_CURR = "#ffd700"          # 当前指令黄色高亮
C_BP = "#ff3b30"            # 断点红色
C_HEADER = "#2d2d30"

APP_QSS = f"""
QMainWindow, QWidget {{ background-color: {C_BG}; color: {C_TEXT}; }}
QTableWidget {{
    background-color: {C_PANEL}; color: {C_TEXT};
    gridline-color: #3a3a3a; border: 1px solid #3a3a3a;
}}
QHeaderView::section {{
    background-color: {C_HEADER}; color: #cccccc;
    border: 1px solid #3a3a3a; padding: 2px;
}}
QPlainTextEdit {{ background-color: {C_BG}; color: {C_TEXT};
    font-family: Consolas, "Courier New", monospace; border: 1px solid #3a3a3a; }}
QLabel {{ color: {C_TEXT}; }}
QToolBar {{ background-color: {C_HEADER}; spacing: 4px; }}
QToolButton, QPushButton {{
    background-color: #333333; color: {C_TEXT}; border: 1px solid #555555;
    padding: 3px 8px; border-radius: 3px;
}}
QToolButton:hover, QPushButton:hover {{ background-color: #3d3d3d; }}
QToolButton:disabled, QPushButton:disabled {{ color: #777777; }}
QLineEdit, QComboBox {{ background-color: #333333; color: {C_TEXT};
    border: 1px solid #555555; }}
QGroupBox {{ border: 1px solid #3a3a3a; margin-top: 6px; }}
QGroupBox::title {{ subcontrol-origin: margin; left: 8px; color: #aaaaaa; }}
QStatusBar {{ background-color: #007acc; color: white; }}
"""

MONO = "Consolas"


# ---------------------------------------------------------------------------
# 后台运行线程：循环执行直到 断点 / HALT / 暂停 / 附加条件
# ---------------------------------------------------------------------------

class Runner(QThread):
    refreshed = pyqtSignal()
    finished_run = pyqtSignal(str)

    def __init__(self, vm, breakpoints, extra_cond=None, extra_reason="Step",
                 max_steps=2000000):
        super().__init__()
        self.vm = vm
        self.breakpoints = breakpoints
        self.extra_cond = extra_cond
        self.extra_reason = extra_reason
        self.max_steps = max_steps
        self._pause = False
        self.reason = "Stopped"

    def pause(self):
        self._pause = True

    def run(self):
        n = 0
        try:
            while True:
                if self._pause:
                    self.reason = "已暂停"
                    break
                if self.vm.halted:
                    self.reason = "HALT"
                    break
                if self.vm.ip in self.breakpoints:
                    self.reason = f"断点 0x{self.vm.ip:08X}"
                    break
                if self.extra_cond is not None and self.extra_cond():
                    self.reason = self.extra_reason
                    break
                if self.max_steps and n >= self.max_steps:
                    self.reason = f"达到步数上限 {self.max_steps}"
                    break
                self.vm.step()
                n += 1
                if n % 2000 == 0:
                    self.refreshed.emit()
        except HaltSignal:
            self.reason = "HALT"
        except VMError as e:
            self.reason = f"异常: {e}"
        self.finished_run.emit(self.reason)


# ---------------------------------------------------------------------------
# 带宽度上限的竖直分栏
# ---------------------------------------------------------------------------

class ClampedSplitter(QtWidgets.QSplitter):
    """竖直分栏，把自身最大宽度钳制在 max_w 以内。

    QSplitter 在布局时会重置其子控件的 maximumWidth（改为默认值），因此
    直接 setMaximumWidth 无效；这里在每次 resize 时重新钳制，保证右面板
    不会过宽，同时仍允许用户把它拖得更窄。
    """

    def __init__(self, max_w, parent=None):
        super().__init__(Qt.Vertical, parent)
        self._max_w = int(max_w)
        self.setMaximumWidth(self._max_w)

    def resizeEvent(self, event):
        self.setMaximumWidth(self._max_w)
        super().resizeEvent(event)


# ---------------------------------------------------------------------------
# 反汇编窗口
# ---------------------------------------------------------------------------

class DisasmWidget(QtWidgets.QWidget):
    bp_toggled = pyqtSignal(int)

    # 反汇编窗口尺寸：当前指令前后各保留这么多条，使视图足够大可以上下滚动，
    # 同时让当前指令在小范围内移动时无需重建窗口（避免滚动跳动）。
    W_BEFORE = 40
    W_AFTER = 40

    def __init__(self, vm_getter, breakpoints, parent=None):
        super().__init__(parent)
        self.vm_getter = vm_getter
        self.breakpoints = breakpoints
        self.current_ip = 0
        self.lines = []          # 持久化反汇编窗口 [(addr, Decoded 或 None), ...]
        self.current_row = -1

        self.table = QtWidgets.QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["BP", "地址", "字节", "反汇编"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QtWidgets.QAbstractItemView.SingleSelection)
        self.table.setShowGrid(True)
        self.table.setVerticalScrollMode(QtWidgets.QAbstractItemView.ScrollPerItem)
        f = QtGui.QFont(MONO, 12)
        self.table.setFont(f)
        self.table.setColumnWidth(0, 30)
        self.table.setColumnWidth(1, 150)
        self.table.setColumnWidth(2, 150)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.horizontalHeader().setSectionResizeMode(
            3, QtWidgets.QHeaderView.Stretch)
        lay = QtWidgets.QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(self.table)

        # 平滑滚动动画：自动跟随当前指令时逐帧插值，避免突然跳动
        self._scroll_timer = QtCore.QTimer(self)
        self._scroll_timer.setInterval(16)
        self._scroll_timer.timeout.connect(self._tick_scroll)
        self._sc_from = 0
        self._sc_to = 0
        self._sc_t = 0.0
        self._programmatic_scroll = False

        self.table.cellClicked.connect(self._on_cell_clicked)
        self.table.verticalScrollBar().valueChanged.connect(self._on_vscroll)

    def _on_cell_clicked(self, row, col):
        addr_item = self.table.item(row, 1)
        if addr_item is None:
            return
        addr = int(addr_item.text(), 16)
        self.bp_toggled.emit(addr)

    # --------------------------------------------------------- 反汇编数据
    def _rebuild_window(self, ip):
        """以 ip 为中心重建反汇编窗口（数据 + 表格内容）。"""
        vm = self.vm_getter()
        self.lines = vm.disasm_block(ip, before=self.W_BEFORE, after=self.W_AFTER)
        self._populate()

    def _row_of(self, addr):
        for r, (a, _dec) in enumerate(self.lines):
            if a == addr:
                return r
        return -1

    def _populate(self):
        """按 self.lines 填充表格并高亮当前指令（保持已有滚动位置不变）。"""
        vm = self.vm_getter()
        ip = self.current_ip
        self.table.setUpdatesEnabled(False)
        self.table.setRowCount(len(self.lines))
        current_row = -1
        for r, (addr, dec) in enumerate(self.lines):
            bp_item = QtWidgets.QTableWidgetItem(
                "●" if addr in self.breakpoints else "")
            bp_item.setTextAlignment(Qt.AlignCenter)
            bp_item.setForeground(QtGui.QBrush(QtGui.QColor(C_BP)))
            addr_item = QtWidgets.QTableWidgetItem(f"{addr:08X}")
            addr_item.setForeground(QtGui.QBrush(QtGui.QColor(C_DIM)))
            if dec is None:
                try:
                    b = vm.memory[addr]
                except Exception:
                    b = 0
                bytes_item = QtWidgets.QTableWidgetItem("??")
                insn_item = QtWidgets.QTableWidgetItem(f".byte 0x{b:02X}")
            else:
                bytes_item = QtWidgets.QTableWidgetItem(
                    dec.raw.hex(" ").upper())
                bytes_item.setForeground(QtGui.QBrush(QtGui.QColor("#7f9f7f")))
                insn_item = QtWidgets.QTableWidgetItem(
                    vm._format_operands(dec.inst, dec.fields))
            insn_item.setForeground(QtGui.QBrush(QtGui.QColor(C_TEXT)))
            self.table.setItem(r, 0, bp_item)
            self.table.setItem(r, 1, addr_item)
            self.table.setItem(r, 2, bytes_item)
            self.table.setItem(r, 3, insn_item)
            if addr == ip:
                current_row = r
                for c in range(4):
                    it = self.table.item(r, c)
                    it.setBackground(QtGui.QBrush(QtGui.QColor(C_CURR)))
                    it.setForeground(QtGui.QBrush(QtGui.QColor("#000000")))
        self.current_row = current_row
        self.table.setUpdatesEnabled(True)

    # --------------------------------------------------------- 滚动控制
    def refresh(self):
        vm = self.vm_getter()
        ip = vm.ip
        self.current_ip = ip

        row = self._row_of(ip)
        if row < 0:
            # 当前指令已离开窗口 → 以它为中心重建，并平滑定位
            self._rebuild_window(ip)
            self._auto_scroll(force_center=True)
        else:
            # 仍在窗口内：原地重建（刷新字节/断点），不打断用户滚动
            self._populate()
            self._auto_scroll(force_center=False)

    def _auto_scroll(self, force_center):
        """仅在需要时滚动：当前指令不可见（或强制居中）时平滑滚动到它。"""
        if self.current_row < 0 or self.current_row >= len(self.lines):
            return
        item = self.table.item(self.current_row, 0)
        if item is None:
            return
        vp = self.table.viewport()
        vh = vp.height()
        rect = self.table.visualItemRect(item)
        if not force_center and rect.top() >= 0 and rect.bottom() <= vh:
            return                       # 已在视口内，不打扰用户
        sb = self.table.verticalScrollBar()
        v0 = sb.value()
        # 先让 Qt 精确计算“居中”的目标滚动值，再平滑动画过去，
        # 避免 ScrollPerItem 模式下像素/行数的换算错误。
        self._programmatic_scroll = True
        try:
            self.table.scrollToItem(
                item, QtWidgets.QAbstractItemView.PositionAtCenter)
            v1 = sb.value()
            sb.setValue(v0)              # 还原后再动画
        finally:
            self._programmatic_scroll = False
        self._set_scrollbar(v1, animate=True)

    def _on_vscroll(self, value):
        """用户手动滚到窗口边缘时，把窗口向该方向平移，实现连续滚动。"""
        if self._programmatic_scroll or self._scroll_timer.isActive():
            return
        if not self.lines or not self.table.isVisible():
            return
        sb = self.table.verticalScrollBar()
        n = len(self.lines)
        if value <= 1 and self.lines[0][0] > 0:
            # 顶部：以第一行为中心重锚定，并让该行保持原位（无缝扩展）
            self._rebuild_window(self.lines[0][0])
            self._set_scrollbar(self.W_BEFORE, animate=False)
        elif value >= sb.maximum() - 1:
            n_old = n
            old_top = value
            self._rebuild_window(self.lines[-1][0])
            new_top = old_top - (n_old - 1) + self.W_BEFORE
            self._set_scrollbar(new_top, animate=False)

    def _set_scrollbar(self, target, animate):
        sb = self.table.verticalScrollBar()
        target = max(sb.minimum(), min(sb.maximum(), int(target)))
        self._programmatic_scroll = True
        try:
            if animate and self.isVisible():
                self._animate_to(target)
            else:
                sb.setValue(target)
        finally:
            self._programmatic_scroll = False

    def _animate_to(self, target):
        sb = self.table.verticalScrollBar()
        self._sc_from = sb.value()
        self._sc_to = target
        if abs(self._sc_to - self._sc_from) < 1:
            return
        self._sc_t = 0.0
        self._scroll_timer.start()

    def _tick_scroll(self):
        self._sc_t += 0.12                  # 约 8 帧 (~130ms) 完成
        sb = self.table.verticalScrollBar()
        self._programmatic_scroll = True
        try:
            if self._sc_t >= 1.0:
                self._scroll_timer.stop()
                sb.setValue(self._sc_to)
            else:
                t = 1.0 - (1.0 - self._sc_t) ** 3   # ease-out cubic
                sb.setValue(int(self._sc_from + (self._sc_to - self._sc_from) * t))
        finally:
            self._programmatic_scroll = False


# ---------------------------------------------------------------------------
# 寄存器面板
# ---------------------------------------------------------------------------

class RegistersWidget(QtWidgets.QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        gb = QtWidgets.QGroupBox("寄存器 / 标志")
        grid = QtWidgets.QGridLayout(gb)
        grid.setSpacing(15)

        self.reg_value_labels = {}
        for i in range(32):
            r = i // 4
            c = (i % 4) * 2
            name = QtWidgets.QLabel(f"{GPR_NAMES[i]}")
            name.setStyleSheet(f"color:{C_REGNAME};")
            val = QtWidgets.QLabel("00000000")
            val.setFont(QtGui.QFont(MONO, 12))
            val.setStyleSheet(f"color:{C_REGVAL};")
            self.reg_value_labels[i] = val
            grid.addWidget(name, r, c)
            grid.addWidget(val, r, c + 1)

        self.flag_label = QtWidgets.QLabel("")
        self.flag_label.setFont(QtGui.QFont(MONO, 12))
        self.flag_label.setWordWrap(True)
        grid.addWidget(self.flag_label, 9, 0, 1, 8)

        self.ctrl_label = QtWidgets.QLabel("")
        self.ctrl_label.setFont(QtGui.QFont(MONO, 12))
        self.ctrl_label.setWordWrap(True)
        grid.addWidget(self.ctrl_label, 10, 0, 1, 8)

        lay = QtWidgets.QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(gb)

    def refresh(self, vm):
        for i in range(32):
            self.reg_value_labels[i].setText(f"{vm.gpr[i]:08X}")
        flags = " ".join(f"{n.upper()}={vm.get_flag(n)}" for n in FLAG_DISPLAY)
        self.flag_label.setText("FLAGS  " + flags)
        crs = "  ".join(f"{CR_NAMES[i]}=0x{vm.cr[i]:08X}" for i in range(4))
        self.ctrl_label.setText(
            f"ip=0x{vm.ip:08X}  mode={vm.mode}  idt=0x{vm.kernel['idt']:08X}  " + crs)


# ---------------------------------------------------------------------------
# 栈窗口
# ---------------------------------------------------------------------------

class StackWidget(QtWidgets.QWidget):
    ROWS = 26

    def __init__(self, parent=None):
        super().__init__(parent)
        gb = QtWidgets.QGroupBox("栈 (SP)")
        self.table = QtWidgets.QTableWidget(self.ROWS, 2)
        self.table.setHorizontalHeaderLabels(["地址", "值"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.table.setSelectionMode(QtWidgets.QAbstractItemView.NoSelection)
        self.table.setFont(QtGui.QFont(MONO, 12))
        self.table.setColumnWidth(0, 80)
        self.table.horizontalHeader().setStretchLastSection(True)
        lay = QtWidgets.QVBoxLayout(gb)
        lay.addWidget(self.table)
        lay = QtWidgets.QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(gb)

    def refresh(self, vm):
        sp = vm.gpr[GPR_ID["sp"]]
        start = sp                 # SP 在顶部，地址向下递增：后推入的数据在最上方
        for r in range(self.ROWS):
            addr = (start + r * 4) & 0xFFFFFFFF
            a_item = QtWidgets.QTableWidgetItem(f"{addr:08X}")
            a_item.setForeground(QtGui.QBrush(QtGui.QColor(C_DIM)))
            try:
                val = vm.read_mem32(addr)
                v_item = QtWidgets.QTableWidgetItem(f"{val:08X}")
            except VMError:
                v_item = QtWidgets.QTableWidgetItem("????????")
            v_item.setForeground(QtGui.QBrush(QtGui.QColor(C_TEXT)))
            if addr == sp:
                for it in (a_item, v_item):
                    it.setBackground(QtGui.QBrush(QtGui.QColor("#3a5a7a")))
            self.table.setItem(r, 0, a_item)
            self.table.setItem(r, 1, v_item)


# ---------------------------------------------------------------------------
# 内存转储窗口
# ---------------------------------------------------------------------------

class DumpWidget(QtWidgets.QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        gb = QtWidgets.QGroupBox("内存转储")
        top = QtWidgets.QHBoxLayout()
        top.addWidget(QtWidgets.QLabel("基址:"))
        self.base_edit = QtWidgets.QLineEdit("0x00000000")
        self.base_edit.setFixedWidth(90)
        self.base_edit.returnPressed.connect(self.refresh)
        top.addWidget(self.base_edit)
        top.addWidget(QtWidgets.QLabel("跟随:"))
        self.follow_combo = QtWidgets.QComboBox()
        self.follow_combo.addItem("手动", -1)
        for i, name in enumerate(GPR_NAMES):
            self.follow_combo.addItem(name, i)
        self.follow_combo.currentIndexChanged.connect(lambda *_: self.refresh())
        top.addWidget(self.follow_combo)
        top.addStretch(1)

        self.text = QtWidgets.QPlainTextEdit()
        self.text.setReadOnly(True)
        self.text.setFont(QtGui.QFont(MONO, 12))
        self.text.setMaximumBlockCount(2000)
        # 窄面板下长行不换行，改用水平滚动条
        self.text.setLineWrapMode(QtWidgets.QPlainTextEdit.NoWrap)

        lay = QtWidgets.QVBoxLayout(gb)
        lay.addLayout(top)
        lay.addWidget(self.text)
        lay = QtWidgets.QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(gb)

    def refresh(self, vm=None):
        if vm is None:
            win = self.window()
            vm = win.vm if win is not None else None
        if vm is None:
            return
        idx = self.follow_combo.currentData()
        if idx is not None and idx >= 0:
            base = vm.gpr[idx]
        else:
            try:
                base = int(self.base_edit.text(), 0) & 0xFFFFFFFF
            except ValueError:
                base = 0
        mem = vm.memory
        lines = []
        # 每行 8 字节，便于在较窄的右侧面板内完整显示
        for off in range(0, 256, 8):
            a = (base + off) & 0xFFFFFFFF
            if a >= len(mem):
                break
            chunk = bytes(mem[a:a + 8])
            if not chunk:
                break
            hexs = " ".join(f"{b:02X}" for b in chunk)
            asc = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
            lines.append(f"{a:08X}  {hexs:<23}  |{asc}|")
        self.text.setPlainText("\n".join(lines))


# ---------------------------------------------------------------------------
# 输出 / 日志
# ---------------------------------------------------------------------------

class OutputWidget(QtWidgets.QPlainTextEdit):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setReadOnly(True)
        self.setMaximumBlockCount(5000)
        self.setFont(QtGui.QFont(MONO, 12))

    def log(self, text):
        self.appendPlainText(text)
        sb = self.verticalScrollBar()
        sb.setValue(sb.maximum())


# ---------------------------------------------------------------------------
# 主窗口
# ---------------------------------------------------------------------------

class DebuggerWindow(QtWidgets.QMainWindow):
    def __init__(self, isa, rom_file, disk_file, mem_size, entry, sp,
                 syscall_vector):
        super().__init__()
        self.setWindowTitle("Hayneko_Arch32S 调试器 (x86dbg 风格)")
        self.resize(1600, 1200)

        self.isa = isa
        self.vm = HaynekoVM(isa, rom_file, disk_file, mem_size, entry=entry,
                            initial_sp=sp, syscall_vector=syscall_vector)
        self.vm._output_cb = self._on_output
        self._out_buf = []
        self.breakpoints = set()
        self.runner = None

        self._build_ui()
        self._build_actions()

        self.refresh()
        self.log("=== 调试器就绪 ===")
        self.log(f"入口 ip=0x{self.vm.entry:08X}  sp=0x{self.vm.sp_init:08X}  "
                 f"内存={mem_size}KB  ROM={rom_file}")
        self.log("F7=单步  F8=跳过调用  F9=运行  单击反汇编行=切换断点")

    # ------------------------------------------------------------- UI 构建
    def _build_ui(self):
        self.cpu = DisasmWidget(lambda: self.vm, self.breakpoints)
        self.cpu.bp_toggled.connect(self._toggle_bp)
        self.regs = RegistersWidget()
        self.stack = StackWidget()
        self.dump = DumpWidget()

        hsplit = QtWidgets.QSplitter(Qt.Horizontal)
        hsplit.addWidget(self.cpu)

        # 右侧面板（寄存器/栈/转储）：限宽 ~580px，避免挤占反汇编窗口
        right = ClampedSplitter(580)
        right.addWidget(self.regs)
        right.addWidget(self.stack)
        right.addWidget(self.dump)
        hsplit.addWidget(right)
        right.setSizes([200, 400, 200])
        hsplit.setStretchFactor(0, 6)
        hsplit.setStretchFactor(1, 1)
        hsplit.setSizes([820, 580])

        self.output = OutputWidget()
        self.output.setFixedHeight(130)

        central = QtWidgets.QWidget()
        root = QtWidgets.QVBoxLayout(central)
        root.setContentsMargins(2, 2, 2, 2)
        root.addWidget(hsplit, 1)
        root.addWidget(self.output)
        self.setCentralWidget(central)

    def _build_actions(self):
        tb = self.addToolBar("调试")
        tb.setMovable(False)

        self.act_restart = QtWidgets.QAction("⟲ 重启", self)
        self.act_restart.triggered.connect(self.restart)
        self.act_run = QtWidgets.QAction("▶ 运行", self)
        self.act_run.setShortcut("F9")
        self.act_run.triggered.connect(self.run)
        self.act_pause = QtWidgets.QAction("⏸ 暂停", self)
        self.act_pause.triggered.connect(self.pause)
        self.act_pause.setEnabled(False)
        self.act_step = QtWidgets.QAction("⤵ 单步", self)
        self.act_step.setShortcut("F7")
        self.act_step.triggered.connect(self.step_into)
        self.act_over = QtWidgets.QAction("⤴ 跳过调用", self)
        self.act_over.setShortcut("F8")
        self.act_over.triggered.connect(self.step_over)
        self.act_out = QtWidgets.QAction("↩ 跳出", self)
        self.act_out.setShortcut("Ctrl+F8")
        self.act_out.triggered.connect(self.step_out)

        for a in (self.act_restart, self.act_run, self.act_pause,
                  self.act_step, self.act_over, self.act_out):
            tb.addAction(a)
        self.statusBar().showMessage("就绪")

    # ------------------------------------------------------------- 输出
    def _on_output(self, text):
        self._out_buf.append(text)

    def _flush_output(self):
        if self._out_buf:
            self.output.appendPlainText("".join(self._out_buf))
            self._out_buf.clear()
            sb = self.output.verticalScrollBar()
            sb.setValue(sb.maximum())

    def log(self, text):
        self.output.log(text)

    # ------------------------------------------------------------- 刷新
    def refresh(self):
        self.cpu.refresh()
        self.regs.refresh(self.vm)
        self.stack.refresh(self.vm)
        self.dump.refresh(self.vm)
        self._flush_output()
        self.statusBar().showMessage(
            f"ip=0x{self.vm.ip:08X}  halted={self.vm.halted}  "
            f"指令数={self.vm.instruction_count}  断点数={len(self.breakpoints)}")

    # ------------------------------------------------------------- 断点
    def _toggle_bp(self, addr):
        if addr in self.breakpoints:
            self.breakpoints.discard(addr)
            self.log(f"取消断点 0x{addr:08X}")
        else:
            self.breakpoints.add(addr)
            self.log(f"设置断点 0x{addr:08X}")
        self.cpu.refresh()

    # ------------------------------------------------------------- 运行控制
    def _busy(self):
        return self.runner is not None and self.runner.isRunning()

    def step_into(self):
        if self._busy():
            return
        try:
            self.vm.step()
        except HaltSignal:
            pass
        self.refresh()

    def run(self):
        if self._busy():
            return
        self._start_runner(None, "Run")

    def pause(self):
        if self._busy():
            self.runner.pause()
            self.log("暂停请求已发送…")

    def step_over(self):
        if self._busy():
            return
        dec = self.vm.disasm(self.vm.ip)
        if dec.inst.name in ("CALL", "CALLR"):
            target = self.vm.ip + dec.length
            self._start_runner(
                lambda: self.vm.ip == target, "跳过调用完成")
        else:
            self.step_into()

    def step_out(self):
        if self._busy():
            return
        entry_sp = self.vm.gpr[GPR_ID["sp"]]
        self._start_runner(
            lambda: self.vm.gpr[GPR_ID["sp"]] >= entry_sp, "跳出完成")

    def restart(self):
        if self._busy():
            self.runner.pause()
            self.runner.wait(2000)
            self.runner = None
        self.vm.reset()
        self.breakpoints.clear()
        self.log("=== 已重启 ===")
        self.refresh()

    def _start_runner(self, extra_cond, extra_reason):
        self.runner = Runner(self.vm, self.breakpoints,
                             extra_cond=extra_cond, extra_reason=extra_reason)
        self.runner.refreshed.connect(self.refresh)
        self.runner.finished_run.connect(self._on_run_finished)
        self.runner.start()
        self.act_run.setEnabled(False)
        self.act_step.setEnabled(False)
        self.act_over.setEnabled(False)
        self.act_out.setEnabled(False)
        self.act_pause.setEnabled(True)
        self.log("运行中…")

    def _on_run_finished(self, reason):
        self.runner = None
        self.act_run.setEnabled(True)
        self.act_step.setEnabled(True)
        self.act_over.setEnabled(True)
        self.act_out.setEnabled(True)
        self.act_pause.setEnabled(False)
        self.log(f"[{reason}]")
        self.refresh()

    def closeEvent(self, event):
        if self._busy():
            self.runner.pause()
            self.runner.wait(2000)
        self.vm.close()
        event.accept()


def main(argv=None):
    parser = argparse.ArgumentParser(prog="dbg.py",
                                     description="Hayneko_Arch32S 图形调试器")
    parser.add_argument("--isa", default="hayneko_arch32S-v1.json")
    parser.add_argument("--rom", default=None)
    parser.add_argument("--disk", default="disk.hvd")
    parser.add_argument("--mem", type=int, default=4096)
    parser.add_argument("--entry", default="0")
    parser.add_argument("--sp", default=None)
    parser.add_argument("--syscall-vector", default="0x40")
    args = parser.parse_args(argv)

    app = QtWidgets.QApplication(sys.argv)
    app.setStyleSheet(APP_QSS)

    isa = ISA(args.isa)
    sp = int(args.sp, 0) if args.sp else None
    win = DebuggerWindow(isa, args.rom or _default_rom(), args.disk,
                         args.mem, int(args.entry, 0), sp,
                         int(args.syscall_vector, 0))
    win.show()
    return app.exec_()


if __name__ == "__main__":
    sys.exit(main())
