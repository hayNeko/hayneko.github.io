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
