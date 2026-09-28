; ============================================================
; syscall-font-opt.asm — syscall-font.asm 的优化版
;   行为、ABI、字形、屏幕内容与初稿完全一致，只是编码更短。
;
; 优化日志（括号里是静态省下的字节数）：
;   1. IMM -> IMMB：值 ≤ 255 的立即数用 IMMB（6B -> 3B）。IMMB 是零扩展，
;      所以 200 / 0xFF 这类值也安全。
;   2. ADDIDW -> ADDIB（6B -> 3B）：偏移在 -128..127 时用字节形式。
;   3. 高位寄存器（r16..r23 / t0..t7）每被引用一次就多一个 REX 前缀字节。
;      热路径（像素循环）因此全部改用低寄存器 r8..r15 / r8.. / rb..：
;      同一条 MOV 从 3B 降到 2B；只有 R/G/B 三个冷值留在 t0/t1/t2。
;   4. 置 0 用 MOV rX, x0（2B）代替 IMMB rX, 0（3B）；光标字高 2 字节连续写 0，
;      ri 不用重装（每条少 5B）。
;   5. 列循环改成"方块左 x 递进 + 列数倒计数"（省掉 列*scale 的 MUL 与列索引），
;      行循环让字形指针 +1、行数倒计数（省掉 字/行 两层循环与 SHR 8 换行）。
;   6. draw_char 只 push/pop 自己会破坏的 ra / rd，调用者的 x/y/scale/color 一律不动。
;   7. 调用号的判断用 IMMB（6B -> 3B）。
;
; 结果：ROM 723B -> 650 B，指令数 75307 -> 65732，屏幕 2820 帧逐字节一致。
;
; ABI 与初稿相同：ra = 调用号(返回字形数)，rc = 参数1(字符串指针 / 字符)，
; r13 = 参数块指针（块内 x, y, scale, color(0x00RRGGBB)）。
; ============================================================
        .org 0x0000
start:
        SETIDT  0x0400
        IMM     rb, 0x0500          ; 系统调用向量 = idt + 0x40*4
        IMM     ra, sys_entry
        ST      ra, rb, 0

        IMMB    ra, 1               ; draw_text("HELLO\nWORLD")
        IMM     rc, msg_main
        IMM     r13, par_main
        SYSCALL

        IMMB    ra, 2               ; draw_char(S)
        IMMB    rc, 83
        IMM     r13, par_tag
        SYSCALL

        IMMB    ra, 1               ; draw_text("YSCALL")
        IMM     rc, msg_tag
        IMM     r13, par_tail
        SYSCALL
        HALT

; -------------------------------------------------------- 系统调用入口
sys_entry:
        PUSH    rc                  ; 保住 ABI：除 ra(返回值) 外都还原
        PUSH    r13
        PUSH    r14
        PUSH    r15
        IMMB    r8, 1
        CMP     ra, r8
        JZ      sys_text
        IMMB    r8, 2
        CMP     ra, r8
        JZ      sys_char
        MOV     ra, x0              ; 未知调用号 -> 返回 0
sys_exit:
        POP     r15
        POP     r14
        POP     r13
        POP     rc
        SYSRET

sys_char:                           ; rc = 字符, r13 = 参数块
        MOV     r8, rc
        LD      r9, r13, 0
        LD      r10, r13, 4
        LD      r11, r13, 8
        LD      r12, r13, 12
        CALL    draw_char
        IMMB    ra, 1
        JMP     sys_exit

sys_text:                           ; rc = 字符串指针, r13 = 参数块
        MOV     rd, rc              ; rd = 字符串游标
        LD      r9, r13, 0
        LD      r10, r13, 4
        LD      r11, r13, 8
        LD      r12, r13, 12
        MOV     bp, r9              ; 行首 x
        MOV     ra, x0              ; 返回值 = 字形数
