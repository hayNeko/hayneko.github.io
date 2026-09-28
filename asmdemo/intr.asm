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
