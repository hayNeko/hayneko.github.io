; ============================================================
; isa-coverage.asm — ISA 体检程序（156 条指令一条不落，顺序已打乱）
;
;   目的：同时体检 汇编器（每条都能编码）、反汇编器（反汇编文本再汇编回去字节一致）、
;         执行引擎（每条都真的被执行到，两个实现除随机数外逐字节一致）。
;
;   为什么不会死循环 / 不会提前收尾 / 不会跳过指令：
;     * 栈：**每一次 POP 都有配对的 PUSH**（单独出现的 POP ra/rb/... 一律补 PUSH）。
;       页面上 sp 默认在内存顶端（sp = memSize），空栈上多弹一次就会读到越界 -> #MAV，
;       兜底处理程序会直接跳 done，后面的指令就全被跳过了 —— 这正是之前只跑 113 步的原因。
;     * LDSTVAL/STSTVAL/LDSTVALOW/STSTVALOW 是"栈相对"寻址（sp + 偏移）：偏移必须给负值
;       （本文件用 -4 / -8）。给 0 的话，页面上 sp 正好等于 memSize，sp+0 就越界 -> #MAV 提前收尾。
;     * 寄存器分两类：t5=内存基址、t4=索引、bp/sp 由栈指令照顾，这几个从不作为目的寄存器，
;       所以任何位置的 ST/LD/LEA/LEASC 都在合法地址上。
;     * DIV/SDIV/SMUL/MUL 的操作数在执行前用 IMMB 现填成非 0，不会除零。
;     * 跳转目标就是紧随其后的标签；CALL 就地 RET、PUSH 就地 POP、ENTR 就地 LEAV，
;       打乱顺序不会拆散这些配对。
;     * IDT：0/16 号向量（#BRK、INT 4）挂"正常返回"的处理程序，
;       4/8/12/20/24/28（#DIV/#NMI/#HLT/#MAV/#UDI/#PGF）挂"直接跳 done"的兜底；
;       万一还有意外异常也只收尾，不会跳回 0 从头再来。
;     * COPCTRL 必然抛 #UDI（ISA 没协处理器），故意放最后一条：它执行一次、兜底收尾。
;
;   已知的 ISA 数据二义性（程序里绕开）：BTLE/BTBE 没有 SOP 字段却带 sub_opcode，
;     和 0x50 家族的 SOP 半字节撞车（这里 BTLE 用 x0、BTBE 用 rd 规避）；
;     通用/带寄存器名成对的别名（DEC 与 DEC rc 等）反汇编只显示其中一种。
;
;   打乱顺序用固定种子的 LCG（20240607），文件内容可复现。
; ============================================================
        .org 0x0000
start:
        SETIDT  0x0400
        MODIDT  0, int_handler       ; #BRK：正常返回
        MODIDT  4, fault_handler     ; #DIV：兜底
        MODIDT  8, fault_handler     ; #NMI
        MODIDT  12, fault_handler    ; #HLT
        MODIDT  16, int_handler      ; INT 4：正常返回
        MODIDT  20, fault_handler    ; #MAV
        MODIDT  24, fault_handler    ; #UDI（COPCTRL 走这里）
        MODIDT  28, fault_handler    ; #PGF
        IMM     rb, 0x0500
        IMM     ra, sys_handler
        ST      ra, rb, 0
        IMMB    ra, 8      ; 触碰 ra
        IMMB    rb, 15      ; 触碰 rb
        IMMB    rc, 22      ; 触碰 rc
        IMMB    rd, 29      ; 触碰 rd
        IMMB    ri, 36      ; 触碰 ri
        IMMB    bp, 43      ; 触碰 bp
        IMMB    r8, 57      ; 触碰 r8
        IMMB    r9, 64      ; 触碰 r9
        IMMB    r10, 71      ; 触碰 r10
        IMMB    r11, 78      ; 触碰 r11
        IMMB    r12, 85      ; 触碰 r12
        IMMB    r13, 2      ; 触碰 r13
        IMMB    r14, 9      ; 触碰 r14
        IMMB    r15, 16      ; 触碰 r15
        IMMB    r16, 23      ; 触碰 r16
        IMMB    r17, 30      ; 触碰 r17
        IMMB    r18, 37      ; 触碰 r18
        IMMB    r19, 44      ; 触碰 r19
        IMMB    r20, 51      ; 触碰 r20
        IMMB    r21, 58      ; 触碰 r21
        IMMB    r22, 65      ; 触碰 r22
        IMMB    r23, 72      ; 触碰 r23
        IMMB    t0, 79      ; 触碰 t0
        IMMB    t1, 86      ; 触碰 t1
        IMMB    t2, 3      ; 触碰 t2
        IMMB    t3, 10      ; 触碰 t3
        IMMB    t4, 17      ; 触碰 t4
        IMMB    t5, 24      ; 触碰 t5
        IMMB    t6, 31      ; 触碰 t6
        IMMB    t7, 38      ; 触碰 t7
        IMM     t5, 0x2000          ; 内存基址（绝不作为目的寄存器）
        IMM     t4, 4               ; 索引
        IMM     t6, msg
        IMM     ra, 0x11223344
        ST      ra, t5, 0
        LD      rd, t5, 0
        LEA     r10, t5, 8
        ST      rd, r10, 0
        IMM     rb, 40
        IMM     rc, 40
        IMMB    ri, 0
        OUT     0x04
        IMMB    ri, 0
        OUT     0x04
        MOV     ri, rb
        OUT     0x04
        MOV     ri, rc
        OUT     0x04
        IMMB    ri, 0xFF
        OUT     0x05
        OUT     0x05
        OUT     0x05
        OUT     0x05
        IMMB    ri, 42
        OUT     0x00
        INT     4
        BRK
        SYSCALL
        IN      0x02
        XNOR     t2, t3, t6
        IMMB    rd, 3
        IMMB    ri, 5
        SMUL     r9, rd, ri, r8
        JL     L8
