# Hayneko_Arch32S 虚拟机（Python）

基于 `hayneko_arch32S-v1.json` 中定义的 **Hayneko_Arch32S** 指令集架构，
用纯 Python 实现的：

- **模拟器核心** `vm.py` — 完整执行器（指令解码 / 执行 / 中断 / 内存 / 磁盘 / I/O）
- **最小汇编器** `as.py` — 把汇编源码汇编成 ROM 镜像（供模拟器与调试器加载）
- **图形调试器** `dbg.py` — 仿 x86dbg 布局的 PyQt5 界面（反汇编 / 寄存器 / 栈 / 内存 / 断点 / 单步）

> 环境：推荐使用 Python 3.13（已安装 PyQt5、numpy 的版本）。`vm.py` 与 `as.py`
> 是纯标准库实现，任意 Python 3 均可运行；只有 `dbg.py` 需要 PyQt5。
> `simplevm.py` 是最初的框架参考，本实现是它的完整化版本。

---

## 快速开始

```bash
# 1) 汇编一个内置示例到 rom.hvd
py -3.13 as.py --demo fib -o rom.hvd            # 打印斐波那契数列
py -3.13 as.py --demo fib3 -o rom.hvd           # 递归 fib(10)
py -3.13 as.py --demo intr -o rom.hvd           # 中断 / IRET
py -3.13 as.py --demo mem -o rom.hvd            # 内存与栈
py -3.13 as.py --demo screen -o rom.hvd         # 256x256 显示屏：渐变点阵
py -3.13 as.py --demo helloworld -o rom.hvd     # 5x7 方块字：第一行 HELLO、第二行 WORLD
py -3.13 as.py --demo syscall-font -o rom.hvd   # SYSCALL 调用字体绘制库（初稿 723B）
py -3.13 as.py --demo syscall-font-opt -o rom.hvd  # 最短编码优化版（650B，屏幕一致）
py -3.13 as.py --demo isa-coverage -o rom.hvd    # ISA 体检：156 条指令 + 全部寄存器 + 内存/屏幕/中断

# 2) 命令行运行模拟器
py -3.13 vm.py --rom rom.hvd --mem 1024 --stats
py -3.13 vm.py --rom rom.hvd --trace            # 逐条跟踪

# 3) 图形调试器（仿 x86dbg）
py -3.13 dbg.py --rom rom.hvd --mem 1024
```

---

## vm.py — 模拟器核心

### 用法

```
python vm.py [--isa hayneko_arch32S-v1.json] [--rom rom.hvd] [--disk disk.hvd]
             [--mem 4096] [--entry 0] [--sp 自动] [--syscall-vector 0x40]
             [--max-steps N] [--trace] [--dump-regs] [--dump-mem START:LEN] [--stats]
```

### 架构要点（来自 JSON）

- 32 位小端字节序（`BE` 标志置位时内存多字节访问改用大端）。
- 32 个 GPR（`x0..x31`：`x0` 恒为 0，`ra/rb/rc/rd/ri/bp/sp/r8..r23/t0..t7`），
  32 个 FPR（`f0..f15` 与 `d0..d15`），4 个控制寄存器（`cr0..cr3`），
  以及内核寄存器（`mode/status/ip/idt`）。
- 标志位按 JSON 的位号实现：`ZF=0 CF=1 OF=2 NF=3 DF=4 IF=8 BE=12 AC=13`，
  状态位 `XTE=16 BME=17 CIE=18 VIE=24 PROT=30`。
- 内存布局：低 1KB 为 ROM（从 ROM 文件载入），其余为 RAM，磁盘为独立 256KB 文件。
- 前缀：`REX`（寄存器扩展 16-31）、`ISL`、`BRH_H`、`LOCK`、`XTU/BMU`、`DBI/TBI` 均可识别。
- 中断：`INT`/`IRET`/`BRK`/`SYSCALL`/`SYSRET`，IDT 由 `SETIDT/MODIDT/LDIDT` 管理。

### I/O 端口（扩展约定）

