# asmdemo — ARCH32S 汇编示例

每个 `.asm` 都是一份可以直接汇编运行的示例。三种跑法（都需要仓库根目录作为工作目录）：

```bash
# 1) 网页：终端或快捷输入框里敲（页面上的 SAMPLE 下拉框也是同一份列表）
vm vm1 demo helloworld          # 装载示例
vm vm1 run                      # 自动运行（速率框拉到 100000 ips 最快）

# 2) 命令行汇编 + 运行（Python 参考实现）
py -3.13 HaynekoArch32VM_python/as.py --demo helloworld -o rom.hvd
py -3.13 HaynekoArch32VM_python/vm.py --rom rom.hvd --mem 1024 --stats

# 3) 图形调试器
py -3.13 HaynekoArch32VM_python/dbg.py --rom rom.hvd --mem 1024
```

| 文件 | 说明 |
| --- | --- |
| `hello.asm` | 端口输出 `Hi!` |
| `fib.asm` | 循环打印前 12 个斐波那契数 |
| `fib3.asm` | CALL/RET + 栈的递归 `fib(10)` |
| `intr.asm` | SETIDT / MODIDT / INT / IRET |
| `mem.asm` | LEA / LD / ST / PUSH / POP |
| `screen.asm` | 显示屏：缓冲区里画 32×32 渐变点阵，最后刷新一次 |
| `helloworld.asm` | 显示屏：5×7 点阵方块字，第一行 HELLO、第二行 WORLD |
| `syscall-font.asm` | 显示屏 + 系统调用：SYSCALL 调字体绘制库（**初稿**，723B ROM） |
| `syscall-font-opt.asm` | 同一程序的最短编码优化版（**650B ROM**，指令数 75307→65732，屏幕逐字节一致） |

---

## 256×256 小型显示屏总线

`OUT` 每次只送 1 个字节；同一端口每收满 4 个字节，按**大端**拼成一个 32 位字：

| 端口 | 含义 |
| --- | --- |
| `0x04` MNTRCONTROL | `[x(第1字节), y(第0字节), 空, 空]` —— 设置光标 |
| `0x05` MNTRCOLOR | `[R(第3), G(第2), B(第1), refresh(第0)]` |

`refresh` = `0x00` 只写进缓冲区（不上屏）；`0xFF` 写进缓冲区并**立即刷新**（算一帧）；
其余取值整帧丢弃。模拟器里状态在 `vm.monitor`：`buffer` / `screen`（各 256×256×4 RGBA）、
`x` / `y` / `frames`。

## 5×7 点阵字体

每个字形 8 字节（2 个字）：第 r 个字节就是第 r 行，行内 **bit4 是最左像素**、bit0 是最右，
第 7 字节补 0。渲染时一次取一个字（4 行），用 `SHR 8` 逐行下移；每行 `ANDI 0x10` 取当前列、
`SHL 1` 把下一列送到 bit4 —— 全程只用立即数移位，不需要可变位移指令。

`syscall-font.asm` 里是 A-Z + 空格共 27 个字形（216 字节）；`helloworld.asm` 只用得到的
8 个字形（64 字节）。

## 最短编码策略（见 `syscall-font-opt.asm` 的优化日志）

这个 ISA 没有字节/字/双字寄存器之分，但**编码长度差别很大**，写程序时按下面的顺序挑指令：

| 想干的事 | 长写法 | 短写法 | 省 |
| --- | --- | --- | --- |
| 装小立即数 | `IMM rX, 200`（6B） | `IMMB rX, 200`（3B，**零扩展**，0..255 都安全） | 3B |
| 加/减小常量 | `ADDIDW rX, rX, 1`（6B） | `ADDIB rX, rX, 1`（3B，-128..127） | 3B |
| 清零 | `IMMB rX, 0`（3B） | `MOV rX, x0`（2B；连续写 0 时还能省掉重装），清零ra时更可用专用 `clear ra`（1B） | 1B+ |
| 选寄存器 | `t0..t7 / r16..r23` | 尽量 `r8..r15 / rb / rc / rd / ri` | 每条 1B |
| 列/行推进 | `列号*scale` + 索引比较 | 位置递进 + 倒计数 `SUBIB`/`JNZ` | 若干 |
| 修改栈指针 | `ADDIB sp, 4`（3B） | `ADDSP 4`（2B）使用ADDSP/SUBSP快速加减sp字节常量，大常量还需通用的ADDIB/SUBIB | 1B |

**高位寄存器（r16..r23、t0..t7）每被引用一次就多一个 REX 前缀字节**（`IMM t0, 1` 是 7B、`IMM r8, 1` 是 6B；`MOV ri, t0` 是 3B、`MOV ri, r8` 是 2B），
所以热路径尽量待在 `r8..r15` 和 `ra..sp` 这些低位名字寄存器里。

## 系统调用（SYSCALL）约定

`SYSCALL` = `INT 0x40`。ISA 的 ABI 里 `system_call_parameters = ra, rc, r13, r14, r15`，
本示例就按它约定：

| 寄存器 | 含义 |
| --- | --- |
| `ra` | 调用号（同时是返回值寄存器） |
| `rc` | 参数 1：调用 1 传字符串指针、调用 2 传字符本身 |
| `r13` | 参数 2：参数块指针，块内 4 个 32 位字 = `x`, `y`, `scale`, `color(0x00RRGGBB)` |
| 返回 | `ra` = 画出的字形数 |

调用号：`1` = `draw_text`（`0x0A` 换行、`0x00` 结束）、`2` = `draw_char`。
处理程序会改写 `rb/rd/ri/r8..r12/r16..r23/t0..t7`，`ra/rc/r13/r14/r15` 按 ABI 保留。

注册入口有个坑：IDT 里每个向量占 4 字节，`SYSCALL` 的向量是 `0x40`，偏移 256；
而 `MODIDT` 的偏移字段只有 8 位（最大 127），够不到 —— 所以示例用 `SETIDT` + `ST` 直接写
`idt[0x40]`（IDT 放在 ROM 之后的 RAM 里）。