L8:
        SHL     r21, r22, 0x10
        JO     L18
L18:
        JGE     L7
L7:
        MOVBE     r11, r12
        ROL     t6, t7, 0x10
        IMMB     r13, 0x10
        ADDIB     r8, r9, 0x10
        NOP13
        NOP15
        LD     r20, t5, 0
        JNC     L14
L14:
        JA     L3
L3:
        NANDI     r21, r22, 0x10
        MOVNC     t1, t2
        PUSH ra     
        POP     ra
        JLE     L9
L9:
        NOP4
        NOP7
        JNN     L15
L15:
        SUBIB     r20, r21, 0x10
        MOVGE     r17, r18
        STI     
        ANDIDW     r17, r18, 0x10
        PUSHIMMB     0x12
        POP     ra
        ROR     rc, rd, 0x10
        RORR     ri, r8
        MOVNN     t3, t6
        PUSH    r16
        POP     r16
        XORI     r9, r10, 0x10
        NANDIDW     r23, t0, 0x10
        ANDI     r15, r16, 0x10
        NOT     ri, r8
        MOVLE     r21, r22
        PUSH rb     
        POP     rb
        PUSH    rb
        POP rb
        IMMB    r17, 3
        IMMB    r18, 5
        SDIV     r20, r17, r18, r19
        XNORI     t7, ra, 0x10
        MOVAG     r9, r10
        NOP2
        PUSH    ri
        POP ri
        STSTVAL     r14, -4
        JMPFAR  L11
L11:
        SAR     r9, r10, 0x10
        ADD     rc, rd, ri
        IMM     r17, L12
        JMPR    r17
L12:
        PUSH ri     
        POP     ri
        LDSTVAL     r22, -4
        XCHG     t0, t1
        MOVZ     r8, r9
        JAG     L4
L4:
        NOP12
        NEG     t1, t2
        IMMB    r14, 3
        IMMB    r15, 5
        MUL     r17, r14, r15, r16
        ABS     ra, rb
        IMM     t1, L2
        CALLR   t1
L2:
        POP     t2
        XORIDW     r11, r12, 0x10
        DEC rc     
        JMP     L10
L10:
        MOVNO     t7, ra
        NOP8
        NOP     
        SARR     r11, r12
        NOP5
        XNORIDW     rb, rc, 0x10
        NOP11
        JC     L6
L6:
        ADDIDW     r10, r11, 0x10
        JN     L13
L13:
        CLI     
        LEASC     rb, t5, 2, t4, 0
        PUSHIMMDW     0x12345678
        POP     rb
        NOP10
        JZ     L19
L19:
        MOVO     rd, ri
        PUSHIMMW     0x1234
        POP     rc
        MOVA     ri, r8
        PUSH rd     
        POP     rd
        CLR ra     
        ORIDW     r14, r15, 0x10
        PUSH    rd
        POP rd
        SHRR     t3, t6
        NAND     r18, r19, r20
        STSTVALOW     r16, -8
        BTLE     t0, x0
        PUSH bp     
        POP     ri
        NORI     ra, rb, 0x10
        NORIDW     rc, rd, 0x10
        MOVNZ     rb, rc
        SHLR     r23, t0
        INC     r15, r16
        MOVL     r19, r20
        NOR     t3, t6, t7
        LDSTVALOW     t0, -8
        LEA     t3, t5, 0
        ROLR     ra, rb
        JNO     L16
L16:
        OR     r9, r10, r11
        SUB     r17, r18, r19
        AND     r12, r13, r14
        PUSH    rc
        POP rc
        ORI     r12, r13, 0x10
        PUSH    ra
        POP ra
        JNZ     L17
L17:
        PUSH rc     
        POP     rc
        JBE     L5
L5:
        PUSH     r17
        POP     rd
        MOV     rc, rd
        NOP14
        IMMBSX     r14, 0x10
        XOR     rd, ri, r8
        ST     r12, t5, 0
        DEC     t7, ra
        IMM     r12, 0x10
        MOVCTRL     cr2, r16
        NOP3
        SHR     t1, t2, 0x10
        CMP     t3, t6
        INC rc     
        MOVC     r13, r14
        BTBE     r21, rd
        NOP9
        IMMB    r8, 3
        IMMB    r9, 5
        DIV     r11, r8, r9, r10
        NOP6
        CALL    S1
        JMP     C1
S1:
        RET
C1:
        MOVN     r23, t0
        PUSH    bp
        POP bp
        SUBIDW     r22, r23, 0x10
        PUSHF
        POPF
        PUSHIP
        POP     ri
        PUSHTR  ra, rb, rc
        POPTR   ra, rb, rc
        COPYIP  r11
        LDOFIP  r12, 0
        STOFIP  r13, 0x800
        LDIDT
        RANDOM
        ENTR
        LEAV
        ADDSP   16
        SUBSP   16
        IN      0x02
        IMMB    ri, 46
        OUT     0x00
        COPCTRL t2, cr0            ; 最后：必定 #UDI，兜底收尾
done:
        HALT

int_handler:
        IRET
sys_handler:
        SYSRET
fault_handler:
        POP     ra                  ; 把出错指令的返回地址换成 done
        IMM     ra, done
        PUSH    ra
        IRET

idt_data:
        .dd     0
msg:
        .ascii  "COVERAGE"
        .db     0