| 端口 | 方向 | 功能 |
|------|------|------|
| `0x00` | OUT | 输出 `ri & 0xFF` 对应的字符到控制台 |
| `0x01` | OUT | 以十进制输出 `ri` |
| `0x02` | IN  | 从标准输入读取一个字节到 `ri` |
| `0x10` | OUT | 以 `ri` 作为退出码停止虚拟机 |
| `0x04` | OUT | 显示屏光标：`ri` 依次送出 4 个字节，大端拼字 = `[x, y, 空, 空]` |
| `0x05` | OUT | 显示屏像素：`ri` 依次送出 4 个字节，大端拼字 = `[R, G, B, refresh]`，见下 |
| `0x20` | OUT | 磁盘读扇区：`ri`=内存地址, `rd`=LBA(512B) |
| `0x21` | OUT | 磁盘写扇区：`ri`=内存地址, `rd`=LBA(512B) |

### 256x256 小型显示屏（`0x04`/`0x05`）

`OUT` 每次只送 1 个字节，所以这两个端口各自维护一个**大端**移位寄存器，
每收满 4 个字节拼成一个 32 位字：

- `0x04 MNTRCONTROL`：第 1 字节 = x（0-255），第 0 字节 = y（0-255），高 2 字节空 —— 设置光标。
- `0x05 MNTRCOLOR`：第 3 字节 = R，第 2 字节 = G，第 1 字节 = B，第 0 字节 = refresh。
  refresh 为 `0x00` 时像素只存进缓冲区（不上屏），为 `0xFF` 时写进缓冲区**并立即刷新屏幕**
  （算一帧），其余取值整帧丢弃。

模拟器里状态在 `vm.monitor`：`buffer` / `screen`（都是 256×256×4 的 RGBA）、`x` / `y` / `frames`。
`as.py --demo screen` 是现成的例子（画 32×32 渐变点阵，最后刷新一次）；
`dbg.py` 右侧有对应的显示屏窗口。

---

## as.py — 最小汇编器

```
python as.py 源码.asm -o rom.hvd [--list] [--no-pad]
python as.py --demo hello|fib|fib3|intr|mem|screen|helloworld|syscall-font|syscall-font-opt|isa-coverage -o rom.hvd
```

**示例源码不在这个目录里**：全部放在仓库根的 `asmdemo/`（网页版读的是同一批文件），
`as.py --demo <名字>` 就是去 `../asmdemo/<名字>.asm` 取源码；文件不在会直接报出路径。
字体、显示屏总线、系统调用约定都写在 `asmdemo/README.md` 里。

支持的语法：
- 注释 `;` 或 `#`；标签 `名字:`；
- 伪指令：`.org 地址`、`.equ 名字, 值`、`.db/.dw/.dd 值,...`、`.ascii "..."`；
- 操作数：寄存器（`x0..x31/ra/rb/.../t7`）、立即数（十进制 / `0x` / `0b` / `'A'`）、
  标签引用（相对分支/偏移自动按本指令地址计算）；
- **NOP 系列（`NOP2`..`NOP15`）是填充指令**，操作数字段只是占位：
  汇编时可以整体省略（`NOP15` → `80 0F 00…`，缺的字段按 0 编码），
  也可以照常写全（`NOP15 ra, ra, ra, 0, 0, 0` → `80 1F 11 00…`）；
  反汇编时只显示助记符（`80 1F 11 00…` → `NOP15`），调试器里这类行会淡化显示。
  其他指令仍然要求操作数个数一致（`ADD ra, rb` 会报错）。

---

## dbg.py — 图形调试器（仿 x86dbg）

```
py -3.13 dbg.py --rom rom.hvd --mem 1024 [--entry 0] [--sp ...]
```

界面布局：

```
+--------------------------------------------------------------+
| 工具栏: 重启 | 运行(F9) | 暂停 | 单步(F7) | 跳过调用(F8) | 跳出 |
+-----------------------------------+--------------------------+
|  CPU 反汇编窗口（当前指令黄色高亮）|  寄存器 / 标志            |
|  单击行 = 切换断点（红色 ●）      +--------------------------+
|                                   |  栈窗口（跟随 SP 高亮）   |
|                                   +--------------------------+
|                                   |  内存转储（手动 / 跟随寄存器）|
+-----------------------------------+--------------------------+
|  输出 / 日志（端口输出 + 调试消息）                               |
+--------------------------------------------------------------+
```

功能：
- **单步 (F7)**：执行一条指令。
- **跳过调用 (F8)**：若当前是 `CALL/CALLR` 则运行到返回后；否则等效单步。
- **跳出 (Ctrl+F8)**：运行直到当前栈帧返回（SP 恢复）。
- **运行 (F9)**：运行到断点 / HALT / 暂停 / 步数上限。
- **断点**：单击反汇编某行即切换断点；命中后停在断点处并高亮。
- 反汇编窗口自动以当前 IP 为中心展开；寄存器、栈、内存实时刷新。
- 控制台端口输出显示在底部“输出”窗格。