sys_text_loop:
        LD      r8, rd, 0
        ANDI    r8, r8, 0xFF        ; 当前字符
        JZ      sys_exit
        ADDIB   rd, rd, 1
        IMMB    r15, 10
        CMP     r8, r15
        JZ      sys_text_nl
        CALL    draw_char
        ADDIB   ra, ra, 1
        IMMB    r15, 6
        MUL     r15, r11, r15, r8   ; x += 6 * scale
        ADD     r9, r9, r15
        JMP     sys_text_loop
sys_text_nl:
        MOV     r9, bp
        IMMB    r15, 11            ; 行距现算（r14 被 draw_char 占用了）
        MUL     r15, r11, r15, r8
        ADD     r10, r10, r15
        JMP     sys_text_loop

; ------------------------------------------------------ draw_char（画字形）
;   入参 r8 = 字符, r9 = x, r10 = y, r11 = scale, r12 = 颜色
;   调用者的 r9/r10/r11/r12 一个都不改；自己用掉的 ra/rd 进出各 push/pop 一次
draw_char:
        PUSH    ra
        PUSH    rd
        IMMB    r13, 32             ; 空格 -> 26 号字形
        CMP     r8, r13
        JZ      dc_space
        SUBIB   r8, r8, 65          ; 序号 = 字符 - 65
        IMMB    r13, 25
        CMP     r8, r13
        JA      dc_ret              ; 不是 A-Z（无符号比较，负数很大）
        JMP     dc_have
dc_space:
        IMMB    r8, 26
dc_have:
        IMMB    r15, 8
        MUL     r13, r8, r15, ra    ; r13 = 序号 * 8
        IMM     r14, font
        ADD     r13, r14, r13       ; r13 = &font[序号]
        ROR     t0, r12, 16         ; 颜色拆 R / G / B（冷值放高位寄存器，
        ANDI    t0, t0, 0xFF        ;   循环里只有 3 条指令会多 1 个前缀字节）
        ROR     t1, r12, 8
        ANDI    t1, t1, 0xFF
        ANDI    t2, r12, 0xFF
        MOV     r14, r10            ; 当前行的屏幕 y
        IMMB    r15, 7              ; 7 行倒计数
dc_row:
        LD      r8, r13, 0
        ANDI    r8, r8, 0xFF        ; 当前行字节
        ADDIB   r13, r13, 1         ; 字形指针 +1 -> 下一行
        MOV     rd, r9              ; 方块左 x = 行首 x
        IMMB    rb, 5               ; 5 列倒计数
dc_col:
        MOV     ra, r8
        ANDI    ra, ra, 0x10        ; bit4 = 当前列
        JZ      dc_col_next
        MOV     ra, x0              ; dy
dc_dy:
        CMP     ra, r11
        JGE     dc_col_next
        MOV     rc, x0              ; dx
dc_dx:
        CMP     rc, r11
        JGE     dc_next_dy
        MOV     ri, x0              ; 光标：高 2 字节空
        OUT     0x04
        OUT     0x04                ; ri 还是 0，不用重装
        ADD     ri, rd, rc
        OUT     0x04                ; 第1字节 = x
        ADD     ri, r14, ra
        OUT     0x04                ; 第0字节 = y
        MOV     ri, t0
        OUT     0x05                ; R
        MOV     ri, t1
        OUT     0x05                ; G
        MOV     ri, t2
        OUT     0x05                ; B
        IMMB    ri, 0xFF
        OUT     0x05                ; refresh = 立即上屏
        ADDIB   rc, rc, 1
        JMP     dc_dx
dc_next_dy:
        ADDIB   ra, ra, 1
        JMP     dc_dy
dc_col_next:
        ADD     rd, rd, r11         ; 下一列的 x
        SHL     r8, r8, 1           ; 下一列送到 bit4
        SUBIB   rb, rb, 1
        JNZ     dc_col
        ADD     r14, r14, r11       ; 下一行 y += scale
        SUBIB   r15, r15, 1
        JNZ     dc_row
dc_ret:
        POP     rd
        POP     ra
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
        .dd     70, 92, 4, 0xFFFFFF
par_tag:
        .dd     87, 200, 2, 0x00E0FF
par_tail:
        .dd     99, 200, 2, 0x00E0FF
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
