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
