; 256x256 小型显示屏演示：在缓冲区里画 32x32 的彩色渐变点阵，最后刷新一次
;   port 0x04 = MNTRCONTROL：4 个字节（大端）= [x(第1), y(第0), 高2字节空]
;   port 0x05 = MNTRCOLOR  ：4 个字节（大端）= [R(第3), G(第2), B(第1), refresh(第0)]
;     refresh = 0x00 存入缓冲区；0xFF 立即刷新屏幕
        .org 0x0000
start:
        IMM     rb, 0            ; 网格行 0..31
        IMMB    r11, 32          ; 循环上界
yloop:
        IMM     rc, 0            ; 网格列 0..31
xloop:
        LEASC   r8, x0, 8, rc, 0 ; r8 = x*8（屏幕坐标）
        LEASC   r9, x0, 8, rb, 0 ; r9 = y*8
        IMMB    ri, 0            ; 光标：高 2 字节空
        OUT     0x04
        IMMB    ri, 0
        OUT     0x04
        MOV     ri, r8
        OUT     0x04             ; 第1字节 = x
        MOV     ri, r9
        OUT     0x04             ; 第0字节 = y
        MOV     ri, r8
        OUT     0x05             ; R = x*8
        MOV     ri, r9
        OUT     0x05             ; G = y*8
        IMM     r10, 255
        SUB     ri, r10, r8
        OUT     0x05             ; B = 255 - x*8
        IMMB    ri, 0            ; refresh = 0 -> 只存入缓冲区
        OUT     0x05
        ADDIB   rc, rc, 1
        CMP     rc, r11
        JL      xloop
        ADDIB   rb, rb, 1
        CMP     rb, r11
        JL      yloop
        IMMB    ri, 128          ; 光标回到中间
        OUT     0x04
        IMMB    ri, 0
        OUT     0x04
        IMMB    ri, 128
        OUT     0x04
        IMMB    ri, 128
        OUT     0x04
        IMMB    ri, 255          ; 白点
        OUT     0x05
        OUT     0x05
        OUT     0x05
        IMMB    ri, 0xFF         ; refresh = 0xFF -> 立即刷新屏幕
        OUT     0x05
        HALT
