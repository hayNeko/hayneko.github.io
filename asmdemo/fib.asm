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
