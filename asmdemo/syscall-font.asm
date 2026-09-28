; ============================================================
; syscall-font.asm — 通过 SYSCALL 调用「字体绘制库」
;
;   ISA 的 ABI 里 system_call_parameters = ra, rc, r13, r14, r15，
;   所以这里按它约定：
;     ra  = 调用号（同时是返回值寄存器）
;     rc  = 参数 1：功能 1 传字符串指针、功能 2 传字符本身
;     r13 = 参数 2：参数块指针，块内 4 个 32 位字 = x, y, scale, color(0x00RRGGBB)
;   返回：ra = 画出的字形数
;
;   调用号：1 = draw_text（0x0A 换行、0x00 结束）；2 = draw_char
;   处理程序会改写 rb/rd/ri/r8..r12/r16..r23/t0..t7（rd 当字符串游标），
;   ra/rc/r13/r14/r15 按 ABI 保留。
;
;   注册：SYSCALL = INT 0x40，而 MODIDT 的偏移只有 8 位、够不到 0x40*4，
;   所以直接 SETIDT + ST 把入口写进 idt[0x40]（IDT 放在 ROM 之后的 RAM 里）。
;
;   字体：5x7 点阵（Mojangles 风），A-Z + 空格共 27 个字形，每个 8 字节：
;         第 r 字节 = 第 r 行（bit4 最左、bit0 最右），第 7 字节补 0。
;   显示屏总线：port 0x04 = 光标 [x,y,空,空]，port 0x05 = 像素 [R,G,B,refresh]，
;   都是大端 4 字节，refresh 0xFF 立即上屏。
; ============================================================
        .org 0x0000
start:
        SETIDT  0x0400            ; IDT 放在 ROM 后面的 RAM 里
        IMM     rb, 0x0500        ; idt + 0x40*4 = 系统调用向量
        IMM     ra, sys_entry
        ST      ra, rb, 0

        ; ---- 调用 1：画 "HELLO\nWORLD"（白色，放大 4 倍）----
        IMM     ra, 1
        IMM     rc, msg_main
        IMM     r13, par_main
        SYSCALL

        ; ---- 调用 2：画单个字符 S（青色，放大 2 倍）----
        IMM     ra, 2
        IMMB    rc, 83
        IMM     r13, par_tag
        SYSCALL

        ; ---- 调用 1：接着写 "YSCALL" ----
        IMM     ra, 1
        IMM     rc, msg_tag
        IMM     r13, par_tail
        SYSCALL
        HALT

; ------------------------------------------------ 系统调用入口（ra = 调用号）
sys_entry:
        IMM     r8, 1
        CMP     ra, r8
        JZ      sys_text
        IMM     r8, 2
        CMP     ra, r8
        JZ      sys_char
        IMM     ra, 0             ; 未知调用号：返回 0
        SYSRET

sys_char:                          ; rc = 字符, r13 = 参数块
        MOV     r16, rc
        LD      r9, r13, 0        ; x
        LD      r10, r13, 4       ; y
        LD      r11, r13, 8       ; scale
        LD      r12, r13, 12      ; color
        CALL    draw_char
        IMM     ra, 1
        SYSRET

sys_text:                          ; rc = 字符串指针, r13 = 参数块
        MOV     rd, rc            ; rd = 字符串游标
        LD      r9, r13, 0        ; x
        LD      r10, r13, 4       ; y
        LD      r11, r13, 8       ; scale
        LD      r12, r13, 12      ; color
        MOV     t0, r9            ; 记住行首 x
        IMMB    t1, 11
        MUL     t1, r11, t1, r16  ; t1 = 11 * scale = 行距
        MOV     ra, x0            ; 返回值 = 画了几个字形
sys_text_loop:
        LD      r16, rd, 0
        ANDI    r16, r16, 0xFF    ; 当前字符
        JZ      sys_text_done
        ADDIDW  rd, rd, 1
        IMMB    r17, 10
        CMP     r16, r17
        JZ      sys_text_nl
        CALL    draw_char
        ADDIB   ra, ra, 1
        IMMB    r17, 6
        MUL     r17, r11, r17, r18
        ADD     r9, r9, r17       ; x += 6 * scale
        JMP     sys_text_loop
sys_text_nl:
        MOV     r9, t0            ; 回到行首
        ADD     r10, r10, t1      ; 下一行
        JMP     sys_text_loop
sys_text_done:
        SYSRET

