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
