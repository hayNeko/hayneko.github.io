(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) { if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k]; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * HY486 guest: the boot sector and the real-mode mini-kernel, assembled at build
   * time and laid out on an HYFS image.
   *
   *   0x7C00  boot sector, one 512-byte sector ending in 55 AA
   *   0x7E00  superblock staging area for the boot sector
   *   0x8000  HY486 kernel, read from the first data cluster
   *   0x7000  kernel stack top, grows down
   *   0xFFFE  .COM stack top while a program runs
   *
   * The kernel is entered as 0x0000:0x8000, so its image has to stay inside one
   * 64 KB segment: 0x8000 + 0x8000 is the ceiling. The build rejects anything past
   * that, which is why kernels are capped at 32 KB although the contract allows 48.
   */

  var KERNEL_NAME = 'HY486.SYS';
  var KERNEL_ORIGIN = 0x8000;
  var KERNEL_LIMIT = 0x10000 - KERNEL_ORIGIN;
  var BOOT_ORIGIN = 0x7C00;
  var DEFAULT_SECTORS = 16384;

  var FS_DIR_START = 2;
  var FS_DIR_SECTORS = 8;
  var FS_CLUSTER_SECTORS = 4;
  var FS_SUPER_SECTOR = 1;

  function i486() {
    return (typeof globalThis !== 'undefined' ? globalThis : {}).I486 || {};
  }

  function diskOf() {
    var api = i486();
    if (!api.Disk) throw new Error('I486.Guest.build needs I486.Disk loaded first');
    return api.Disk;
  }

  function assemblerOf(opts) {
    if (opts && opts.assembler && typeof opts.assembler.assemble === 'function') return opts.assembler;
    var api = i486();
    if (api.Assembler && typeof api.Assembler.assemble === 'function') return api.Assembler;
    throw new Error('I486.Guest.build needs the assembler: pass { assembler } or load I486.Assembler first');
  }

  function assembleChecked(asm, source, opts, what) {
    var r = asm.assemble(source, opts), lines = [], i;
    if (r.ok) return r;
    for (i = 0; i < r.errors.length && i < 12; i++) {
      lines.push('  ' + what + '.asm:' + r.errors[i].line + ': ' + r.errors[i].message);
    }
    if (r.errors.length > 12) lines.push('  ... ' + (r.errors.length - 12) + ' more errors');
    throw new Error(what + ' assembly failed\n' + lines.join('\n'));
  }

  var BOOT_SOURCE = String.raw`; HY486 boot sector: reads the superblock and the kernel with INT 13h AH=42h
; extended reads, then jumps to 0x0000:0x8000. Assembled for org 0x7C00, 512 bytes.
bits 16
org 0x7C00

SUPER_OFF       equ 0x7E00
KERNEL_OFF      equ 0x8000

boot_start:
    cli
    xor ax, ax
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov sp, 0x7C00
    mov [boot_drive], dl
    in al, 0x92
    or al, 0x02
    and al, 0xFE
    out 0x92, al
    sti
    mov ah, 0x00
    mov dl, [boot_drive]
    int 0x13
    jc boot_fatal
    mov word [boot_lba], BOOT_SUPER_SECTOR
    mov ax, SUPER_OFF
    call boot_read
    jc boot_fatal
    mov si, SUPER_OFF
    mov di, boot_magic
    mov cx, 4
    call boot_cmp
    jc boot_nofs
    mov word [boot_lba], KERNEL_LBA
    mov word [boot_dest], KERNEL_OFF
    mov word [boot_left], KERNEL_SECTORS
boot_loop:
    cmp word [boot_left], 0
    je boot_run
    mov ax, [boot_dest]
    call boot_read
    jc boot_fatal
    add word [boot_dest], 512
    add word [boot_lba], 1
    dec word [boot_left]
    jmp boot_loop
boot_run:
    mov dl, [boot_drive]
    jmp 0x0000:0x8000

; AX = destination offset in segment 0, LBA in [boot_lba]. CF set on error.
; Disk address packet: size, reserved, count(word), offset, segment, LBA dword.
boot_read:
    push ax
    push bx
    push dx
    push si
    mov bx, boot_dap
    mov word [bx+2], 1
    mov [bx+4], ax
    mov word [bx+6], 0
    mov ax, [boot_lba]
    mov [bx+8], ax
    mov si, bx
    mov ah, 0x42
    mov dl, [boot_drive]
    int 0x13
    pop si
    pop dx
    pop bx
    pop ax
    ret

; compare CX bytes at offsets SI and DI in segment 0, CF set when they differ
boot_cmp:
    push ax
    push si
    push di
    push cx
boot_cmp_loop:
    mov al, [si]
    cmp al, [di]
    jne boot_cmp_no
    inc si
    inc di
    dec cx
    jnz boot_cmp_loop
    clc
    jmp boot_cmp_out
boot_cmp_no:
    stc
boot_cmp_out:
    pop cx
    pop di
    pop si
    pop ax
    ret

boot_fatal:
    mov si, boot_msg_disk
    jmp boot_show
boot_nofs:
    mov si, boot_msg_fs
boot_show:
    mov dx, 0xB800
    mov es, dx
    xor di, di
boot_show_loop:
    mov al, [si]
    inc si
    test al, al
    jz boot_hang
    mov ah, 0x4F
    mov [es:di], ax
    add di, 2
    jmp boot_show_loop
boot_hang:
    cli
    hlt
    jmp boot_hang

boot_msg_disk:    db "HY486 boot: disk read error", 0
boot_msg_fs:      db "HY486 boot: no HYFS superblock", 0
boot_magic:       db "HYFS"
boot_drive:       db 0x80
boot_lba:         dw 0
boot_dest:        dw 0
boot_left:        dw 0
boot_dap:
    db 0x10, 0
    dw 1
    dw 0
    dw 0
    dd 0
    dd 0
`;

  var KERNEL_SOURCE = String.raw`; HY486 mini-kernel: banner, HYFS commands, shell, .COM runner.
; Entered as 0x0000:0x8000 with DS=ES=SS=0 and the boot drive in DL. Every routine
; keeps DS=0; console output switches ES to the text segment by itself.
bits 16
org 0x8000

KSTACK_TOP      equ 0x7000
VID_SEG         equ 0xB800
SB_FILE_COUNT   equ 0x0A

kernel_start:
    cli
    xor ax, ax
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov sp, KSTACK_TOP
    sti
    mov [boot_drive], dl
    call con_clear
    call print_banner
    call fs_init
    call install_vectors
    jmp shell_loop

; ---------------------------------------------------------------- console ----
; con_putc handles CR, LF and BS; every routine preserves the registers it does
; not explicitly return, so callers never have to save anything.

con_clear:
    push ax
    push cx
    push di
    push es
    mov ax, [video_seg]
    mov es, ax
    xor di, di
    mov cx, 2000
    mov ax, 0x0720
    cld
    rep stosw
    pop es
    pop di
    pop cx
    pop ax
    mov byte [cur_x], 0
    mov byte [cur_y], 0
    call con_cursor
    ret

con_pos:
    push ax
    push cx
    mov al, [cur_y]
    mov ah, 80
    mul ah
    mov cl, [cur_x]
    xor ch, ch
    add ax, cx
    shl ax, 1
    mov di, ax
    pop cx
    pop ax
    ret

con_cursor:
    push ax
    push bx
    push cx
    push dx
    push di
    call con_pos
    mov ax, di
    shr ax, 1
    mov bx, ax
    mov dx, 0x3D4
    mov al, 0x0F
    out dx, al
    mov dx, 0x3D5
    mov al, bl
    out dx, al
    mov dx, 0x3D4
    mov al, 0x0E
    out dx, al
    mov dx, 0x3D5
    mov ax, bx
    mov al, ah
    out dx, al
    pop di
    pop dx
    pop cx
    pop bx
    pop ax
    ret

con_putc:
    cmp al, 13
    je con_putc_cr
    cmp al, 10
    je con_putc_lf
    cmp al, 8
    je con_putc_bs
    push ax
    push bx
    push di
    push es
    mov bl, al
    call con_pos
    mov ax, [video_seg]
    mov es, ax
    mov al, bl
    mov ah, [cur_attr]
    mov [es:di], ax
    pop es
    pop di
    pop bx
    pop ax
    inc byte [cur_x]
    cmp byte [cur_x], 80
    jb con_cursor
    mov byte [cur_x], 0
    inc byte [cur_y]
    jmp con_putc_check
con_putc_cr:
    mov byte [cur_x], 0
    jmp con_cursor
con_putc_lf:
    inc byte [cur_y]
con_putc_check:
    cmp byte [cur_y], 25
    jb con_cursor
    call con_scroll
    jmp con_cursor
con_putc_bs:
    cmp byte [cur_x], 0
    je con_cursor
    dec byte [cur_x]
    jmp con_cursor

con_scroll:
    push ax
    push cx
    push si
    push di
    push ds
    push es
    mov ax, [video_seg]
    mov ds, ax
    mov es, ax
    cld
    mov si, 160
    xor di, di
    mov cx, 1920
    rep movsw
    mov di, 3840
    mov cx, 80
    mov ax, 0x0720
    rep stosw
    pop es
    pop ds
    pop di
    pop si
    pop cx
    pop ax
    dec byte [cur_y]
    ret

con_puts:
    push ax
    push si
con_puts_loop:
    mov al, [si]
    inc si
    test al, al
    jz con_puts_done
    call con_putc
    jmp con_puts_loop
con_puts_done:
    pop si
    pop ax
    ret

con_crlf:
    push ax
    mov al, 13
    call con_putc
    mov al, 10
    call con_putc
    pop ax
    ret

; Start a fresh line unless the cursor already sits at column 0, so kernel text never
; glues itself onto the tail of program output that ended without a newline.
con_line_start:
    cmp byte [cur_x], 0
    jne con_line_start_crlf
    ret
con_line_start_crlf:
    call con_crlf
    ret

con_nib:
    push ax
    and al, 0x0F
    cmp al, 10
    jb con_nib_digit
    add al, 7
con_nib_digit:
    add al, 0x30
    call con_putc
    pop ax
    ret

con_hex8:
    push ax
    push bx
    mov bl, al
    mov al, bl
    shr al, 4
    call con_nib
    mov al, bl
    call con_nib
    pop bx
    pop ax
    ret

con_hex16:
    push ax
    push bx
    mov bx, ax
    mov ax, bx
    shr ax, 12
    call con_nib
    mov ax, bx
    shr ax, 8
    call con_nib
    mov ax, bx
    shr ax, 4
    call con_nib
    mov ax, bx
    call con_nib
    pop bx
    pop ax
    ret

con_dec16:
    push ax
    push bx
    push cx
    push dx
    mov bx, 10
    xor cx, cx
con_dec16_digit:
    xor dx, dx
    div bx
    push dx
    inc cx
    test ax, ax
    jnz con_dec16_digit
con_dec16_out:
    pop ax
    add al, 0x30
    call con_putc
    loop con_dec16_out
    pop dx
    pop cx
    pop bx
    pop ax
    ret

con_bcd:
    push ax
    push bx
    mov bl, al
    mov al, bl
    shr al, 4
    add al, 0x30
    call con_putc
    mov al, bl
    and al, 0x0F
    add al, 0x30
    call con_putc
    pop bx
    pop ax
    ret

; ------------------------------------------------------------- filesystem ----

fs_init:
    push ax
    push bx
    push cx
    push si
    push di
    mov ah, 0x00
    mov dl, [boot_drive]
    int 0x13
    mov word [fs_lba], FS_SUPER_SECTOR
    mov ax, sb_buf
    call fs_read_sector
    jc fs_init_bad
    mov si, sb_buf
    mov di, sb_magic
    mov cx, 4
    call mem_cmp
    jc fs_init_bad
    clc
    jmp fs_init_out
fs_init_bad:
    mov si, msg_nofs
    call con_puts
    call con_crlf
    stc
fs_init_out:
    pop di
    pop si
    pop cx
    pop bx
    pop ax
    ret

; compare CX bytes at SI and DI in segment 0, CF set when they differ
mem_cmp:
    push ax
    push cx
    push si
    push di
mem_cmp_loop:
    mov al, [si]
    cmp al, [di]
    jne mem_cmp_no
    inc si
    inc di
    dec cx
    jnz mem_cmp_loop
    clc
    jmp mem_cmp_out
mem_cmp_no:
    stc
mem_cmp_out:
    pop di
    pop si
    pop cx
    pop ax
    ret

; AX = destination offset in segment 0, LBA in [fs_lba]. CF set on error.
fs_read_sector:
    push ax
    push bx
    push dx
    push si
    mov bx, dap
    mov word [bx+2], 1
    mov [bx+4], ax
    mov word [bx+6], 0
    mov ax, [fs_lba]
    mov [bx+8], ax
    mov si, bx
    mov ah, 0x42
    mov dl, [boot_drive]
    int 0x13
    pop si
    pop dx
    pop bx
    pop ax
    ret

; AX = source offset in segment 0, LBA in [fs_lba]. CF set on error.
fs_write_sector:
    push ax
    push bx
    push dx
    push si
    mov bx, dap
    mov word [bx+2], 1
    mov [bx+4], ax
    mov word [bx+6], 0
    mov ax, [fs_lba]
    mov [bx+8], ax
    mov si, bx
    mov ah, 0x43
    mov dl, [boot_drive]
    int 0x13
    pop si
    pop dx
    pop bx
    pop ax
    ret

; AX = destination offset, CX = sector count, [fs_lba] = first LBA. CF on error.
fs_read_chain:
    mov [chain_dest], ax
    mov [chain_count], cx
fs_read_chain_loop:
    mov ax, [chain_dest]
    call fs_read_sector
    jc fs_read_chain_fail
    add word [chain_dest], 512
    add word [fs_lba], 1
    dec word [chain_count]
    jnz fs_read_chain_loop
    clc
    ret
fs_read_chain_fail:
    stc
    ret

; AX = cluster, returns LBA in AX
cluster_lba:
    push bx
    push dx
    mov bx, FS_CLUSTER_SECTORS
    mul bx
    pop dx
    pop bx
    ret

; compare the 12-byte name at name_buf with the entry at DS:BX. CF set when equal.
fs_cmp_name:
    push ax
    push bx
    push cx
    push di
    mov di, name_buf
    mov cx, 12
fs_cmp_name_loop:
    mov al, [bx]
    cmp al, [di]
    jne fs_cmp_name_no
    inc bx
    inc di
    dec cx
    jnz fs_cmp_name_loop
    stc
    jmp fs_cmp_name_out
fs_cmp_name_no:
    clc
fs_cmp_name_out:
    pop di
    pop cx
    pop bx
    pop ax
    ret

; Looks the name in name_buf up in the directory. CF set when missing, otherwise
; entry_clus, entry_size, entry_attr, entry_ptr and entry_lba describe the entry.
fs_find:
    push ax
    push bx
    push cx
    mov word [fs_lba], FS_DIR_START
    mov byte [dir_sectors], FS_DIR_SECTORS
fs_find_sector:
    mov ax, dir_buf
    call fs_read_sector
    jc fs_find_missing
    mov bx, dir_buf
    mov cl, 16
fs_find_entry:
    cmp byte [bx], 0
    je fs_find_next
    call fs_cmp_name
    jc fs_find_found
fs_find_next:
    add bx, 32
    dec cl
    jnz fs_find_entry
    add word [fs_lba], 1
    dec byte [dir_sectors]
    jnz fs_find_sector
fs_find_missing:
    stc
    jmp fs_find_out
fs_find_found:
    mov ax, [bx+12]
    mov [entry_clus], ax
    mov ax, [bx+16]
    mov [entry_size], ax
    mov ax, [bx+18]
    mov [entry_size+2], ax
    mov al, [bx+20]
    mov [entry_attr], al
    mov [entry_ptr], bx
    mov ax, [fs_lba]
    mov [entry_lba], ax
    clc
fs_find_out:
    pop cx
    pop bx
    pop ax
    ret

; ------------------------------------------------------------- boot banner --

print_banner:
    mov si, msg_banner1
    call con_puts
    call con_crlf
    mov si, msg_banner2
    call con_puts
    call con_crlf
    mov si, msg_mem
    call con_puts
    mov ah, 0x88
    int 0x15
    jc print_banner_nomem
    call con_dec16
    jmp print_banner_memdone
print_banner_nomem:
    mov si, msg_unknown
    call con_puts
print_banner_memdone:
    mov si, msg_kb
    call con_puts
    call con_crlf
    mov si, msg_disk1
    call con_puts
    mov al, [boot_drive]
    call con_hex8
    mov si, msg_disk2
    call con_puts
    mov ah, 0x08
    mov dl, [boot_drive]
    int 0x13
    jc print_banner_geo_fail
    mov al, cl
    and al, 0xC0
    xor ah, ah
    shl ax, 1
    shl ax, 1
    mov bl, ch
    xor bh, bh
    or ax, bx
    inc ax
    call con_dec16
    mov si, msg_heads
    call con_puts
    mov al, dh
    xor ah, ah
    inc ax
    call con_dec16
    mov si, msg_secs
    call con_puts
    mov al, cl
    and al, 0x3F
    xor ah, ah
    call con_dec16
    jmp print_banner_tail
print_banner_geo_fail:
    mov si, msg_nogeo
    call con_puts
print_banner_tail:
    call con_crlf
    mov si, msg_hint
    call con_puts
    call con_crlf
    ret

; ---------------------------------------------------------------- vectors ---

install_vectors:
    push ax
    push bx
    mov bx, 0x0084
    mov ax, [bx]
    mov [orig21], ax
    mov ax, [bx+2]
    mov [orig21+2], ax
    mov word [bx], svc21
    mov word [bx+2], 0
    mov bx, 0x0080
    mov word [bx], svc20
    mov word [bx+2], 0
    mov bx, 0
    mov byte [bx], 0xCD
    mov byte [bx+1], 0x20
    pop bx
    pop ax
    ret

; --------------------------------------------------------------- services ---
; INT 21h stays DOS-like for the .COM runner: 00h/4Ch end the program, 02h and 09h
; print through the kernel console, 30h reports a version; everything else chains
; to the BIOS vector saved at install time.

svc21:
    cmp ah, 0x4C
    je com_exit
    cmp ah, 0x00
    je com_exit
    cmp ah, 0x09
    je svc21_print
    cmp ah, 0x02
    je svc21_putc
    cmp ah, 0x30
    je svc21_version
    jmp far [cs:orig21]
svc21_print:
    push ax
    push bx
    push si
    push es
    push ds
    mov ax, ds
    mov es, ax
    mov si, dx
    xor ax, ax
    mov ds, ax
svc21_print_loop:
    mov al, [es:si]
    inc si
    cmp al, 0x24
    je svc21_print_done
    test al, al
    jz svc21_print_done
    call con_putc
    jmp svc21_print_loop
svc21_print_done:
    pop ds
    pop es
    pop si
    pop bx
    pop ax
    iret
svc21_putc:
    push ax
    push dx
    push ds
    xor ax, ax
    mov ds, ax
    mov al, dl
    call con_putc
    pop ds
    pop dx
    pop ax
    iret
svc21_version:
    mov al, 3
    mov ah, 0x1E
    iret

svc20:
    jmp com_exit

; Leaves whatever the program was doing, discards its stack frame and re-enters
; the shell prompt. The kernel stack pointer is authoritative, so no IRET.
com_exit:
    cli
    xor ax, ax
    mov ss, ax
    mov sp, KSTACK_TOP
    mov ds, ax
    mov es, ax
    sti
    call con_line_start
    mov si, msg_done
    call con_puts
    call con_crlf
    jmp shell_loop

; ------------------------------------------------------------------ shell ---

shell_loop:
    mov si, msg_prompt
    call con_puts
    call read_line
    call exec_line
    jmp shell_loop

read_line:
    push ax
    push cx
    push di
    mov di, line_buf
    xor cx, cx
read_line_key:
    call get_key
    cmp al, 13
    je read_line_enter
    cmp al, 8
    je read_line_back
    cmp al, 0x20
    jb read_line_key
    cmp cx, 63
    jae read_line_key
    mov [di], al
    inc di
    inc cx
    call con_putc
    jmp read_line_key
read_line_back:
    test cx, cx
    jz read_line_key
    dec cx
    dec di
    mov al, 8
    call con_putc
    mov al, 0x20
    call con_putc
    mov al, 8
    call con_putc
    jmp read_line_key
read_line_enter:
    mov byte [di], 0
    call con_crlf
    pop di
    pop cx
    pop ax
    ret

get_key:
    mov ah, 0x00
    int 0x16
    ret

exec_line:
    push ax
    push cx
    push si
    push di
    mov si, line_buf
exec_line_skip:
    mov al, [si]
    cmp al, 0x20
    jne exec_line_first
    inc si
    jmp exec_line_skip
exec_line_first:
    test al, al
    jz exec_line_done
    mov di, cmd_buf
    xor cx, cx
exec_line_copy:
    mov al, [si]
    test al, al
    jz exec_line_word_end
    cmp al, 0x20
    je exec_line_word_end
    cmp cx, 15
    jae exec_line_skipchar
    cmp al, 0x61
    jb exec_line_store
    cmp al, 0x7A
    ja exec_line_store
    sub al, 0x20
exec_line_store:
    mov [di], al
    inc di
    inc cx
exec_line_skipchar:
    inc si
    jmp exec_line_copy
exec_line_word_end:
    mov byte [di], 0
exec_line_find_arg:
    mov al, [si]
    cmp al, 0x20
    jne exec_line_have_arg
    inc si
    jmp exec_line_find_arg
exec_line_have_arg:
    mov [arg_ptr], si
    call dispatch
exec_line_done:
    pop di
    pop si
    pop cx
    pop ax
    ret

; SI = candidate name, CF set when cmd_buf matches it
str_eq:
    push ax
    push si
    push di
    mov di, cmd_buf
str_eq_loop:
    mov al, [si]
    cmp al, [di]
    jne str_eq_no
    test al, al
    jz str_eq_yes
    inc si
    inc di
    jmp str_eq_loop
str_eq_yes:
    stc
    jmp str_eq_out
str_eq_no:
    clc
str_eq_out:
    pop di
    pop si
    pop ax
    ret

dispatch:
    mov si, cmd_help
    call str_eq
    jc do_help
    mov si, cmd_dir
    call str_eq
    jc do_dir
    mov si, cmd_type
    call str_eq
    jc do_type
    mov si, cmd_run
    call str_eq
    jc do_run
    mov si, cmd_del
    call str_eq
    jc do_del
    mov si, cmd_mem
    call str_eq
    jc do_mem
    mov si, cmd_ver
    call str_eq
    jc do_ver
    mov si, cmd_time
    call str_eq
    jc do_time
    mov si, cmd_date
    call str_eq
    jc do_date
    mov si, cmd_cls
    call str_eq
    jc do_cls
    mov si, cmd_reboot
    call str_eq
    jc do_reboot
    mov si, cmd_halt
    call str_eq
    jc do_halt
    mov si, cmd_boot
    call str_eq
    jc do_boot
    mov si, cmd_break
    call str_eq
    jc do_halt
    call con_line_start
    mov si, msg_badcmd
    call con_puts
    mov si, cmd_buf
    call con_puts
    call con_crlf
    ret

; Copies the argument at arg_ptr into name_buf as an upper-case, zero padded
; 12-byte name. CF set when the argument is missing or too long.
get_arg_name:
    push ax
    push cx
    push si
    push di
    mov si, [arg_ptr]
    cmp byte [si], 0
    je get_arg_name_fail
    mov di, name_buf
    xor cx, cx
get_arg_name_copy:
    mov al, [si]
    test al, al
    jz get_arg_name_pad
    cmp al, 0x20
    je get_arg_name_pad
    cmp cx, 12
    jae get_arg_name_fail
    cmp al, 0x61
    jb get_arg_name_store
    cmp al, 0x7A
    ja get_arg_name_store
    sub al, 0x20
get_arg_name_store:
    mov [di], al
    inc di
    inc cx
    inc si
    jmp get_arg_name_copy
get_arg_name_pad:
    mov byte [di], 0
    inc di
    inc cx
    cmp cx, 12
    jb get_arg_name_pad
    mov byte [di], 0
    clc
    jmp get_arg_name_out
get_arg_name_fail:
    stc
get_arg_name_out:
    pop di
    pop si
    pop cx
    pop ax
    ret

; --------------------------------------------------------------- commands ---

do_help:
    mov si, msg_help
    call con_puts
    ret

do_dir:
    push bx
    push si
    mov word [dir_files], 0
    mov si, msg_dirhdr
    call con_puts
    call con_crlf
    mov word [fs_lba], FS_DIR_START
    mov byte [dir_sectors], FS_DIR_SECTORS
do_dir_sector:
    mov ax, dir_buf
    call fs_read_sector
    jc do_dir_io
    mov word [dir_ptr], dir_buf
    mov byte [dir_left], 16
do_dir_entry:
    mov si, [dir_ptr]
    cmp byte [si], 0
    je do_dir_next
    mov byte [pad_col], 0
do_dir_name:
    mov al, [si]
    test al, al
    jz do_dir_pad
    call con_putc
    inc si
    inc byte [pad_col]
    jmp do_dir_name
do_dir_pad:
    cmp byte [pad_col], 13
    jae do_dir_size
    mov al, 0x20
    call con_putc
    inc byte [pad_col]
    jmp do_dir_pad
do_dir_size:
    mov si, [dir_ptr]
    mov ax, [si+16]
    call con_dec16
    call con_crlf
    inc word [dir_files]
do_dir_next:
    add word [dir_ptr], 32
    dec byte [dir_left]
    jnz do_dir_entry
    add word [fs_lba], 1
    dec byte [dir_sectors]
    jnz do_dir_sector
    call con_crlf
    mov ax, [dir_files]
    call con_dec16
    mov si, msg_files
    call con_puts
    call con_crlf
    pop si
    pop bx
    ret
do_dir_io:
    mov si, msg_ioerr
    call con_puts
    call con_crlf
    pop si
    pop bx
    ret

do_type:
    call get_arg_name
    jc do_type_usage
    call fs_find
    jc do_type_missing
    mov ax, [entry_size]
    mov [type_left], ax
    mov ax, [entry_clus]
    call cluster_lba
    mov [fs_lba], ax
do_type_sector:
    cmp word [type_left], 0
    je do_type_done
    mov ax, sec_buf
    call fs_read_sector
    jc do_type_io
    mov si, sec_buf
    mov cx, [type_left]
    cmp cx, 512
    jbe do_type_count
    mov cx, 512
do_type_count:
    sub [type_left], cx
do_type_char:
    mov al, [si]
    inc si
    call con_putc
    dec cx
    jnz do_type_char
    add word [fs_lba], 1
    jmp do_type_sector
do_type_done:
    call con_crlf
    ret
do_type_usage:
    mov si, msg_usage_type
    call con_puts
    call con_crlf
    ret
do_type_missing:
    mov si, msg_nofile
    call con_puts
    mov si, name_buf
    call con_puts
    call con_crlf
    ret
do_type_io:
    mov si, msg_ioerr
    call con_puts
    call con_crlf
    ret

do_del:
    call get_arg_name
    jc do_del_usage
    call fs_find
    jc do_del_missing
    mov si, [entry_ptr]
    mov cx, 32
do_del_clear:
    mov byte [si], 0
    inc si
    dec cx
    jnz do_del_clear
    mov ax, dir_buf
    mov bx, [entry_lba]
    mov [fs_lba], bx
    call fs_write_sector
    jc do_del_io
    mov ax, [sb_buf+SB_FILE_COUNT]
    test ax, ax
    jz do_del_report
    dec ax
    mov [sb_buf+SB_FILE_COUNT], ax
    mov word [fs_lba], FS_SUPER_SECTOR
    mov ax, sb_buf
    call fs_write_sector
    jc do_del_io
do_del_report:
    mov si, msg_deleted
    call con_puts
    mov si, name_buf
    call con_puts
    call con_crlf
    ret
do_del_usage:
    mov si, msg_usage_del
    call con_puts
    call con_crlf
    ret
do_del_missing:
    mov si, msg_nofile
    call con_puts
    mov si, name_buf
    call con_puts
    call con_crlf
    ret
do_del_io:
    mov si, msg_ioerr
    call con_puts
    call con_crlf
    ret

do_mem:
    mov si, msg_membase
    call con_puts
    call con_crlf
    mov si, msg_memext
    call con_puts
    mov ah, 0x88
    int 0x15
    jc do_mem_none
    call con_dec16
    jmp do_mem_kb
do_mem_none:
    mov si, msg_unknown
    call con_puts
do_mem_kb:
    mov si, msg_kb
    call con_puts
    call con_crlf
    ret

do_ver:
    mov si, msg_ver
    call con_puts
    call con_crlf
    ret

do_time:
    push ax
    push cx
    push dx
    mov ah, 0x02
    int 0x1A
    jc do_time_error
    mov al, ch
    call con_bcd
    mov al, 0x3A
    call con_putc
    mov al, cl
    call con_bcd
    mov al, 0x3A
    call con_putc
    mov al, dh
    call con_bcd
    call con_crlf
    jmp do_time_out
do_time_error:
    mov si, msg_rtcerr
    call con_puts
    call con_crlf
do_time_out:
    pop dx
    pop cx
    pop ax
    ret

do_date:
    push ax
    push cx
    push dx
    mov ah, 0x04
    int 0x1A
    jc do_date_error
    mov al, ch
    call con_bcd
    mov al, cl
    call con_bcd
    mov al, 0x2D
    call con_putc
    mov al, dh
    call con_bcd
    mov al, 0x2D
    call con_putc
    mov al, dl
    call con_bcd
    call con_crlf
    jmp do_date_out
do_date_error:
    mov si, msg_rtcerr
    call con_puts
    call con_crlf
do_date_out:
    pop dx
    pop cx
    pop ax
    ret

do_cls:
    call con_clear
    ret

do_reboot:
    jmp 0xFFFF:0x0000

do_halt:
    mov si, msg_halt
    call con_puts
    call con_crlf
    cli
do_halt_loop:
    hlt
    jmp do_halt_loop

do_boot:
    call get_arg_name
    jc do_boot_usage
    call fs_find
    jc do_boot_missing
    mov ax, [entry_clus]
    call cluster_lba
    mov [fs_lba], ax
    mov ax, 0x7C00
    call fs_read_sector
    jc do_boot_io
    mov dl, [boot_drive]
    xor ax, ax
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov sp, 0x7C00
    jmp 0x0000:0x7C00
do_boot_usage:
    mov si, msg_usage_boot
    call con_puts
    call con_crlf
    ret
do_boot_missing:
    mov si, msg_nofile
    call con_puts
    mov si, name_buf
    call con_puts
    call con_crlf
    ret
do_boot_io:
    mov si, msg_ioerr
    call con_puts
    call con_crlf
    ret

do_run:
    call get_arg_name
    jc do_run_usage
    call fs_find
    jc do_run_missing
    cmp word [entry_size+2], 0
    jne do_run_big
    cmp word [entry_size], 0
    je do_run_empty
    cmp word [entry_size], 0x7900
    ja do_run_big
    mov ax, [entry_clus]
    call cluster_lba
    mov [fs_lba], ax
    mov ax, [entry_size]
    add ax, 511
    shr ax, 9
    mov cx, ax
    mov ax, 0x0100
    call fs_read_chain
    jc do_run_io
    jmp com_start
do_run_usage:
    mov si, msg_usage_run
    call con_puts
    call con_crlf
    ret
do_run_missing:
    mov si, msg_nofile
    call con_puts
    mov si, name_buf
    call con_puts
    call con_crlf
    ret
do_run_big:
    mov si, msg_bigfile
    call con_puts
    mov si, name_buf
    call con_puts
    call con_crlf
    ret
do_run_empty:
    mov si, msg_emptyfile
    call con_puts
    mov si, name_buf
    call con_puts
    call con_crlf
    ret
do_run_io:
    mov si, msg_ioerr
    call con_puts
    call con_crlf
    ret

; Hands the flat image at 0x0100 to the program: CS=DS=ES=SS=0, SP=0xFFFE and a
; fake 0x0000 return address on the stack, so a bare RET reaches the int 20h stub
; that install_vectors leaves at 0:0.
com_start:
    cli
    xor ax, ax
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov sp, 0xFFFE
    push word 0x0000
    cld
    sti
    jmp 0x0000:0x0100

; ------------------------------------------------------------------ strings --

msg_banner1:     db "HY486 mini-kernel version 1.00", 0
msg_banner2:     db "16-bit real mode, HYFS filesystem", 0
msg_mem:         db "memory above 1MB: ", 0
msg_kb:          db " KB", 0
msg_unknown:     db "unknown", 0
msg_disk1:       db "disk ", 0
msg_disk2:       db "h geometry: C=", 0
msg_heads:       db " H=", 0
msg_secs:        db " S=", 0
msg_nogeo:       db " (no geometry reported)", 0
msg_hint:        db "type help for the command list", 0
msg_prompt:      db "hy486> ", 0
msg_help:        db "help dir type FILE run FILE del FILE mem ver time date", 13, 10
                db "cls reboot halt boot FILE break", 13, 10
                db "type prints a text file, run starts a .COM at 0100h,", 13, 10
                db "boot chain-loads a 512-byte sector, break and halt stop the CPU", 13, 10, 0
msg_dirhdr:      db "name         size", 13, 10, 0
msg_files:       db " file(s)", 0
msg_badcmd:      db "bad command: ", 0
msg_nofile:      db "file not found: ", 0
msg_bigfile:     db "file does not fit 0100h..7A00h: ", 0
msg_emptyfile:   db "file is empty: ", 0
msg_ioerr:       db "disk I/O error", 0
msg_deleted:     db "deleted ", 0
msg_nofs:        db "no HYFS superblock on the boot drive", 0
msg_done:        db "done", 0
msg_ver:         db "HY486 version 1.00, HYFS, 16-bit real mode", 0
msg_rtcerr:      db "rtc unavailable", 0
msg_halt:        db "halted", 0
msg_membase:     db "conventional memory: 640 KB", 0
msg_memext:      db "extended memory: ", 0
msg_usage_type:  db "usage: type FILE", 0
msg_usage_run:   db "usage: run FILE", 0
msg_usage_del:   db "usage: del FILE", 0
msg_usage_boot:  db "usage: boot FILE", 0
sb_magic:        db "HYFS"
cmd_help:        db "HELP", 0
cmd_dir:         db "DIR", 0
cmd_type:        db "TYPE", 0
cmd_run:         db "RUN", 0
cmd_del:         db "DEL", 0
cmd_mem:         db "MEM", 0
cmd_ver:         db "VER", 0
cmd_time:        db "TIME", 0
cmd_date:        db "DATE", 0
cmd_cls:         db "CLS", 0
cmd_reboot:      db "REBOOT", 0
cmd_halt:        db "HALT", 0
cmd_boot:        db "BOOT", 0
cmd_break:       db "BREAK", 0

; ------------------------------------------------------------------- state --

video_seg:         dw VID_SEG
cur_x:           db 0
cur_y:           db 0
cur_attr:        db 0x07
boot_drive:      db 0x80
pad_col:         db 0
dir_left:        db 0
dir_count:       db 0
dir_sectors:     db 0
dir_ptr:         dw 0
entry_lba:       dw 0
entry_ptr:       dw 0
entry_clus:      dw 0
entry_size:      dd 0
entry_attr:      db 0
fs_lba:          dw 0
chain_dest:      dw 0
chain_count:     dw 0
type_left:       dw 0
dir_files:       dw 0
arg_ptr:         dw 0
orig21:          dd 0
name_buf:        resb 13
line_buf:        resb 64
cmd_buf:         resb 16
dap:             db 0x10, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
sb_buf:          resb 512
dir_buf:         resb 512
sec_buf:         resb 512
`;

  /*
   * Assembles boot sector + kernel, lays them out on a fresh HYFS image and returns
   *   { image, bootSector, kernel, symbols, bootSymbols, sectors, files, kernelName }
   * bootSector and kernel are the emitted byte arrays; symbols is the kernel label
   * map. Extra files (opts.files = [{ name, data }]) land after the kernel.
   */
  function build(opts) {
    opts = opts || {};
    var asm = assemblerOf(opts);
    var Disk = diskOf();
    var sectors = opts.sectors === undefined || opts.sectors === null ? DEFAULT_SECTORS : (opts.sectors | 0);
    var extra = opts.files || [];
    var kernelR, bootR, kernel, boot, files, image, entry = null, i, name;

    kernelR = assembleChecked(asm, opts.kernelSource || KERNEL_SOURCE, {
      bits: 16,
      origin: KERNEL_ORIGIN,
      defines: {
        FS_DIR_START: FS_DIR_START,
        FS_DIR_SECTORS: FS_DIR_SECTORS,
        FS_CLUSTER_SECTORS: FS_CLUSTER_SECTORS,
        FS_SUPER_SECTOR: FS_SUPER_SECTOR
      }
    }, 'kernel');
    kernel = new Uint8Array(kernelR.bytes);
    if (!kernel.length) throw new Error('kernel assembled to zero bytes');
    if (kernel.length > KERNEL_LIMIT) {
      throw new Error('kernel is ' + kernel.length + ' bytes; at org 0x' + KERNEL_ORIGIN.toString(16) +
        ' it must stay within ' + KERNEL_LIMIT + ' bytes to fit inside segment 0');
    }

    files = [{ name: KERNEL_NAME, data: kernel, attr: 0 }];
    for (i = 0; i < extra.length; i++) {
      name = Disk.normalizeName(extra[i] && extra[i].name);
      if (!name) throw new Error('extra file ' + i + ' has no name');
      if (name === KERNEL_NAME) throw new Error(name + ' is reserved for the kernel');
      files.push({ name: name, data: extra[i].data, attr: extra[i].attr || 0 });
    }

    image = Disk.format({ sectors: sectors, files: files, bootKernel: KERNEL_NAME });

    for (i = 0; i < Disk.entries(image).length; i++) {
      if (Disk.entries(image)[i].name === KERNEL_NAME) entry = Disk.entries(image)[i];
    }
    if (!entry) throw new Error('kernel entry missing from the fresh image');

    bootR = assembleChecked(asm, opts.bootSource || BOOT_SOURCE, {
      bits: 16,
      origin: BOOT_ORIGIN,
      defines: {
        KERNEL_LBA: entry.firstCluster * FS_CLUSTER_SECTORS,
        KERNEL_SECTORS: Math.ceil(kernel.length / 512),
        BOOT_SUPER_SECTOR: FS_SUPER_SECTOR
      }
    }, 'boot');
    boot = new Uint8Array(bootR.bytes);
    if (boot.length > 510) {
      throw new Error('boot sector is ' + boot.length + ' bytes, 510 is the limit before 55 AA');
    }
    var bootSector = new Uint8Array(512);
    bootSector.set(boot, 0);
    bootSector[510] = 0x55;
    bootSector[511] = 0xAA;
    image.set(bootSector, 0);

    var listing = Disk.list(image);
    return {
      image: image,
      bootSector: bootSector,
      kernel: kernel,
      symbols: kernelR.symbols,
      bootSymbols: bootR.symbols,
      kernelSize: kernel.length,
      bootSize: 512,
      sectors: sectors,
      sectorSize: 512,
      kernelName: KERNEL_NAME,
      kernelLba: entry.firstCluster * FS_CLUSTER_SECTORS,
      kernelSectors: Math.ceil(kernel.length / 512),
      files: listing
    };
  }

  return {
    Guest: {
      build: build,
      KERNEL_NAME: KERNEL_NAME,
      KERNEL_ORIGIN: KERNEL_ORIGIN,
      KERNEL_LIMIT: KERNEL_LIMIT,
      BOOT_ORIGIN: BOOT_ORIGIN,
      kernelSource: KERNEL_SOURCE,
      bootSource: BOOT_SOURCE
    }
  };
});
