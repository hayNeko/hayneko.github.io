'use strict';

/* HY486 BIOS: a self-written, sectioned 16-bit real-mode ROM.

   SOURCE is assembled by I486.Assembler into exactly 64 KB at 0xF0000; the
   reset vector sits at image offset 0xFFF0 (physical 0xFFFF0) and far-jumps to
   the entry symbol 'post'.  machine.js caches the built image, so the ROM is
   assembled once per page load.  Registers and segments follow the conventions
   documented at the top of SOURCE. */

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SOURCE = `
; =============================================================================
; HY486 BIOS - a self-written 16-bit real-mode BIOS for the i486DX PC.
;
; Assembled with I486.Assembler (NASM-style dialect) into a 64 KB ROM at
; 0xF0000.  The reset vector at 0xFFFF0 far-jumps to 'post' with CS=0xF000.
;
; Conventions used throughout this ROM:
;   * DS = 0 for every BIOS variable, the IVT, the BDA and RAM buffers.  ROM
;     constants are read with a cs: override, so DS never has to hold 0xF000
;     and no label arithmetic is needed for string addresses.
;   * Interrupt handlers return results in registers; when a flag must be
;     reported (CF / ZF) the saved FLAGS image is patched by set_return_flags.
; =============================================================================
bits 16
org 0xF0000

ROMBASE  equ 0xF0000
ROMSEG   equ 0xF000
EBDA     equ 0x9F00

; --- low memory BIOS variables (linear addresses, DS = 0) --------------------
V_BOOTDRV  equ 0x0500
V_ATTR     equ 0x0501
V_WMODE    equ 0x0502
V_HEADS    equ 0x0504
V_SPT      equ 0x0506
V_CYL      equ 0x0508
V_SECTORS  equ 0x050A
V_DISKOK   equ 0x050E
V_LASTERR  equ 0x050F
V_E820CNT  equ 0x0510
V_LINELEN  equ 0x0512
V_ARG      equ 0x0514
V_DUMPADR  equ 0x0516
V_FUNC     equ 0x0518
V_AL       equ 0x0519
V_STRSEG   equ 0x051C
V_STROFF   equ 0x051E
V_BUFSEG   equ 0x0520
V_DAPSEG   equ 0x0522
V_RBX      equ 0x0526
V_RCX      equ 0x0528
V_RDX      equ 0x052A
V_RSI      equ 0x052C
V_REQCNT   equ 0x052E
V_SROW     equ 0x0530
V_SSRC     equ 0x0531
V_SN       equ 0x0532
V_SATTR    equ 0x0533
V_SX0      equ 0x0534
V_SX1      equ 0x0535
V_SY0      equ 0x0536
V_SY1      equ 0x0537
V_SDIR     equ 0x0538
; INT 13h reports and decodes CHS through one translation that the 10-bit
; cylinder / 6-bit sector fields can express: 16 heads, 63 sectors, cylinders
; rounded up and clamped to 1023.  The ATA IDENTIFY geometry stays untouched.
V_LHEADS   equ 0x0539
V_LSPT     equ 0x053A
V_LCYL     equ 0x053C
V_FLAGS    equ 0x051A
V_DAP      equ 0x0580
V_LINEBUF  equ 0x0540
V_LBA      equ 0x05D0
IDBUF      equ 0x0600
E820BUF    equ 0x9000
E820ENT    equ 20

; --- BIOS data area (DS = 0) -------------------------------------------------
BDA_EBDA   equ 0x040E
BDA_EQUIP  equ 0x0410
BDA_MEMKB  equ 0x0413
BDA_SHIFT  equ 0x0417
BDA_KHEAD  equ 0x041A
BDA_KTAIL  equ 0x041C
BDA_KBUF   equ 0x041E
BDA_KBEND  equ 0x043E
BDA_MODE   equ 0x0449
BDA_COLS   equ 0x044A
BDA_REGEN  equ 0x044C
BDA_CUR    equ 0x0450
BDA_CSHAPE equ 0x0460
BDA_CRTC   equ 0x0463
BDA_TICKS  equ 0x046C
BDA_TROLL  equ 0x0470
BDA_HDD    equ 0x0475
BDA_KBUFST equ 0x0480
BDA_KBUFEN equ 0x0482

; =============================================================================
; POST
; =============================================================================
post:
    cli
    cld
    xor     ax, ax
    mov     ds, ax
    mov     es, ax
    mov     ss, ax
    mov     sp, 0x7C00

    ; clear the 256-byte BIOS data area
    mov     di, 0x0400
    mov     cx, 0x0080
    xor     ax, ax
    rep     stosw

    ; A20 gate on through port 0x92; bit 0 (fast reset) stays clear
    in      al, 0x92
    or      al, 0x02
    and     al, 0xFE
    out     0x92, al

    ; ------------------------------------------------------------ BDA defaults
    mov     word [BDA_EQUIP], 0x0222
    mov     word [BDA_MEMKB], 640
    mov     word [BDA_EBDA], EBDA
    mov     word [BDA_KBUFST], 0x001E
    mov     word [BDA_KBUFEN], 0x003E
    mov     word [BDA_KHEAD], 0x001E
    mov     word [BDA_KTAIL], 0x001E
    mov     word [BDA_COLS], 80
    mov     word [BDA_REGEN], 0x1000
    mov     word [BDA_CUR], 0
    mov     word [BDA_CSHAPE], 0x0607
    mov     word [BDA_CRTC], 0x03D4
    mov     word [BDA_TICKS], 0
    mov     word [BDA_TICKS+2], 0
    mov     byte [BDA_MODE], 3
    mov     byte [BDA_HDD], 1
    mov     byte [V_ATTR], 0x07
    mov     byte [V_WMODE], 3
    mov     byte [V_BOOTDRV], 0x80
    mov     byte [V_DISKOK], 0
    mov     byte [V_LASTERR], 0
    mov     byte [BDA_SHIFT], 0

    ; ------------------------------------------------------- chipset bring-up
    call    pic_init
    call    pit_init
    call    cmos_init
    call    kbc_flush
    mov     al, 0xAE                    ; enable the keyboard interface
    out     0x64, al
    call    vga_mode3
    call    ivt_init
    call    e820_init
    call    disk_identify

    ; -------------------------------------------------------------- greet
    sti
    mov     si, msg_banner - ROMBASE
    call    print_rom
    mov     si, msg_copy - ROMBASE
    call    print_rom
    mov     si, msg_cpu - ROMBASE
    call    print_rom
    call    print_memory
    mov     si, msg_dev - ROMBASE
    call    print_rom
    call    print_disk
    call    print_e820
    mov     si, msg_boot - ROMBASE
    call    print_rom
    int     0x19

; -----------------------------------------------------------------------------
; Program the 8259A pair: master 08h-0Fh, slave 70h-77h, IRQ0/IRQ1 unmasked.
; -----------------------------------------------------------------------------
pic_init:
    push    ax
    mov     al, 0x11
    out     0x20, al
    out     0xA0, al
    mov     al, 0x08
    out     0x21, al
    mov     al, 0x70
    out     0xA1, al
    mov     al, 0x04
    out     0x21, al
    mov     al, 0x02
    out     0xA1, al
    mov     al, 0x01
    out     0x21, al
    out     0xA1, al
    mov     al, 0xFC                    ; timer and keyboard only
    out     0x21, al
    mov     al, 0xFF
    out     0xA1, al
    pop     ax
    ret

; -----------------------------------------------------------------------------
; Program the 8254: counter 0 in mode 3 with divider 65536 (18.2 Hz tick).
; -----------------------------------------------------------------------------
pit_init:
    push    ax
    mov     al, 0x36
    out     0x43, al
    xor     al, al
    out     0x40, al
    out     0x40, al
    mov     al, 0xB6                    ; counter 2, mode 3 (speaker gate)
    out     0x43, al
    xor     al, al
    out     0x42, al
    out     0x42, al
    pop     ax
    ret

; -----------------------------------------------------------------------------
; CMOS: force 24-hour timekeeping.
; -----------------------------------------------------------------------------
cmos_init:
    push    ax
    mov     al, 0x0B
    out     0x70, al
    in      al, 0x71
    or      al, 0x02
    mov     ah, al
    mov     al, 0x0B
    out     0x70, al
    mov     al, ah
    out     0x71, al
    pop     ax
    ret

; -----------------------------------------------------------------------------
; Discard whatever the 8042 still holds in its output buffer.
; -----------------------------------------------------------------------------
kbc_flush:
    push    ax
    push    cx
    mov     cx, 32
.flush:
    in      al, 0x64
    test    al, 0x01
    jz      .empty
    in      al, 0x60
    loop    .flush
.empty:
    pop     cx
    pop     ax
    ret

; =============================================================================
; POST reporting helpers
; =============================================================================
print_memory:
    push    ax
    mov     si, msg_ram - ROMBASE
    call    print_rom
    call    cmos_above_kb
    call    put_dec_word
    mov     si, msg_ram2 - ROMBASE
    call    print_rom
    pop     ax
    ret

print_disk:
    push    ax
    mov     si, msg_disk - ROMBASE
    call    print_rom
    cmp     byte [V_DISKOK], 1
    jne     .none
    mov     si, msg_hddname - ROMBASE
    call    print_rom
    mov     ax, [V_CYL]
    call    put_dec_word
    mov     si, msg_cyl - ROMBASE
    call    print_rom
    mov     al, [V_HEADS]
    xor     ah, ah
    call    put_dec_word
    mov     si, msg_heads - ROMBASE
    call    print_rom
    mov     ax, [V_SPT]
    call    put_dec_word
    mov     si, msg_spt - ROMBASE
    call    print_rom
    mov     ax, [V_SECTORS]
    call    put_dec_word
    mov     si, msg_sect - ROMBASE
    call    print_rom
    jmp     .done
.none:
    mov     si, msg_none - ROMBASE
    call    print_rom
.done:
    pop     ax
    ret

print_e820:
    push    ax
    mov     si, msg_e820 - ROMBASE
    call    print_rom
    mov     ax, [V_E820CNT]
    call    put_dec_word
    mov     si, msg_e820b - ROMBASE
    call    print_rom
    pop     ax
    ret

; =============================================================================
; Text console: teletype through VGA text memory and the CRTC cursor.
; =============================================================================
; AL = character.  Preserves every register.
tt:
    push    ax
    push    bx
    push    cx
    push    dx
    push    di
    push    es
    call    tt_core
    call    sync_cursor
    pop     es
    pop     di
    pop     dx
    pop     cx
    pop     bx
    pop     ax
    ret

tt_core:
    cmp     al, 0x0D
    je      tt_cr
    cmp     al, 0x0A
    je      tt_lf
    cmp     al, 0x08
    je      tt_bs
    cmp     al, 0x07
    je      tt_bell
    cmp     al, 0x09
    je      tt_tab
    cmp     byte [V_WMODE], 3
    jne     tt_bell
    call    tt_store
    mov     ax, [BDA_CUR]
    inc     ax
    cmp     ax, 2000
    jb      .keep
    call    scroll_up1
    mov     ax, 1920
.keep:
    mov     [BDA_CUR], ax
tt_bell:
    ret

tt_cr:
    mov     ax, [BDA_CUR]
    mov     bx, 80
    xor     dx, dx
    div     bx
    mul     bx
    mov     [BDA_CUR], ax
    ret

tt_lf:
    mov     ax, [BDA_CUR]
    mov     bx, 80
    xor     dx, dx
    div     bx
    inc     ax
    cmp     ax, 25
    jb      .fit
    call    scroll_up1
    mov     ax, 24
.fit:
    mul     bx
    mov     [BDA_CUR], ax
    ret

tt_bs:
    mov     ax, [BDA_CUR]
    or      ax, ax
    jz      .first
    dec     ax
    mov     [BDA_CUR], ax
    mov     al, ' '
    call    tt_store
.first:
    ret

tt_tab:
    push    cx
    mov     cx, 4
.next:
    mov     al, ' '
    call    tt
    loop    .next
    pop     cx
    ret

; Write AL with the current attribute at the cursor cell; ES is preserved.
tt_store:
    push    ax
    push    bx
    push    es
    mov     bx, 0xB800
    mov     es, bx
    mov     bx, [BDA_CUR]
    shl     bx, 1
    mov     [es:bx], al
    mov     ah, [V_ATTR]
    mov     [es:bx+1], ah
    pop     es
    pop     bx
    pop     ax
    ret

; Scroll the whole text screen up one row and blank the last row.
scroll_up1:
    push    ax
    push    cx
    push    si
    push    di
    push    ds
    push    es
    mov     ax, 0xB800
    mov     ds, ax
    mov     es, ax
    mov     si, 160
    xor     di, di
    mov     cx, 1920
    cld
    rep     movsw
    mov     di, 3840
    mov     cx, 80
    mov     ax, 0x0720
    rep     stosw
    pop     es
    pop     ds
    pop     di
    pop     si
    pop     cx
    pop     ax
    ret

; Mirror the cursor position into CRTC registers 0Eh/0Fh.
sync_cursor:
    push    ax
    push    dx
    mov     dx, 0x3D4
    mov     al, 0x0E
    out     dx, al
    inc     dx
    mov     ax, [BDA_CUR]
    mov     al, ah
    out     dx, al
    dec     dx
    mov     al, 0x0F
    out     dx, al
    inc     dx
    mov     ax, [BDA_CUR]
    out     dx, al
    pop     dx
    pop     ax
    ret

; SI = offset of a NUL-terminated string inside the ROM (CS-relative).
print_rom:
    push    ax
    push    si
.next:
    mov     al, cs:[si]
    inc     si
    or      al, al
    jz      .done
    call    tt
    jmp     .next
.done:
    pop     si
    pop     ax
    ret

; AL = byte as two hex digits.
put_hex_byte:
    push    ax
    push    cx
    mov     ah, al
    mov     cl, 4
    shr     al, cl
    call    .nib
    mov     al, ah
    call    .nib
    pop     cx
    pop     ax
    ret
.nib:
    and     al, 0x0F
    cmp     al, 10
    jb      .digit
    add     al, 7
.digit:
    add     al, '0'
    call    tt
    ret

; AX = word as four hex digits.
put_hex_word:
    push    ax
    mov     al, ah
    call    put_hex_byte
    pop     ax
    call    put_hex_byte
    ret

; AX = word in decimal.
put_dec_word:
    push    ax
    push    bx
    push    cx
    push    dx
    xor     cx, cx
    mov     bx, 10
.digit:
    xor     dx, dx
    div     bx
    push    dx
    inc     cx
    or      ax, ax
    jnz     .digit
.emit:
    pop     ax
    add     al, '0'
    call    tt
    loop    .emit
    pop     dx
    pop     cx
    pop     bx
    pop     ax
    ret

; =============================================================================
; Video modes
; =============================================================================
vga_mode3:
    push    ax
    push    cx
    push    di
    push    es
    ; chain-4 off: planar text mode (the sequencer drives the mode switch)
    mov     dx, 0x3C4
    mov     al, 0x04
    out     dx, al
    inc     dx
    mov     al, 0x02
    out     dx, al
    ; CRTC: start address 0, cursor shape 6/7
    mov     dx, 0x3D4
    mov     al, 0x0C
    out     dx, al
    inc     dx
    xor     al, al
    out     dx, al
    dec     dx
    mov     al, 0x0D
    out     dx, al
    inc     dx
    xor     al, al
    out     dx, al
    dec     dx
    mov     al, 0x0A
    out     dx, al
    inc     dx
    mov     al, 0x06
    out     dx, al
    dec     dx
    mov     al, 0x0B
    out     dx, al
    inc     dx
    mov     al, 0x07
    out     dx, al
    ; blank the text buffer
    mov     ax, 0xB800
    mov     es, ax
    xor     di, di
    mov     cx, 2048
    mov     ax, 0x0720
    cld
    rep     stosw
    mov     word [BDA_CUR], 0
    mov     byte [BDA_MODE], 3
    mov     byte [V_WMODE], 3
    call    sync_cursor
    pop     es
    pop     di
    pop     cx
    pop     ax
    ret

vga_mode13:
    push    ax
    push    cx
    push    di
    push    es
    mov     dx, 0x3C4
    mov     al, 0x04
    out     dx, al
    inc     dx
    mov     al, 0x0E                    ; chain-4 on: 320x200x256
    out     dx, al
    mov     ax, 0xA000
    mov     es, ax
    xor     di, di
    mov     cx, 32000
    xor     ax, ax
    cld
    rep     stosw
    mov     byte [BDA_MODE], 0x13
    mov     byte [V_WMODE], 0x13
    pop     es
    pop     di
    pop     cx
    pop     ax
    ret

; =============================================================================
; Interrupt vector table
; =============================================================================
ivt_init:
    push    ax
    push    bx
    push    cx
    push    di
    push    si
    push    dx
    mov     di, 0
    mov     cx, 256
    mov     ax, int_default - ROMBASE
    mov     bx, ROMSEG
.fill:
    mov     [di], ax
    mov     [di+2], bx
    add     di, 4
    loop    .fill
    ; faults that push an error code get the stack-cleaning stub
    mov     ax, 8
    mov     dx, int_fault - ROMBASE
    call    setvec
    mov     ax, 10
    mov     dx, int_fault - ROMBASE
    call    setvec
    mov     ax, 11
    mov     dx, int_fault - ROMBASE
    call    setvec
    mov     ax, 12
    mov     dx, int_fault - ROMBASE
    call    setvec
    mov     ax, 13
    mov     dx, int_fault - ROMBASE
    call    setvec
    mov     ax, 14
    mov     dx, int_fault - ROMBASE
    call    setvec
    mov     ax, 17
    mov     dx, int_fault - ROMBASE
    call    setvec
    ; the service table
    mov     si, vec_table - ROMBASE
.loader:
    mov     ax, cs:[si]
    test    ax, ax
    jz      .done
    mov     dx, cs:[si+2]
    push    si
    call    setvec
    pop     si
    add     si, 4
    jmp     .loader
.done:
    pop     dx
    pop     si
    pop     di
    pop     cx
    pop     bx
    pop     ax
    ret

; AX = vector number, DX = handler offset inside the ROM.
setvec:
    push    ax
    push    bx
    push    si
    mov     si, ax
    shl     si, 1
    shl     si, 1
    mov     [si], dx
    mov     word [si+2], ROMSEG
    pop     si
    pop     bx
    pop     ax
    ret

int_default:
    iret

; Error-code faults leave their code on the stack.
int_fault:
    add     sp, 2
    iret

; Patch the saved FLAGS image of the calling handler.  V_FLAGS holds the bits
; to set (0x01 CF, 0x40 ZF) and both are cleared first.  Call with no other
; pushes outstanding.
set_return_flags:
    push    bp
    mov     bp, sp
    push    ax
    push    bx
    mov     ax, [bp+8]
    or      ax, 0x0002
    and     ax, 0xFFBE
    mov     bl, [V_FLAGS]
    and     bl, 0x41
    mov     bh, 0
    or      ax, bx
    mov     [bp+8], ax
    pop     bx
    pop     ax
    pop     bp
    ret

; =============================================================================
; Memory size and the E820 map
; =============================================================================
; AX = KB of RAM above the 1 MB boundary, from CMOS 0x30/0x31.
cmos_above_kb:
    push    bx
    mov     al, 0x30
    out     0x70, al
    in      al, 0x71
    mov     bl, al
    mov     al, 0x31
    out     0x70, al
    in      al, 0x71
    mov     ah, al
    mov     al, bl
    pop     bx
    ret

e820_init:
    push    ax
    push    bx
    push    cx
    push    di
    push    es
    xor     ax, ax
    mov     es, ax
    mov     di, E820BUF
    ; 0x00000000 .. 0x0009FC00 usable
    mov     dword [di], 0
    mov     dword [di+4], 0
    mov     dword [di+8], 0x0009FC00
    mov     dword [di+12], 0
    mov     dword [di+16], 1
    ; 0x0009FC00 .. 0x000A0000 reserved (EBDA top of conventional memory)
    add     di, E820ENT
    mov     dword [di], 0x0009FC00
    mov     dword [di+4], 0
    mov     dword [di+8], 0x00000400
    mov     dword [di+12], 0
    mov     dword [di+16], 2
    ; 0x000F0000 .. 0x00100000 reserved (this ROM)
    add     di, E820ENT
    mov     dword [di], 0x000F0000
    mov     dword [di+4], 0
    mov     dword [di+8], 0x00010000
    mov     dword [di+12], 0
    mov     dword [di+16], 2
    ; 0x00100000 .. top of RAM usable
    add     di, E820ENT
    mov     dword [di], 0x00100000
    mov     dword [di+4], 0
    call    cmos_above_kb
    mov     dx, ax
    and     ax, 0x003F
    shl     ax, 10
    mov     cl, 6
    shr     dx, cl                      ; DX:AX = KB * 1024
    mov     [di+8], ax
    mov     [di+10], dx
    mov     dword [di+12], 0
    mov     dword [di+16], 1
    mov     word [V_E820CNT], 4
    pop     es
    pop     di
    pop     cx
    pop     bx
    pop     ax
    ret

; =============================================================================
; ATA PIO helpers
; =============================================================================
; Wait for BSY=0 and DRQ=1 on the primary status port; CF=1 on error.
ata_wait_drq:
    push    cx
    push    dx
    mov     cx, 0x4000
.poll:
    mov     dx, 0x1F7
    in      al, dx
    test    al, 0x80
    jnz     .again
    test    al, 0x01
    jnz     .error
    test    al, 0x08
    jnz     .ready
.again:
    loop    .poll
    jmp     .error
.ready:
    pop     dx
    pop     cx
    clc
    ret
.error:
    pop     dx
    pop     cx
    stc
    ret

; Read the IDENTIFY block of the master drive and cache its geometry.
disk_identify:
    push    ax
    push    bx
    push    cx
    push    dx
    push    di
    push    es
    xor     ax, ax
    mov     es, ax
    mov     dx, 0x1F6
    mov     al, 0xA0
    out     dx, al
    mov     dx, 0x1F2
    mov     cx, 4
.zero:
    xor     al, al
    out     dx, al
    inc     dx
    loop    .zero
    mov     dx, 0x1F7
    mov     al, 0xEC
    out     dx, al
    call    ata_wait_drq
    jc      .missing
    mov     di, IDBUF
    mov     cx, 256
    mov     dx, 0x1F0
.words:
    in      ax, dx
    stosw
    loop    .words
    cmp     word [IDBUF], 0
    je      .missing
    cmp     word [IDBUF], 0xFFFF
    je      .missing
    ; a drive that reports no capacity is treated as absent
    cmp     word [IDBUF+120], 0
    jne     .capacity
    cmp     word [IDBUF+122], 0
    je      .missing
.capacity:
    mov     ax, [IDBUF+108]
    mov     [V_CYL], ax
    mov     ax, [IDBUF+110]
    mov     [V_HEADS], al
    mov     ax, [IDBUF+112]
    mov     [V_SPT], ax
    mov     ax, [IDBUF+120]
    mov     [V_SECTORS], ax
    mov     ax, [IDBUF+122]
    mov     [V_SECTORS+2], ax
    mov     byte [V_DISKOK], 1
    call    disk_translate
    jmp     .done
.missing:
    mov     byte [V_DISKOK], 0
    mov     word [V_CYL], 0
    mov     byte [V_HEADS], 16
    mov     word [V_SPT], 255
    mov     dword [V_SECTORS], 0
    mov     byte [V_LHEADS], 16
    mov     word [V_LSPT], 63
    mov     word [V_LCYL], 0
.done:
    pop     es
    pop     di
    pop     dx
    pop     cx
    pop     bx
    pop     ax
    ret

; Derive the CHS geometry INT 13h reports from the drive capacity.  AH=08h
; cannot express the drive's native 255 sectors per track (CL carries only six
; sector bits), so the BIOS reports a translation whose capacity always covers
; the whole image: cylinders = ceil(sectors / (16 * 63)), clamped to 1..1023.
disk_translate:
    push    eax
    push    ebx
    push    edx
    mov     byte [V_LHEADS], 16
    mov     word [V_LSPT], 63
    mov     eax, [V_SECTORS]
    add     eax, 1007                   ; 16 * 63 - 1: rounds the division up
    xor     edx, edx
    mov     ebx, 1008
    div     ebx
    or      eax, eax
    jnz     .rounded
    mov     eax, 1
.rounded:
    cmp     eax, 1023
    jbe     .clamped
    mov     eax, 1023
.clamped:
    mov     [V_LCYL], ax
    pop     edx
    pop     ebx
    pop     eax
    ret

; CX = sector count, V_LBA = first sector, ES:DI = buffer.  CF=1 on error.
ata_read_sectors:
    push    ax
    push    cx
    push    dx
    push    si
    mov     si, cx
    mov     dx, 0x1F2
    mov     al, cl
    out     dx, al
    mov     ax, [V_LBA]
    mov     dx, 0x1F3
    out     dx, al
    mov     al, ah
    inc     dx
    out     dx, al
    mov     ax, [V_LBA+2]
    inc     dx
    out     dx, al
    mov     al, ah
    and     al, 0x0F
    or      al, 0xE0
    inc     dx
    out     dx, al
    mov     dx, 0x1F7
    mov     al, 0x20
    out     dx, al
.sector:
    call    ata_wait_drq
    jc      .error
    mov     cx, 256
    mov     dx, 0x1F0
.words:
    in      ax, dx
    stosw
    loop    .words
    dec     si
    jnz     .sector
    clc
    jmp     .done
.error:
    stc
.done:
    pop     si
    pop     dx
    pop     cx
    pop     ax
    ret

; CX = sector count, V_LBA = first sector, ES:DI = buffer.  CF=1 on error.
ata_write_sectors:
    push    ax
    push    cx
    push    dx
    push    si
    mov     si, cx
    mov     dx, 0x1F2
    mov     al, cl
    out     dx, al
    mov     ax, [V_LBA]
    mov     dx, 0x1F3
    out     dx, al
    mov     al, ah
    inc     dx
    out     dx, al
    mov     ax, [V_LBA+2]
    inc     dx
    out     dx, al
    mov     al, ah
    and     al, 0x0F
    or      al, 0xE0
    inc     dx
    out     dx, al
    mov     dx, 0x1F7
    mov     al, 0x30
    out     dx, al
.sector:
    call    ata_wait_drq
    jc      .error
    mov     cx, 256
    mov     dx, 0x1F0
.words:
    mov     ax, [es:di]
    add     di, 2
    out     dx, ax
    loop    .words
    dec     si
    jnz     .sector
    clc
    jmp     .done
.error:
    stc
.done:
    pop     si
    pop     dx
    pop     cx
    pop     ax
    ret

; CH = cylinder low, CL = sector (+ cylinder high 2 bits), DH = head.
; Writes the linear block address to V_LBA; CF=1 for an impossible geometry.
chs_to_lba:
    push    ax
    push    bx
    push    cx
    push    dx
    push    si
    mov     bl, cl
    mov     ah, cl
    and     ah, 0xC0
    mov     cl, 6
    shr     ah, cl                      ; AH = cylinder bits 8-9
    mov     al, ch                      ; AL = cylinder bits 0-7
    mov     si, dx
    and     si, 0xFF00
    shr     si, 6
    shr     si, 1
    shr     si, 1                       ; SI = head
    mov     cx, 0
    mov     cl, [V_LHEADS]
    or      cx, cx
    jz      .bad
    mul     cx                          ; DX:AX = cylinder * heads
    add     ax, si
    adc     dx, 0
    mov     cx, [V_LSPT]
    or      cx, cx
    jz      .bad
    mul     cx                          ; DX:AX = (cyl*heads + head) * spt
    and     bl, 0x3F
    jz      .bad
    dec     bl
    mov     bh, 0
    add     ax, bx
    adc     dx, 0
    mov     [V_LBA], ax
    mov     [V_LBA+2], dx
    clc
    jmp     .done
.bad:
    stc
.done:
    pop     si
    pop     dx
    pop     cx
    pop     bx
    pop     ax
    ret

; =============================================================================
; INT 08h - timer tick.  Bumps the BIOS tick counter, chains INT 1Ch and
; acknowledges the 8259A.
; =============================================================================
int08:
    push    ax
    push    ds
    xor     ax, ax
    mov     ds, ax
    sti
    inc     word [BDA_TICKS]
    jnz     .nohi
    inc     word [BDA_TICKS+2]
.nohi:
    cmp     word [BDA_TICKS+2], 0x0018
    jb      .chain
    ja      .rollover
    cmp     word [BDA_TICKS], 0x00B0
    jb      .chain
.rollover:
    mov     word [BDA_TICKS], 0
    mov     word [BDA_TICKS+2], 0
    mov     byte [BDA_TROLL], 1
.chain:
    int     0x1C
    mov     al, 0x20
    out     0x20, al
    pop     ds
    pop     ax
    iret

; =============================================================================
; INT 09h - keyboard.  Reads the scancode, tracks the shift state, translates
; it to ASCII and appends scancode:ascii to the 16-entry BIOS ring buffer.
; =============================================================================
int09:
    push    ax
    push    bx
    push    ds
    xor     ax, ax
    mov     ds, ax
    in      al, 0x60
    mov     bl, al
    mov     al, 0x20
    out     0x20, al
    test    bl, 0x80
    jnz     .release
    cmp     bl, 0x2A
    je      .lshift_on
    cmp     bl, 0x36
    je      .rshift_on
    cmp     bl, 0x1D
    je      .ctrl_on
    cmp     bl, 0x38
    je      .alt_on
    cmp     bl, 0x3A
    je      .caps
    mov     al, bl
    call    translate
    or      al, al
    jz      .done
    call    keybuf_push
    jmp     .done
.release:
    and     bl, 0x7F
    cmp     bl, 0x2A
    je      .lshift_off
    cmp     bl, 0x36
    je      .rshift_off
    cmp     bl, 0x1D
    je      .ctrl_off
    cmp     bl, 0x38
    je      .alt_off
    jmp     .done
.lshift_on:
    or      byte [BDA_SHIFT], 0x02
    jmp     .done
.rshift_on:
    or      byte [BDA_SHIFT], 0x01
    jmp     .done
.ctrl_on:
    or      byte [BDA_SHIFT], 0x04
    jmp     .done
.alt_on:
    or      byte [BDA_SHIFT], 0x08
    jmp     .done
.caps:
    xor     byte [BDA_SHIFT], 0x40
    jmp     .done
.lshift_off:
    and     byte [BDA_SHIFT], 0xFD
    jmp     .done
.rshift_off:
    and     byte [BDA_SHIFT], 0xFE
    jmp     .done
.ctrl_off:
    and     byte [BDA_SHIFT], 0xFB
    jmp     .done
.alt_off:
    and     byte [BDA_SHIFT], 0xF7
.done:
    pop     ds
    pop     bx
    pop     ax
    iret

; AL = scancode, BL = scancode for the buffer.  Returns AL = ASCII or 0.
translate:
    push    bx
    push    si
    xor     bx, bx
    mov     bl, al
    cmp     bl, 0x7F
    ja      .none
    mov     si, scancode_ascii - ROMBASE
    test    byte [BDA_SHIFT], 0x03
    jz      .lookup
    mov     si, scancode_shift - ROMBASE
.lookup:
    add     si, bx
    mov     al, cs:[si]
    test    byte [BDA_SHIFT], 0x40
    jz      .done
    cmp     al, 'a'
    jb      .upper
    cmp     al, 'z'
    ja      .upper
    sub     al, 32
    jmp     .done
.upper:
    cmp     al, 'A'
    jb      .done
    cmp     al, 'Z'
    ja      .done
    add     al, 32
    jmp     .done
.none:
    xor     al, al
.done:
    pop     si
    pop     bx
    ret

; The head/tail cells keep the classic offsets inside segment 0x40 (0x1E-0x3E),
; so a guest that loads ES=0x40 sees the standard layout; here DS is 0 and the
; buffer address is the offset plus 0x400.
KB_OFF_START equ 0x001E
KB_OFF_END   equ 0x003E
KB_LIN_START equ 0x041E

; BL = scancode, AL = ASCII.  Appends AH:AL to the BIOS keyboard buffer.
keybuf_push:
    push    ax
    push    bx
    push    di
    mov     ah, bl
    mov     bx, [BDA_KTAIL]
    mov     di, bx
    add     di, 2
    cmp     di, KB_OFF_END
    jb      .nowrap
    mov     di, KB_OFF_START
.nowrap:
    cmp     di, [BDA_KHEAD]
    je      .full
    add     bx, 0x0400
    mov     [bx], ax
    mov     [BDA_KTAIL], di
.full:
    pop     di
    pop     bx
    pop     ax
    ret

int0a:
int0b:
int0e:
int1b:
    iret

int11:
    mov     ax, [BDA_EQUIP]
    iret

int12:
    mov     ax, [BDA_MEMKB]
    iret

int14:
int17:
    xor     ah, ah
    iret

; =============================================================================
; INT 10h - video BIOS.
; =============================================================================
int10:
    push    ds
    push    ax
    xor     ax, ax
    mov     ds, ax
    pop     ax
    mov     [V_FUNC], ah
    mov     [V_AL], al
    mov     al, ah
    xor     ah, ah
    cmp     al, 0x00
    je      int10_setmode
    cmp     al, 0x01
    je      int10_shape
    cmp     al, 0x02
    je      int10_setcur
    cmp     al, 0x03
    je      int10_getcur
    cmp     al, 0x05
    je      int10_ret
    cmp     al, 0x06
    je      int10_scroll_up
    cmp     al, 0x07
    je      int10_scroll_dn
    cmp     al, 0x08
    je      int10_readch
    cmp     al, 0x09
    je      int10_writech
    cmp     al, 0x0A
    je      int10_writech
    cmp     al, 0x0B
    je      int10_ret
    cmp     al, 0x0C
    je      int10_putpix
    cmp     al, 0x0D
    je      int10_getpix
    cmp     al, 0x0E
    je      int10_tty
    cmp     al, 0x0F
    je      int10_getmode
    cmp     al, 0x10
    je      int10_dac
    cmp     al, 0x12
    je      int10_altsel
    cmp     al, 0x13
    je      int10_wstr
int10_ret:
    pop     ds
    iret

int10_setmode:
    mov     al, [V_AL]
    cmp     al, 0x13
    je      .m13
    call    vga_mode3
    call    int10_keep
    jmp     int10_ret
.m13:
    call    vga_mode13
    call    int10_keep
    jmp     int10_ret

int10_shape:
    mov     [BDA_CSHAPE], cx
    push    ax
    push    dx
    mov     dx, 0x3D4
    mov     al, 0x0A
    out     dx, al
    inc     dx
    mov     al, ch
    out     dx, al
    dec     dx
    mov     al, 0x0B
    out     dx, al
    inc     dx
    mov     al, cl
    out     dx, al
    pop     dx
    pop     ax
    jmp     int10_ret

int10_setcur:
    push    ax
    push    bx
    mov     al, dh
    xor     ah, ah
    mov     bl, 80
    mul     bl
    mov     bl, dl
    xor     bh, bh
    add     ax, bx
    cmp     ax, 2000
    jb      .fits
    xor     ax, ax
.fits:
    mov     [BDA_CUR], ax
    call    sync_cursor
    pop     bx
    pop     ax
    jmp     int10_ret

int10_getcur:
    mov     ax, [BDA_CUR]
    mov     bx, 80
    xor     dx, dx
    div     bx
    mov     dh, al
    mov     cx, [BDA_CSHAPE]
    jmp     int10_ret

int10_readch:
    push    bx
    push    es
    mov     bx, 0xB800
    mov     es, bx
    mov     bx, [BDA_CUR]
    shl     bx, 1
    mov     al, [es:bx]
    mov     ah, [es:bx+1]
    pop     es
    pop     bx
    jmp     int10_ret

int10_writech:
    push    bx
    push    cx
    push    dx
    push    es
    mov     ah, bl
    cmp     byte [V_FUNC], 0x0A
    jne     .attr_ok
    push    bx
    mov     bx, 0xB800
    mov     es, bx
    mov     bx, [BDA_CUR]
    shl     bx, 1
    mov     ah, [es:bx+1]
    pop     bx
.attr_ok:
    mov     al, [V_AL]
    mov     bx, 0xB800
    mov     es, bx
    mov     bx, [BDA_CUR]
    shl     bx, 1
.repeat:
    jcxz    .done
    mov     [es:bx], al
    mov     [es:bx+1], ah
    add     bx, 2
    dec     cx
    jmp     .repeat
.done:
    pop     es
    pop     dx
    pop     cx
    pop     bx
    call    int10_keep
    jmp     int10_ret

int10_putpix:
    push    ax
    push    dx
    push    bx
    push    es
    mov     al, [V_AL]
    mov     di, ax
    mov     bx, 0xA000
    mov     es, bx
    mov     ax, dx
    mov     bx, 320
    mul     bx
    add     ax, cx
    mov     bx, ax
    mov     ax, di
    mov     [es:bx], al
    pop     es
    pop     bx
    pop     dx
    pop     ax
    call    int10_keep
    jmp     int10_ret

int10_getpix:
    push    bx
    push    dx
    push    es
    mov     ax, dx
    mov     bx, 320
    mul     bx
    add     ax, cx
    mov     bx, ax
    mov     ax, 0xA000
    mov     es, ax
    mov     al, [es:bx]
    xor     ah, ah
    pop     es
    pop     dx
    pop     bx
    jmp     int10_ret

; Rebuild AX from the function/parameter bytes saved at entry, so handlers
; that return nothing leave the caller's AX untouched (AH=0Eh teletype is
; routinely called in a loop with only AL reloaded).
int10_keep:
    mov     ah, [V_FUNC]
    mov     al, [V_AL]
    ret

int10_tty:
    mov     al, [V_AL]
    call    tt
    call    int10_keep
    jmp     int10_ret

int10_getmode:
    mov     al, [V_WMODE]
    mov     ah, 80
    xor     bh, bh
    jmp     int10_ret

int10_altsel:
    xor     bx, bx
    jmp     int10_ret

; AH=10h, AL=10h: set one DAC register.  BX = index, DH = red, CH = green
; and CL = blue (all 6-bit), programmed through ports 0x3C8/0x3C9.
int10_dac:
    cmp     byte [V_AL], 0x10
    jne     int10_ret
    push    ax
    push    dx
    mov     al, dh
    mov     [V_ARG], al
    mov     al, ch
    mov     [V_ARG+1], al
    mov     al, cl
    mov     [V_ARG+2], al
    mov     dx, 0x3C8
    mov     al, bl
    out     dx, al
    inc     dx
    mov     al, [V_ARG]
    and     al, 0x3F
    out     dx, al
    mov     al, [V_ARG+1]
    and     al, 0x3F
    out     dx, al
    mov     al, [V_ARG+2]
    and     al, 0x3F
    out     dx, al
    pop     dx
    pop     ax
    jmp     int10_ret

; ---- AH=06h / 07h: scroll a text window by moving rows in 0xB8000 ----------
int10_scroll_up:
    mov     byte [V_SDIR], 0
    jmp     int10_scroll

int10_scroll_dn:
    mov     byte [V_SDIR], 1

int10_scroll:
    push    ax
    push    bx
    push    cx
    push    dx
    push    si
    push    di
    push    es
    mov     al, [V_AL]
    mov     [V_SN], al
    mov     [V_SATTR], bh
    mov     [V_SY0], ch
    mov     [V_SX0], cl
    mov     [V_SY1], dh
    mov     [V_SX1], dl
    cmp     byte [V_SY1], 24
    jbe     .yok
    mov     byte [V_SY1], 24
.yok:
    cmp     byte [V_SX1], 79
    jbe     .xok
    mov     byte [V_SX1], 79
.xok:
    mov     al, [V_SY0]
    cmp     al, [V_SY1]
    ja      .fin
    mov     al, [V_SX0]
    cmp     al, [V_SX1]
    ja      .fin
    ; AL=0 means "blank the whole window"
    cmp     byte [V_SN], 0
    jne     .haven
    mov     al, [V_SY1]
    sub     al, [V_SY0]
    inc     al
    mov     [V_SN], al
.haven:
    mov     ax, 0xB800
    mov     es, ax
    mov     al, [V_SDIR]
    or      al, al
    jnz     .down
    mov     al, [V_SY0]
    mov     [V_SROW], al
.up_loop:
    mov     al, [V_SROW]
    cmp     al, [V_SY1]
    ja      .fin
    mov     bl, [V_SN]
    add     al, bl
    cmp     al, [V_SY1]
    ja      .up_blank
    mov     [V_SSRC], al
    call    row_copy
    jmp     .up_next
.up_blank:
    mov     al, [V_SROW]
    call    row_blank
.up_next:
    inc     byte [V_SROW]
    jmp     .up_loop
.down:
    mov     al, [V_SY1]
    mov     [V_SROW], al
.dn_loop:
    mov     al, [V_SROW]
    cmp     al, [V_SY0]
    jl      .fin
    mov     bl, [V_SN]
    mov     ah, al
    sub     ah, bl
    js      .dn_blank
    cmp     ah, [V_SY0]
    jl      .dn_blank
    mov     [V_SSRC], ah
    call    row_copy
    jmp     .dn_next
.dn_blank:
    mov     al, [V_SROW]
    call    row_blank
.dn_next:
    dec     byte [V_SROW]
    jmp     .dn_loop
.fin:
    pop     es
    pop     di
    pop     si
    pop     dx
    pop     cx
    pop     bx
    pop     ax
    jmp     int10_ret

; Copy window row V_SSRC to row V_SROW (ES = 0xB800).
row_copy:
    push    ax
    push    cx
    push    si
    push    di
    mov     al, [V_SSRC]
    xor     ah, ah
    mov     cx, 80
    mul     cx
    mov     cl, [V_SX0]
    xor     ch, ch
    add     ax, cx
    shl     ax, 1
    mov     si, ax
    mov     al, [V_SROW]
    xor     ah, ah
    mov     cx, 80
    mul     cx
    mov     cl, [V_SX0]
    xor     ch, ch
    add     ax, cx
    shl     ax, 1
    mov     di, ax
    mov     cl, [V_SX1]
    sub     cl, [V_SX0]
    inc     cl
    xor     ch, ch
.copy:
    mov     ax, [es:si]
    mov     [es:di], ax
    add     si, 2
    add     di, 2
    loop    .copy
    pop     di
    pop     si
    pop     cx
    pop     ax
    ret

; Blank window row AX (ES = 0xB800) with the attribute in V_SATTR.
row_blank:
    push    ax
    push    bx
    push    cx
    push    di
    mov     bx, 80
    mul     bx
    mov     cl, [V_SX0]
    xor     ch, ch
    add     ax, cx
    shl     ax, 1
    mov     di, ax
    mov     cl, [V_SX1]
    sub     cl, [V_SX0]
    inc     cl
    xor     ch, ch
    mov     ah, [V_SATTR]
    mov     al, ' '
.fill:
    mov     [es:di], ax
    add     di, 2
    loop    .fill
    pop     di
    pop     cx
    pop     bx
    pop     ax
    ret

; ---- AH=13h: write a string at row DH, column DL ---------------------------
; ES:BP = string, CX = length, AL = mode (bit0 move the cursor, bit1 pairs),
; BL = attribute for the character-only modes.
int10_wstr:
    push    ax
    push    bx
    push    cx
    push    dx
    push    si
    push    di
    push    es
    push    ds
    mov     si, es
    mov     al, [V_AL]
    xor     ah, ah
    mov     di, ax
    mov     ax, 0xB800
    mov     ds, ax
    mov     es, si
    mov     al, dh
    xor     ah, ah
    mov     si, 80
    push    dx
    mul     si
    mov     si, ax
    pop     dx
    mov     al, dl
    xor     ah, ah
    add     si, ax
    shl     si, 1
.wloop:
    jcxz    .wdone
    mov     al, [es:bp]
    inc     bp
    test    di, 2
    jnz     .pairs
    mov     ah, bl
    jmp     .store
.pairs:
    mov     ah, [es:bp]
    inc     bp
    dec     cx
.store:
    mov     [si], ax
    add     si, 2
    dec     cx
    jmp     .wloop
.wdone:
    pop     ds
    test    di, 1
    jz      .nocur
    mov     ax, si
    shr     ax, 1
    cmp     ax, 2000
    jb      .curfits
    xor     ax, ax
.curfits:
    mov     [BDA_CUR], ax
    call    sync_cursor
.nocur:
    pop     es
    pop     di
    pop     si
    pop     dx
    pop     cx
    pop     bx
    pop     ax
    jmp     int10_ret

; =============================================================================
; INT 13h - fixed disk services, straight onto the ATA PIO register set.
; Drive 80h is the ATA master; there is no floppy.
; =============================================================================
int13:
    push    ax
    push    bx
    push    cx
    push    dx
    push    si
    push    di
    push    ds
    push    es
    xor     ax, ax
    mov     ds, ax
    pop     ax                          ; caller's ES
    mov     [V_BUFSEG], ax
    pop     ax                          ; caller's DS
    mov     [V_DAPSEG], ax
    pop     di
    pop     si
    pop     dx
    pop     cx
    pop     bx
    pop     ax
    mov     [V_FUNC], ah
    mov     [V_REQCNT], al
    mov     [V_RBX], bx
    mov     [V_RCX], cx
    mov     [V_RDX], dx
    mov     [V_RSI], si
    mov     al, [V_FUNC]
    cmp     al, 0x00
    je      int13_reset
    cmp     al, 0x01
    je      int13_status
    cmp     al, 0x02
    je      int13_read_chs
    cmp     al, 0x03
    je      int13_write_chs
    cmp     al, 0x04
    je      int13_verify
    cmp     al, 0x08
    je      int13_params
    cmp     al, 0x15
    je      int13_type
    cmp     al, 0x41
    je      int13_ext
    cmp     al, 0x42
    je      int13_ext_read
    cmp     al, 0x43
    je      int13_ext_write
    jmp     int13_badfunc

int13_ret:
    push    ax
    mov     ax, [V_BUFSEG]
    mov     es, ax
    xor     ax, ax
    mov     ds, ax
    pop     ax
    call    set_return_flags
    iret

int13_ok:
    mov     byte [V_LASTERR], 0
    mov     byte [V_FLAGS], 0
    xor     ah, ah
    jmp     int13_ret

int13_badfunc:
    mov     ah, 0x01
    jmp     int13_error
int13_ioerr:
    mov     ah, 0x02
    jmp     int13_error
int13_badaddr:
    mov     ah, 0x04
    jmp     int13_error
int13_boundary:
    mov     ah, 0x09
    jmp     int13_error
int13_badparam:
    mov     ah, 0x01
    jmp     int13_error
int13_nodrive:
    mov     ah, 0xAA
int13_error:
    mov     [V_LASTERR], ah
    mov     byte [V_FLAGS], 1
    jmp     int13_ret

; AL = sector count (0 means 256); CF=1 when the transfer would cross the end
; of the caller's 64K buffer segment.
int13_chs_span:
    push    ax
    push    bx
    push    dx
    mov     al, [V_REQCNT]
    or      al, al
    jz      .too_big
    xor     ah, ah
    mov     bx, 512
    mul     bx
    or      dx, dx
    jnz     .too_big
    add     ax, [V_RBX]
    jc      .too_big
    pop     dx
    pop     bx
    pop     ax
    clc
    ret
.too_big:
    pop     dx
    pop     bx
    pop     ax
    stc
    ret

; Copy the caller's 16-byte disk address packet (DS:SI, DS taken from the
; interrupt prologue) into V_DAP.  Only the extended functions use it.
int13_load_dap:
    push    ax
    push    cx
    push    si
    push    di
    push    es
    mov     es, [V_DAPSEG]
    mov     si, [V_RSI]
    mov     di, V_DAP
    mov     cx, 8
.copy:
    mov     ax, [es:si]
    mov     [di], ax
    add     si, 2
    add     di, 2
    loop    .copy
    pop     es
    pop     di
    pop     si
    pop     cx
    pop     ax
    ret

; Validate the packet in V_DAP; CF=1 with AH set when it must be rejected.
int13_check_dap:
    cmp     byte [V_DAP], 0x10
    jb      .parameter
    mov     cx, [V_DAP+2]
    or      cx, cx
    jz      .parameter
    cmp     cx, 127
    ja      .boundary
    ; the transfer must stay inside one 64K segment
    mov     ax, cx
    mov     bx, 512
    mul     bx
    or      dx, dx
    jnz     .boundary
    add     ax, [V_DAP+4]
    jc      .boundary
    ; LBA + count must stay inside the disk
    mov     ax, [V_DAP+8]
    add     ax, cx
    mov     dx, [V_DAP+10]
    adc     dx, 0
    cmp     dx, [V_SECTORS+2]
    ja      .range
    jb      .ok
    cmp     ax, [V_SECTORS]
    ja      .range
.ok:
    clc
    ret
.parameter:
    mov     ah, 0x01
    stc
    ret
.boundary:
    mov     ah, 0x09
    stc
    ret
.range:
    mov     ah, 0x04
    stc
    ret

; DH = head, CL = sector, CH = cylinder low, DL = drive 80h.
int13_reset:
    mov     dx, 0x1F6
    mov     al, 0xA0
    out     dx, al
    mov     dx, 0x1F7
    mov     al, 0x10                    ; RECALIBRATE
    out     dx, al
    mov     dx, 0x1F7
    in      al, dx
    in      al, dx
    jmp     int13_ok

int13_status:
    mov     ah, [V_LASTERR]
    or      ah, ah
    jz      int13_ok
    mov     byte [V_FLAGS], 1
    jmp     int13_ret

int13_read_chs:
    call    disk_check
    jc      int13_nodrive
    call    int13_chs_span
    jc      int13_boundary
    mov     dx, [V_RDX]
    mov     cx, [V_RCX]
    call    chs_to_lba
    jc      int13_badaddr
    mov     cx, [V_REQCNT]
    xor     ch, ch
    mov     di, [V_RBX]
    mov     es, [V_BUFSEG]
    call    ata_read_sectors
    jc      int13_ioerr
    jmp     int13_ok

int13_write_chs:
    call    disk_check
    jc      int13_nodrive
    call    int13_chs_span
    jc      int13_boundary
    mov     dx, [V_RDX]
    mov     cx, [V_RCX]
    call    chs_to_lba
    jc      int13_badaddr
    mov     cx, [V_REQCNT]
    xor     ch, ch
    mov     di, [V_RBX]
    mov     es, [V_BUFSEG]
    call    ata_write_sectors
    jc      int13_ioerr
    jmp     int13_ok

int13_verify:
    call    disk_check
    jc      int13_nodrive
    call    int13_chs_span
    jc      int13_boundary
    mov     dx, [V_RDX]
    mov     cx, [V_RCX]
    call    chs_to_lba
    jc      int13_badaddr
    mov     dx, 0x1F6
    mov     al, 0xA0
    out     dx, al
    mov     dx, 0x1F2
    mov     al, [V_REQCNT]
    out     dx, al
    mov     ax, [V_LBA]
    mov     dx, 0x1F3
    out     dx, al
    mov     al, ah
    inc     dx
    out     dx, al
    mov     ax, [V_LBA+2]
    inc     dx
    out     dx, al
    mov     al, ah
    and     al, 0x0F
    or      al, 0xE0
    inc     dx
    out     dx, al
    mov     dx, 0x1F7
    mov     al, 0x40
    out     dx, al
    mov     dx, 0x1F7
    in      al, dx
    in      al, dx
    test    al, 0x01
    jnz     int13_ioerr
    jmp     int13_ok

; AH=08h: DH = heads-1, CL = sectors per track (+ cylinder bits 8-9),
; CH = cylinder low, DL = number of drives, BL = 3 for a fixed disk.
int13_params:
    call    disk_check
    jc      int13_nodrive
    mov     bx, [V_LSPT]
    mov     cl, bl
    mov     al, [V_LCYL+1]
    and     al, 0x03
    shl     al, 1
    shl     al, 1
    shl     al, 1
    shl     al, 1
    shl     al, 1
    shl     al, 1
    or      cl, al
    mov     ch, [V_LCYL]
    mov     dl, 1
    mov     bl, 3
    mov     dh, [V_LHEADS]
    dec     dh
    mov     byte [V_LASTERR], 0
    mov     byte [V_FLAGS], 0
    xor     ah, ah
    jmp     int13_ret

int13_type:
    call    disk_check
    jc      int13_nodrive
    mov     ah, 3
    mov     cx, [V_SECTORS+2]
    mov     dx, [V_SECTORS]
    mov     byte [V_FLAGS], 0
    jmp     int13_ret

int13_ext:
    cmp     bx, 0x55AA
    jne     int13_badfunc
    cmp     dl, 0x80
    jne     int13_badfunc
    mov     bx, 0xAA55
    mov     ah, 0x30
    mov     cx, 0x0001
    mov     byte [V_FLAGS], 0
    jmp     int13_ret

int13_ext_read:
    call    disk_check
    jc      int13_nodrive
    call    int13_load_dap
    call    int13_check_dap
    jc      int13_error
    mov     cx, [V_DAP+2]
    mov     ax, [V_DAP+8]
    mov     [V_LBA], ax
    mov     ax, [V_DAP+10]
    mov     [V_LBA+2], ax
    mov     ax, [V_DAP+6]
    mov     es, ax
    mov     di, [V_DAP+4]
    call    ata_read_sectors
    jc      int13_ioerr
    jmp     int13_ok

int13_ext_write:
    call    disk_check
    jc      int13_nodrive
    call    int13_load_dap
    call    int13_check_dap
    jc      int13_error
    mov     cx, [V_DAP+2]
    mov     ax, [V_DAP+8]
    mov     [V_LBA], ax
    mov     ax, [V_DAP+10]
    mov     [V_LBA+2], ax
    mov     ax, [V_DAP+6]
    mov     es, ax
    mov     di, [V_DAP+4]
    call    ata_write_sectors
    jc      int13_ioerr
    jmp     int13_ok

; CF=0 when DL addresses the ATA master and a disk is attached.
disk_check:
    cmp     dl, 0x80
    jne     .absent
    cmp     byte [V_DISKOK], 1
    je      .ready
    call    disk_identify               ; a drive may have appeared after POST
    cmp     byte [V_DISKOK], 1
    jne     .absent
.ready:
    clc
    ret
.absent:
    stc
    ret

; =============================================================================
; INT 15h - system services: A20 gate, extended memory size, E820 map.
; =============================================================================
int15:
    push    ds
    push    ax
    xor     ax, ax
    mov     ds, ax
    pop     ax
    mov     [V_FUNC], ah
    mov     [V_AL], al
    mov     al, ah
    xor     ah, ah
    cmp     al, 0x24
    je      int15_a20
    cmp     al, 0x86
    je      int15_delay
    cmp     al, 0x88
    je      int15_extmem
    cmp     al, 0xE8
    je      int15_e8
    mov     ah, 0x86
    mov     byte [V_FLAGS], 1
    jmp     int15_ret

int15_ret:
    pop     ds
    call    set_return_flags
    iret

int15_delay:
    mov     byte [V_FLAGS], 0
    xor     ah, ah
    jmp     int15_ret

int15_extmem:
    call    cmos_above_kb
    mov     byte [V_FLAGS], 0
    jmp     int15_ret

int15_a20:
    mov     al, [V_AL]
    cmp     al, 0x00
    je      .disable
    cmp     al, 0x01
    je      .enable
    cmp     al, 0x02
    je      .query
    cmp     al, 0x03
    je      .query
    mov     ah, 0x86
    mov     byte [V_FLAGS], 1
    jmp     int15_ret
.disable:
    in      al, 0x92
    and     al, 0xFD
    out     0x92, al
    xor     ah, ah
    mov     byte [V_FLAGS], 0
    jmp     int15_ret
.enable:
    in      al, 0x92
    or      al, 0x02
    out     0x92, al
    xor     ah, ah
    mov     byte [V_FLAGS], 0
    jmp     int15_ret
.query:
    in      al, 0x92
    test    al, 0x02
    jz      .off
    xor     al, al
    jmp     .qdone
.off:
    mov     al, 1
.qdone:
    xor     ah, ah
    mov     byte [V_FLAGS], 0
    jmp     int15_ret

int15_e8:
    cmp     byte [V_AL], 0x01
    je      .count
    jmp     int15_e820
.count:
    mov     cx, [V_E820CNT]
    mov     bx, E820ENT
    xor     ah, ah
    mov     byte [V_FLAGS], 0
    jmp     int15_ret

; AX=E820: BX = continuation, ECX = buffer size, ES:DI = target entry.
int15_e820:
    cmp     bx, [V_E820CNT]
    jb      .have
    xor     ebx, ebx
    mov     byte [V_FLAGS], 1
    jmp     int15_ret
.have:
    mov     ax, bx
    mov     cx, E820ENT
    mul     cx
    add     ax, E820BUF
    mov     si, ax
    mov     cx, 10
.copy:
    mov     ax, [si]
    mov     [es:di], ax
    add     si, 2
    add     di, 2
    loop    .copy
    mov     ax, bx
    inc     ax
    cmp     ax, [V_E820CNT]
    jb      .more
    xor     ax, ax
.more:
    xor     ebx, ebx
    mov     bx, ax
    xor     ah, ah
    mov     byte [V_FLAGS], 0
    jmp     int15_ret

; =============================================================================
; INT 16h - keyboard services over the BIOS ring buffer.
; =============================================================================
int16:
    push    ds
    push    ax
    xor     ax, ax
    mov     ds, ax
    pop     ax
    mov     [V_FUNC], ah
    mov     al, ah
    xor     ah, ah
    cmp     al, 0x00
    je      int16_read
    cmp     al, 0x01
    je      int16_peek
    cmp     al, 0x02
    je      int16_shift
    cmp     al, 0x10
    je      int16_read
    cmp     al, 0x11
    je      int16_peek
    cmp     al, 0x12
    je      int16_shift
    xor     ax, ax
    jmp     int16_ret

int16_ret:
    pop     ds
    call    set_return_flags
    iret

int16_read:
    push    bx
    push    di
.wait:
    mov     bx, [BDA_KHEAD]
    cmp     bx, [BDA_KTAIL]
    jne     .have
    sti
    hlt
    jmp     .wait
.have:
    mov     di, bx
    add     di, 0x0400
    mov     ax, [di]
    add     bx, 2
    cmp     bx, KB_OFF_END
    jb      .wrap
    mov     bx, KB_OFF_START
.wrap:
    mov     [BDA_KHEAD], bx
    pop     di
    pop     bx
    mov     byte [V_FLAGS], 0
    jmp     int16_ret

int16_peek:
    push    bx
    push    di
    mov     bx, [BDA_KHEAD]
    cmp     bx, [BDA_KTAIL]
    jne     .data
    xor     ax, ax
    mov     byte [V_FLAGS], 0x40
    pop     di
    pop     bx
    jmp     int16_ret
.data:
    mov     di, bx
    add     di, 0x0400
    mov     ax, [di]
    mov     byte [V_FLAGS], 0
    pop     di
    pop     bx
    jmp     int16_ret

int16_shift:
    mov     al, [BDA_SHIFT]
    xor     ah, ah
    mov     byte [V_FLAGS], 0
    jmp     int16_ret

; =============================================================================
; INT 1Ah - tick counter and real time clock.
; =============================================================================
int1a:
    push    ds
    push    ax
    xor     ax, ax
    mov     ds, ax
    pop     ax
    mov     [V_FUNC], ah
    mov     al, ah
    xor     ah, ah
    cmp     al, 0x00
    je      int1a_get
    cmp     al, 0x01
    je      int1a_set
    cmp     al, 0x02
    je      int1a_time
    cmp     al, 0x04
    je      int1a_date
    jmp     int1a_out

int1a_get:
    mov     cx, [BDA_TICKS+2]
    mov     dx, [BDA_TICKS]
    mov     al, [BDA_TROLL]
    mov     byte [BDA_TROLL], 0
    jmp     int1a_out

int1a_set:
    mov     [BDA_TICKS+2], cx
    mov     [BDA_TICKS], dx
    mov     byte [BDA_TROLL], 0
    jmp     int1a_out

; CH = hour, CL = minute, DH = second, all BCD from CMOS.
int1a_time:
    mov     al, 0x04
    out     0x70, al
    in      al, 0x71
    mov     ch, al
    mov     al, 0x02
    out     0x70, al
    in      al, 0x71
    mov     cl, al
    mov     al, 0x00
    out     0x70, al
    in      al, 0x71
    mov     dh, al
    xor     dl, dl
    jmp     int1a_out

; CH = century, CL = year, DH = month, DL = day, all BCD from CMOS.
int1a_date:
    mov     al, 0x32
    out     0x70, al
    in      al, 0x71
    mov     ch, al
    mov     al, 0x09
    out     0x70, al
    in      al, 0x71
    mov     cl, al
    mov     al, 0x08
    out     0x70, al
    in      al, 0x71
    mov     dh, al
    mov     al, 0x07
    out     0x70, al
    in      al, 0x71
    mov     dl, al

int1a_out:
    pop     ds
    iret

; =============================================================================
; INT 19h - bootstrap: load sector 0 of drive 80h to 0000:7C00 and jump to it.
; =============================================================================
int19:
    push    ax
    push    bx
    push    cx
    push    dx
    push    ds
    push    es
    xor     ax, ax
    mov     ds, ax
    mov     es, ax
    mov     ss, ax
    mov     sp, 0x7C00
    mov     ah, 0x00
    mov     dl, [V_BOOTDRV]
    int     0x13
    mov     ah, 0x02
    mov     al, 1
    xor     ch, ch
    mov     cl, 1
    xor     dh, dh
    mov     dl, [V_BOOTDRV]
    mov     bx, 0x7C00
    int     0x13
    jc      .failed
    cmp     word [0x7DFE], 0xAA55
    jne     .failed
    call    vga_mode3                    ; clean screen for the boot sector
    mov     dl, [V_BOOTDRV]
    xor     ax, ax
    mov     ds, ax
    mov     es, ax
    mov     ss, ax
    mov     sp, 0x7C00
    sti
    jmp     0x0000:0x7C00
.failed:
    mov     si, msg_noboot - ROMBASE
    call    print_rom
    pop     es
    pop     ds
    pop     dx
    pop     cx
    pop     bx
    pop     ax
    jmp     int18

; =============================================================================
; INT 18h - ROM monitor.  Line editor through INT 16h, commands:
; help mem dump boot reboot ticks.
; =============================================================================
int18:
    push    ax
    push    bx
    push    cx
    push    dx
    push    si
    push    di
    push    ds
    push    es
    xor     ax, ax
    mov     ds, ax
    mov     es, ax
    mov     ss, ax
    mov     sp, 0x7C00
    sti
    mov     si, msg_monitor - ROMBASE
    call    print_rom
.loop:
    mov     si, msg_prompt - ROMBASE
    call    print_rom
    call    mon_readline
    call    mon_exec
    jmp     .loop

; Read one edited line into V_LINEBUF; V_LINELEN gets the length.
mon_readline:
    push    ax
    push    cx
    push    di
    mov     byte [V_LINELEN], 0
    mov     di, V_LINEBUF
    mov     byte [di], 0
.next:
    mov     ah, 0x00
    int     0x16
    cmp     al, 0x0D
    je      .enter
    cmp     al, 0x08
    je      .back
    cmp     al, 0x20
    jb      .next
    mov     cl, [V_LINELEN]
    cmp     cl, 60
    jae     .next
    mov     [di], al
    inc     di
    inc     byte [V_LINELEN]
    call    tt
    jmp     .next
.enter:
    mov     byte [di], 0
    mov     al, 0x0D
    call    tt
    mov     al, 0x0A
    call    tt
    jmp     .done
.back:
    mov     cl, [V_LINELEN]
    or      cl, cl
    jz      .next
    dec     di
    dec     byte [V_LINELEN]
    mov     al, 0x08
    call    tt
    mov     al, ' '
    call    tt
    mov     al, 0x08
    call    tt
    jmp     .next
.done:
    pop     di
    pop     cx
    pop     ax
    ret

; SI = upper-case command name in the ROM.  CF=1 when the line buffer starts
; with that word (case-insensitive, terminated by space or NUL).
cmd_is:
    push    ax
    push    bx
    push    si
    push    di
    mov     di, V_LINEBUF
.compare:
    mov     al, cs:[si]
    or      al, al
    jz      .pattern_end
    mov     bl, [di]
    or      bl, bl
    jz      .mismatch
    cmp     bl, ' '
    je      .mismatch
    cmp     bl, 'a'
    jb      .folded
    cmp     bl, 'z'
    ja      .folded
    sub     bl, 32
.folded:
    cmp     al, bl
    jne     .mismatch
    inc     si
    inc     di
    jmp     .compare
.pattern_end:
    mov     bl, [di]
    or      bl, bl
    jz      .match
    cmp     bl, ' '
    je      .match
.mismatch:
    clc
    jmp     .out
.match:
    stc
.out:
    pop     di
    pop     si
    pop     bx
    pop     ax
    ret

mon_exec:
    push    ax
    push    si
    mov     al, [V_LINEBUF]
    or      al, al
    jz      .done
    mov     si, cmd_help - ROMBASE
    call    cmd_is
    jc      .help
    mov     si, cmd_mem - ROMBASE
    call    cmd_is
    jc      .mem
    mov     si, cmd_dump - ROMBASE
    call    cmd_is
    jc      .dump
    mov     si, cmd_boot - ROMBASE
    call    cmd_is
    jc      .boot
    mov     si, cmd_reboot - ROMBASE
    call    cmd_is
    jc      .reboot
    mov     si, cmd_ticks - ROMBASE
    call    cmd_is
    jc      .ticks
    mov     si, msg_unknown - ROMBASE
    call    print_rom
    jmp     .done
.help:
    mov     si, msg_help - ROMBASE
    call    print_rom
    jmp     .done
.mem:
    mov     si, msg_mem - ROMBASE
    call    print_rom
    call    cmos_above_kb
    call    put_dec_word
    mov     si, msg_kb - ROMBASE
    call    print_rom
    jmp     .done
.ticks:
    mov     si, msg_ticks - ROMBASE
    call    print_rom
    mov     ax, [BDA_TICKS]
    call    put_hex_word
    mov     si, msg_crlf - ROMBASE
    call    print_rom
    jmp     .done
.dump:
    call    mon_dump
    jmp     .done
.boot:
    pop     si
    pop     ax
    jmp     int19
.reboot:
    pop     si
    pop     ax
    jmp     0xF000:(post - ROMBASE)
.done:
    pop     si
    pop     ax
    ret

; Dump four 16-byte rows from V_DUMPADR (optionally set by an argument).
mon_dump:
    push    ax
    push    bx
    push    cx
    push    di
    push    es
    xor     ax, ax
    mov     es, ax
    call    parse_arg
    or      ax, ax
    jz      .usevar
    mov     [V_DUMPADR], ax
.usevar:
    mov     cx, 4
.row:
    mov     ax, [V_DUMPADR]
    call    put_hex_word
    mov     al, ':'
    call    tt
    mov     al, ' '
    call    tt
    mov     di, [V_DUMPADR]
    mov     bx, 16
.byte:
    mov     al, [di]
    inc     di
    call    put_hex_byte
    mov     al, ' '
    call    tt
    dec     bx
    jnz     .byte
    mov     ax, di
    mov     [V_DUMPADR], ax
    mov     si, msg_crlf - ROMBASE
    call    print_rom
    loop    .row
    pop     es
    pop     di
    pop     cx
    pop     bx
    pop     ax
    ret

; AX = hex number following the first space in the line buffer (0 if none).
parse_arg:
    push    bx
    push    di
    xor     ax, ax
    mov     di, V_LINEBUF
.skip:
    mov     bl, [di]
    or      bl, bl
    jz      .out
    cmp     bl, ' '
    je      .start
    inc     di
    jmp     .skip
.start:
    inc     di
.digits:
    mov     bl, [di]
    cmp     bl, '0'
    jb      .out
    cmp     bl, '9'
    jbe     .decimal
    cmp     bl, 'a'
    jb      .folded
    cmp     bl, 'z'
    ja      .folded
    sub     bl, 32
.folded:
    cmp     bl, 'A'
    jb      .out
    cmp     bl, 'F'
    ja      .out
    sub     bl, 55
    jmp     .accumulate
.decimal:
    sub     bl, '0'
.accumulate:
    shl     ax, 4
    xor     bh, bh
    or      ax, bx
    inc     di
    jmp     .digits
.out:
    pop     di
    pop     bx
    ret

; =============================================================================
; INT 21h - the DOS services the guest shell needs.
; =============================================================================
int21:
    push    ds
    push    es
    push    ax
    xor     ax, ax
    mov     es, ax
    mov     ax, ds
    mov     [es:V_STRSEG], ax
    mov     [es:V_STROFF], dx
    mov     ax, es
    mov     ds, ax
    pop     ax
    mov     [V_FUNC], ah
    mov     [V_AL], al
    mov     al, ah
    xor     ah, ah
    cmp     al, 0x01
    je      int21_read
    cmp     al, 0x02
    je      int21_write
    cmp     al, 0x09
    je      int21_puts
    cmp     al, 0x0A
    je      int21_gets
    cmp     al, 0x30
    je      int21_version
    cmp     al, 0x40
    je      int21_writebuf
    cmp     al, 0x4C
    je      int21_exit
int21_ret:
    pop     es
    pop     ds
    iret

; AH=01: read a key with echo.
int21_read:
    mov     ah, 0x00
    int     0x16
    push    ax
    call    tt
    pop     ax
    jmp     int21_ret

; AH=02: write DL to the console.
int21_write:
    mov     al, dl
    call    tt
    mov     dl, al
    jmp     int21_ret

; AH=09: write the $-terminated string at DS:DX.
int21_puts:
    push    es
    mov     es, [V_STRSEG]
    mov     si, [V_STROFF]
.next:
    mov     al, [es:si]
    cmp     al, '$'
    je      .done
    inc     si
    or      al, al
    jz      .done
    call    tt
    jmp     .next
.done:
    pop     es
    jmp     int21_ret

; AH=0A: buffered line input into DS:DX.
int21_gets:
    push    es
    push    bp
    mov     es, [V_STRSEG]
    mov     bp, [V_STROFF]
    mov     cl, [es:bp]
    xor     ch, ch
    mov     di, bp
    inc     di
    mov     byte [es:di], 0
    xor     bx, bx
    dec     cx
    cmp     cx, 0
    jge     .room
    xor     cx, cx
.room:
.next:
    mov     ah, 0x00
    int     0x16
    cmp     al, 0x0D
    je      .enter
    cmp     al, 0x08
    je      .back
    cmp     al, 0x20
    jb      .next
    cmp     bx, cx
    jae     .next
    inc     di
    mov     [es:di], al
    inc     bx
    call    tt
    jmp     .next
.back:
    or      bx, bx
    jz      .next
    dec     di
    dec     bx
    mov     al, 0x08
    call    tt
    mov     al, ' '
    call    tt
    mov     al, 0x08
    call    tt
    jmp     .next
.enter:
    mov     [es:bp+1], bl
    mov     al, 0x0D
    call    tt
    mov     al, 0x0A
    call    tt
    pop     bp
    pop     es
    jmp     int21_ret

; AH=30: report DOS 3.30.
int21_version:
    mov     ax, 0x1E03
    xor     bx, bx
    xor     cx, cx
    jmp     int21_ret

; AH=40: write CX bytes from DS:DX to handle 1 (stdout) or 2 (stderr).
int21_writebuf:
    push    es
    push    cx
    mov     es, [V_STRSEG]
    mov     si, [V_STROFF]
    cmp     bx, 1
    jbe     .go
    cmp     bx, 2
    ja      .skip
.go:
    mov     dx, cx
.loop:
    jcxz    .end
    mov     al, [es:si]
    inc     si
    call    tt
    dec     cx
    jmp     .loop
.end:
    mov     ax, dx
    pop     cx
    pop     es
    jmp     int21_ret
.skip:
    xor     ax, ax
    pop     cx
    pop     es
    jmp     int21_ret

; AH=4Ch: terminate the program and return control to the ROM monitor.
int21_exit:
    mov     si, msg_terminate - ROMBASE
    call    print_rom
    pop     es
    pop     ds
    jmp     int18

; @@SERVICES@@

; =============================================================================
; Data
; =============================================================================
msg_banner:  db "HY486 BIOS v1.00  i486DX PC", 13, 10, 0
msg_copy:    db "(C) 2026 HY486 project - self-written 64K ROM", 13, 10, 0
msg_cpu:     db "CPU: i486DX 32-bit, FPU present, A20 on", 13, 10, 0
msg_ram:     db "Memory: 640K base + ", 0
msg_ram2:    db "K above 1 MB", 13, 10, 0
msg_dev:     db "Devices: 8259A 8254 8042 CMOS VGA ATA-PIO 16550", 13, 10, 0
msg_disk:    db "Disk 80h: ", 0
msg_hddname: db "HYN486 HDD ", 0
msg_cyl:     db " cyl ", 0
msg_heads:   db " heads ", 0
msg_spt:     db " spt ", 0
msg_sect:    db " sectors", 13, 10, 0
msg_none:    db "no drive attached", 13, 10, 0
msg_e820:    db "E820 map: ", 0
msg_e820b:   db " entries at 0x9000, EBDA 0x9F00", 13, 10, 0
msg_boot:    db "Booting from drive 80h...", 13, 10, 0
msg_noboot:  db "No bootable disk in drive 80h", 13, 10, 0
msg_monitor: db 13, 10, "HY486 ROM monitor. Type 'help' for commands.", 13, 10, 0
msg_prompt:  db "romon> ", 0
msg_help:    db "commands: help mem dump boot reboot ticks", 13, 10, 0
msg_mem:     db "base 640K, extended ", 0
msg_kb:      db "K above 1 MB", 13, 10, 0
msg_dump:    db "dump: ", 0
msg_ticks:   db "timer ticks since boot: ", 0
msg_crlf:    db 13, 10, 0
msg_unknown: db "unknown command", 13, 10, 0
msg_terminate: db 13, 10, "Program terminated.", 13, 10, 0
cmd_help:    db "HELP", 0
cmd_mem:     db "MEM", 0
cmd_dump:    db "DUMP", 0
cmd_boot:    db "BOOT", 0
cmd_reboot:  db "REBOOT", 0
cmd_ticks:   db "TICKS", 0

vec_table:
    dw 0x0008, int08 - ROMBASE
    dw 0x0009, int09 - ROMBASE
    dw 0x000A, int0a - ROMBASE
    dw 0x000B, int0b - ROMBASE
    dw 0x000E, int0e - ROMBASE
    dw 0x0010, int10 - ROMBASE
    dw 0x0011, int11 - ROMBASE
    dw 0x0012, int12 - ROMBASE
    dw 0x0013, int13 - ROMBASE
    dw 0x0014, int14 - ROMBASE
    dw 0x0015, int15 - ROMBASE
    dw 0x0016, int16 - ROMBASE
    dw 0x0017, int17 - ROMBASE
    dw 0x0018, int18 - ROMBASE
    dw 0x0019, int19 - ROMBASE
    dw 0x001A, int1a - ROMBASE
    dw 0x001B, int1b - ROMBASE
    dw 0x001C, int1b - ROMBASE
    dw 0x0021, int21 - ROMBASE
    dw 0, 0

; ---- scancode set 1 -> ASCII, unshifted ------------------------------------
scancode_ascii:
    db 0x00, 0x1B, '1',  '2',  '3',  '4',  '5',  '6'
    db '7',  '8',  '9',  '0',  '-',  '=',  0x08, 0x09
    db 'q',  'w',  'e',  'r',  't',  'y',  'u',  'i'
    db 'o',  'p',  '[',  ']',  0x0D, 0x00, 'a',  's'
    db 'd',  'f',  'g',  'h',  'j',  'k',  'l',  ';'
    db 0x27, 0x60, 0x00, 0x5C, 'z',  'x',  'c',  'v'
    db 'b',  'n',  'm',  ',',  '.',  '/',  0x00, '*'
    db 0x00, ' ',  0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, '-',  0x00
    db 0x00, 0x00, 0x00, '+',  0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00

; ---- scancode set 1 -> ASCII, shifted --------------------------------------
scancode_shift:
    db 0x00, 0x1B, '!',  '@',  '#',  '$',  '%',  0x5E
    db 0x26, '*',  '(',  ')',  '_',  '+',  0x08, 0x09
    db 'Q',  'W',  'E',  'R',  'T',  'Y',  'U',  'I'
    db 'O',  'P',  '{',  '}',  0x0D, 0x00, 'A',  'S'
    db 'D',  'F',  'G',  'H',  'J',  'K',  'L',  ':'
    db 0x22, 0x7E, 0x00, 0x7C, 'Z',  'X',  'C',  'V'
    db 'B',  'N',  'M',  '<',  '>',  '?',  0x00, '*'
    db 0x00, ' ',  0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, '-',  0x00
    db 0x00, 0x00, 0x00, '+',  0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    db 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00

; =============================================================================
; Reset vector: the i486 starts at 0xFFFFFFF0, which the bus aliases to the
; last 16 bytes of this ROM.
; =============================================================================
    resb 0xFFF0 - ($ - $$)
reset_vector:
    jmp 0xF000:(post - ROMBASE)
    resb 0xFFFF - ($ - $$)
    db 0xFF
`;

  function build(assembler) {
    var asm = assembler || (typeof globalThis !== 'undefined' && globalThis.I486 && globalThis.I486.Assembler);
    if (!asm || typeof asm.assemble !== 'function') throw new Error('BIOS.build needs I486.Assembler');
    var r = asm.assemble(SOURCE, { bits: 16, origin: 0xF0000 });
    var out = {
      ok: r.ok === true,
      bytes: r.bytes,
      symbols: r.symbols,
      errors: r.errors,
      listing: r.listing,
      origin: r.origin
    };
    if (!out.ok && r.errors && r.errors.length) {
      out.message = r.errors.slice(0, 3).map(function (e) {
        return 'line ' + e.line + ': ' + e.message;
      }).join('; ');
    }
    return out;
  }

  return {
    BIOS: {
      source: SOURCE,
      entry: 'post',
      build: build
    }
  };
});
