; ============================================================
; helloworld.asm — 256x256 显示屏上画方块字：第一行 HELLO，第二行 WORLD
;
;   显示屏总线（大端，每个端口收满 4 个字节拼成一个字）：
;     port 0x04 MNTRCONTROL = [x, y, 空, 空]        设置光标
;     port 0x05 MNTRCOLOR   = [R, G, B, refresh]    refresh 0xFF 立即上屏
;
;   字体：5x7 点阵（Mojangles 风），每个字母 8 字节 = 2 个字，
;         第 r 个字节就是第 r 行，行里 bit4 是最左像素、bit0 是最右。
;   渲染：一次取一个字（4 行），SHR 8 逐行下移；每行 AND 0x10 取当前列、
;         SHR 1 逐列右移 —— 只用立即数移位，不依赖可变位移指令。
; ============================================================
        .org 0x0000
start:
        IMM     r20, 70            ; 行首 x = (256 - (5*6*4 - 4)) / 2
        IMM     r21, 92            ; 第一行 y（两行共 72 像素，居中）
        IMM     r22, 4             ; 放大倍数（每个字体像素画 4x4 方块）
        IMM     r23, text          ; 文本表（glyph 序号，0xFFFF = 换行）
        IMM     t0, 11             ; 表里的条目数
        IMM     t5, font           ; 字体表基址
        IMMB    t7, 8              ; 序号 * 8 = 该字母的字节偏移
        IMMB    t3, 6
        MUL     t3, r22, t3, r8    ; t3 = 6 * scale = 一个字母的前进距离
        IMMB    t6, 11
        MUL     t6, r22, t6, r8    ; t6 = 11 * scale = 行距

next_glyph:
        CMP     t0, x0
        JZ      done
        LD      r8, r23, 0         ; 当前条目
        ADDIDW  r23, r23, 4
        SUBIB   t0, t0, 1
        IMM     r9, 0xFFFF
        CMP     r8, r9
        JZ      newline
        MUL     r9, r8, t7, r10    ; r9 = 序号 * 8
        ADD     r9, t5, r9         ; r9 = &font[序号]
        MOV     r17, r21           ; 当前行的屏幕 y（每行 += scale）
        IMMB    t1, 0              ; 第几个字（0/1）
word_loop:
        LEASC   r10, r9, 4, t1, 0  ; r10 = r9 + t1*4
        LD      r11, r10, 0        ; r11 = 这个字（4 个行字节，小端）
        MOV     r12, x0            ; 字内行号 0..3
row_loop:
        MOV     r13, r11
        ANDI    r13, r13, 0xFF     ; 取最低字节 = 当前行
        IMMB    t2, 0              ; 列 0..4
col_loop:
        MOV     r14, r13
        ANDI    r14, r14, 0x10     ; bit4 = 当前列
        JZ      col_next
        MUL     r15, t2, r22, r16  ; 方块左上角 x = 行首 + 列*scale
        ADD     r15, r20, r15
        MOV     r18, x0            ; dy
dy_loop:
        CMP     r18, r22
        JGE     col_next
        MOV     r19, x0            ; dx
dx_loop:
        CMP     r19, r22
        JGE     next_dy
        ADD     r14, r15, r19      ; 光标 x
        ADD     r16, r17, r18      ; 光标 y
        IMMB    ri, 0              ; 光标：高 2 字节空
        OUT     0x04
        IMMB    ri, 0
        OUT     0x04
        MOV     ri, r14
        OUT     0x04              ; 第1字节 = x
        MOV     ri, r16
        OUT     0x04              ; 第0字节 = y
        IMMB    ri, 0xFF
        OUT     0x05              ; R
        OUT     0x05              ; G（ri 还是 0xFF）
        OUT     0x05              ; B
        OUT     0x05              ; refresh = 0xFF -> 立即上屏
        ADDIB   r19, r19, 1
        JMP     dx_loop
next_dy:
        ADDIB   r18, r18, 1
        JMP     dy_loop
col_next:
        SHL     r13, r13, 1        ; 下一列（左移，把下一列送到 bit4）
        ADDIB   t2, t2, 1
        IMMB    r8, 5
        CMP     t2, r8
        JL      col_loop
        ADD     r17, r17, r22      ; 这一行画完，y 下移 scale
        SHR     r11, r11, 8        ; 下一行字节降到最低位
        ADDIB   r12, r12, 1
        IMMB    r8, 4
        CMP     r12, r8
        JL      row_loop
        ADDIB   t1, t1, 1
        IMMB    r8, 2
        CMP     t1, r8
        JL      word_loop
        ADD     r20, r20, t3       ; 下一个字母
        JMP     next_glyph

newline:
        IMM     r20, 70            ; 回到行首
        ADD     r21, r21, t6       ; 下一行
        JMP     next_glyph

done:
        HALT

; ---- 数据 ----
font:                          ; H E L O W R D 空格（每个 8 字节）
        .dd     0x1F111111, 0x00111111, 0x1E10101F, 0x001F1010
        .dd     0x10101010, 0x001F1010, 0x1111110E, 0x000E1111
        .dd     0x11111111, 0x00111B15, 0x1E11111E, 0x00111214
        .dd     0x1111111E, 0x001E1111, 0x00000000, 0x00000000
text:
        .dd     0, 1, 2, 2, 3, 65535, 4, 3, 5, 2, 6   ; H E L L O 换行 W O R L D