---

## 设计约定（ISA 文档有歧义处的解释）

这些约定同时体现在 `vm.py`、`as.py` 与 README 中，修改实现前请先阅读：

1. **CMP 长度**：JSON 中 `CMP` 的 `length=3` 与其 `format`（2 字节）不符。
   统一按 `format` 推导指令长度（与汇编器一致），因此 CMP 解码为 2 字节。
2. **BTLE / BTBE**（`0x50` 子操作码 `0x0 / 0x4`）：低半字节固定为 SOP，
   因此是对 `DRG` 就地做字节交换（无法编码独立源寄存器）。
3. **SHLR/SHRR/SARR/ROLR/RORR**：移位/旋转次数取自字节 2 低半字节指向的
   寄存器（取模 32）。规范中该字段写为 `"0x0"`（即 x0，等于不移动）。
4. **COPYIP 与 SAR 共用 0x5B**：字节 1 低半字节为 0 → `COPYIP`（2 字节），
   否则 → `SAR`（3 字节）。因此 SAR 的源寄存器不能是 x0。
5. **IP 相对寻址**：`LDOFIP/STOFIP/COPYIP/PUSHIP` 与相对分支以当前指令自身的
   起始地址为基准（分支目标 = 本指令地址 + 有符号偏移）。
6. **ST 编码** `[OPC, SR1, DRG, OF8]`：SR1 字段是被存储的源寄存器（高半字节），
   DRG 字段是基址寄存器（低半字节），即 `mem32[GPR[DRG]+OF8] = GPR[SR1]`。
7. **中断约定**：响应中断时压栈 `flags`、返回地址（返回地址在栈顶）；处理程序地址 =
   `mem32[idt_reg + vector*4]`；`IRET` 依次弹出 `ip`、`flags`。
   返回地址分两种取值（本次修正：旧版两者都压当前的 `ip`）：
   * 软件中断 `INT` / `BRK` / `SYSCALL`：**下一条指令**的地址
     （`start_ip + len(raw)`，用 raw 长度是为了把前缀算进去）。旧版压的是 `INT` 自己，
     `IRET` 之后又回到那条 `INT` —— 处理程序永远退不出来，`as.py --demo intr` 会死循环；
     现在正常打印 2468 并 `HALT`。
   * 异常（除零 / 越界 / 未定义指令）：**出错那条指令**的地址，处理程序可以修正后重试
     （与 x86 的 fault 语义一致；只 `IRET` 不修就会再次触发，这是预期行为）。
8. **SYSCALL** 等价于 `INT(SYSCALL_VECTOR)`，默认向量 `0x40`（可用 `--syscall-vector` 覆盖）。
9. **HALT** 置位 halted 标志并停止执行（不自动触发 #HLT 中断）。
10. **LD / ST 均为 32 位 (dword) 访存**。
11. **相对分支偏移**使用 16 位有符号，目标 = 本指令地址 + 偏移（与第 5 条一致）。
12. **高位寄存器与 REX**（本次修正）：`r16..r23` 与 `t0..t7`（即 24..31）的 4 位寄存器字段
    放不下，汇编器会给这类指令自动加上 REX 前缀（`DRG/SR1/SR2/SR3` 的高位分别对应
    `0x8/0x4/0x2/0x1`）；以前是直接 `& 0x0F`，`r20` 会被静默改成 `r4`。相应地
    **PC 前进用含前缀的原始长度**（`len(dec.raw)`），`CALL/CALLR` 压的返回地址、
    反汇编的前后扫描也一样 —— 否则带前缀的指令执行完会落进指令中间。
    浮点字段（`DFR/SF*`）没有 REX 映射，写 `d0..d15` 会直接报错而不是静默回绕。

---

## 目录结构

```
HaynekoArch32VM_python/
├── hayneko_arch32S-v1.json   # ISA 定义（指令 / 寄存器 / 标志 / 中断向量 / 架构）
├── simplevm.py               # 最初的基础框架（参考实现）
├── vm.py                     # 模拟器核心
├── as.py                     # 最小汇编器
├── dbg.py                    # x86dbg 风格图形调试器（PyQt5）
├── rom.hvd / rom.hvr         # ROM 镜像文件
└── disk.hvd                  # 磁盘镜像（256KB）
```