; ------------------------------------------------------- draw_char（画字形）
;   入参：r16 = 字符, r9 = x, r10 = y, r11 = scale, r12 = 颜色
;   只改写 r8, r17..r23, rb, t2..t7（t2 没用上）
draw_char:
        IMMB    r17, 32           ; 空格 -> 26 号字形
        CMP     r16, r17
        JZ      dc_space
        SUBIB   r17, r16, 65      ; 序号 = 字符 - 65
        IMMB    r18, 25
        CMP     r17, r18
        JA      dc_ret            ; 不在 A-Z（无符号比较：负数会变成大数）
        JMP     dc_have
dc_space:
        IMMB    r17, 26
dc_have:
        IMM     t5, font
        IMMB    r18, 8
        MUL     r18, r17, r18, r19
        ADD     r18, t5, r18      ; r18 = &font[序号]
        ROR     r19, r12, 16      ; 颜色拆成 R / G / B
        ANDI    r19, r19, 0xFF    ; R
        ROR     r20, r12, 8
        ANDI    r20, r20, 0xFF    ; G
        ANDI    r21, r12, 0xFF    ; B
        MOV     r22, r10          ; 当前行的屏幕 y
        IMMB    t4, 0             ; 行 0..6
dc_row:
        LEASC   r23, r18, 1, t4, 0
        LD      r23, r23, 0
        ANDI    r23, r23, 0xFF    ; 当前行字节
        IMMB    t6, 0             ; 列 0..4
dc_col:
        MOV     r17, r23
        ANDI    r17, r17, 0x10    ; bit4 = 当前列
        JZ      dc_col_next
        MUL     t3, t6, r11, r17
        ADD     t3, r9, t3        ; 方块左 x
        MOV     t7, x0            ; dy
dc_dy:
        CMP     t7, r11
        JGE     dc_col_next
        MOV     rb, x0            ; dx
dc_dx:
        CMP     rb, r11
        JGE     dc_next_dy
        ADD     r17, t3, rb       ; 光标 x
        ADD     r8, r22, t7       ; 光标 y
        IMMB    ri, 0
        OUT     0x04
        IMMB    ri, 0
        OUT     0x04
        MOV     ri, r17
        OUT     0x04             ; 第1字节 = x
        MOV     ri, r8
        OUT     0x04             ; 第0字节 = y
        MOV     ri, r19
        OUT     0x05             ; R
        MOV     ri, r20
        OUT     0x05             ; G
        MOV     ri, r21
        OUT     0x05             ; B
        IMMB    ri, 0xFF
        OUT     0x05             ; refresh = 0xFF -> 立即上屏
        ADDIB   rb, rb, 1
        JMP     dc_dx
dc_next_dy:
        ADDIB   t7, t7, 1
        JMP     dc_dy
dc_col_next:
        SHL     r23, r23, 1       ; 下一列送到 bit4
        ADDIB   t6, t6, 1
        IMMB    r17, 5
        CMP     t6, r17
        JL      dc_col
        ADD     r22, r22, r11     ; 下一行 y += scale
        ADDIB   t4, t4, 1
        IMMB    r17, 7
        CMP     t4, r17
        JL      dc_row
dc_ret:
        RET

; ---- 数据 ----
msg_main:
        .ascii  "HELLO"
        .db     10
        .ascii  "WORLD"
        .db     0
msg_tag:
        .ascii  "YSCALL"
        .db     0
par_main:
        .dd     70, 92, 4, 0xFFFFFF      ; x, y, scale, color
par_tag:
        .dd     87, 200, 2, 0x00E0FF
par_tail:
        .dd     99, 200, 2, 0x00E0FF

; 5x7 字体：A-Z + 空格（每个字形 8 字节 = 第 r 字节是第 r 行）
font:
        .dd     0x1F11110E, 0x00111111, 0x1E11111E, 0x001E1111
        .dd     0x1010110E, 0x000E1110, 0x1111111E, 0x001E1111
        .dd     0x1E10101F, 0x001F1010, 0x1E10101F, 0x00101010
        .dd     0x1710110E, 0x000E1111, 0x1F111111, 0x00111111
        .dd     0x0404041F, 0x001F0404, 0x01010101, 0x000E1111
        .dd     0x18141211, 0x00111214, 0x10101010, 0x001F1010
        .dd     0x11151B11, 0x00111111, 0x13151911, 0x00111111
        .dd     0x1111110E, 0x000E1111, 0x1E11111E, 0x00101010
        .dd     0x1111110E, 0x000D1215, 0x1E11111E, 0x00111214
        .dd     0x0E10100F, 0x001E0101, 0x0404041F, 0x00040404
        .dd     0x11111111, 0x000E1111, 0x11111111, 0x00040A11
        .dd     0x11111111, 0x00111B15, 0x040A1111, 0x0011110A
        .dd     0x040A1111, 0x00040404, 0x0402011F, 0x001F1008
        .dd     0x00000000, 0x00000000
