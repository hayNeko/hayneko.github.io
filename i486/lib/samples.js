/* i486/lib/samples.js — the demo programs behind the sample picker.
   Each entry is a complete, self-documenting source file in our NASM-style
   dialect. Bits/origin follow the mode, so the picker can drive the assembler
   without extra bookkeeping:
     com16  -> bits 16, org 0x100    (DOS style .COM, loaded and run at 0x100)
     boot16 -> bits 16, org 0x7C00   (a real 512-byte boot sector)
     flat32 -> bits 32, org 0x100000 (ring 0, flat segments)
   No sample may call a BIOS service the ROM does not implement: INT 10h
   00/02/0E/13, INT 13h, INT 16h, INT 1Ah and INT 21h 01/02/09/0A/30/4C/40. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) {
    if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var HELLO10 = [
    '; hello10 — the honest Hello World: INT 10h teletype, no DOS at all.',
    '; "Run .COM" loads these bytes at 0x100 with CS=DS=ES=SS=0 and jumps.',
    'bits 16',
    'org 0x100',
    '',
    'start:',
    '    mov ax, 0x0003        ; INT 10h AH=00: mode 03h, 80x25 text, clears screen',
    '    int 0x10',
    '    mov si, msg           ; DS:SI = first character of the string',
    '    mov ah, 0x0E          ; AH=0E teletype: AL goes to the cursor, then advance',
    '    mov bx, 0x0007        ; BH = page 0, BL = attribute (ignored by teletype)',
    '.next:',
    '    lodsb                 ; AL = [DS:SI], then SI = SI + 1',
    '    test al, al           ; a zero byte ends the string',
    '    jz short .done',
    '    int 0x10              ; print it; CR/LF/BEL and scroll at row 25 included',
    '    jmp short .next',
    '.done:',
    '    mov ax, 0x4C00        ; INT 21h AH=4C: terminate, AL = exit code 0',
    '    int 0x21',
    '',
    "msg: db 'Hello from a 486DX!', 13, 10, 0",
    ''
  ].join('\n');

  var HELLO21 = [
    '; hello21 — DOS style output: INT 21h AH=09h prints DS:DX up to the "$".',
    '; The trailing $ is what ends the string; there is no length argument.',
    'bits 16',
    'org 0x100',
    '',
    'start:',
    '    mov ah, 0x09          ; AH=09: write the $-terminated string at DS:DX',
    '    mov dx, msg',
    '    int 0x21',
    '    mov ah, 0x02          ; AH=02: write one character from DL',
    '    mov dl, 39            ; a closing quote',
    '    int 0x21',
    '    mov ah, 0x02',
    '    mov dl, 13            ; CR',
    '    int 0x21',
    '    mov ah, 0x02',
    '    mov dl, 10            ; LF',
    '    int 0x21',
    '    mov ax, 0x4C00        ; AH=4C: exit(0)',
    '    int 0x21',
    '',
    "msg: db 'INT 21h says: hello from the HY486 kernel', 0x24",
    ''
  ].join('\n');

  var FIB = [
    '; fib — 16 Fibonacci terms into memory, the low eight printed as hex.',
    '; Indexed stores, a call and INT 21h AH=02 character output.',
    'bits 16',
    'org 0x100',
    '',
    'start:',
    '    mov di, series        ; the store below addresses DS:DI',
    '    mov ax, 0             ; fib(0)',
    '    mov bx, 1             ; fib(1)',
    '    mov cx, 16            ; how many terms land in the table',
    '.fill:',
    '    mov [di], ax          ; keep the term',
    '    add di, 2',
    '    mov dx, ax',
    '    add dx, bx            ; dx = a + b',
    '    mov ax, bx            ; a = b',
    '    mov bx, dx            ; b = a + b',
    '    loop .fill',
    '',
    '    mov si, series        ; print the first eight terms',
    '    mov cx, 8',
    '.show:',
    '    mov ax, [si]',
    '    add si, 2',
    '    call printHex         ; four uppercase hex digits from AX',
    '    mov ah, 0x02',
    '    mov dl, 32            ; space between the numbers',
    '    int 0x21',
    '    loop .show',
    '    mov ax, 0x4C00',
    '    int 0x21',
    '',
    'printHex:                     ; AX -> four hex digits via INT 21h AH=02',
    '    push cx',
    '    mov cx, 4',
    '.digit:',
    '    rol ax, 4             ; bring the top nibble down to the low bits',
    '    push ax               ; INT 21h is free to clobber AX',
    '    and al, 0x0F',
    "    add al, '0'",
    "    cmp al, '9'",
    '    jbe short .emit',
    "    add al, 7             ; jump the gap between '9' and 'A'",
    '.emit:',
    '    mov dl, al',
    '    mov ah, 0x02',
    '    int 0x21',
    '    pop ax',
    '    loop .digit',
    '    pop cx',
    '    ret',
    '',
    'series: resb 32               ; 16 words of storage',
    ''
  ].join('\n');

  var STRINGS = [
    '; strings — rep movsb / rep stosb / repne scasb, the three workhorses.',
    '; DF=0 makes every string op walk forward; ES equals DS here, as a .COM wants.',
    'bits 16',
    'org 0x100',
    '',
    'start:',
    '    cld                   ; clear the direction flag: forward, always',
    '',
    '    ; 1) copy: DS:SI -> ES:DI, CX bytes, one instruction',
    '    mov si, src',
    '    mov di, dst',
    '    mov cx, src_end - src',
    '    rep movsb',
    '',
    '    ; 2) fill: ES:DI gets CX copies of AL',
    '    mov di, fill',
    "    mov al, '*'",
    '    mov cx, 8',
    '    rep stosb',
    '',
    '    ; 3) scan: stop when ES:DI holds AL (ZF=1); CX is the search budget',
    '    mov di, dst',
    "    mov al, '!'",
    '    mov cx, src_end - src',
    '    repne scasb',
    '',
    '    mov ah, 0x09          ; "rep movsb+stosb+scasb -> "',
    '    mov dx, banner',
    '    int 0x21',
    '    mov ah, 0x09          ; the eight stars written by rep stosb',
    '    mov dx, fill',
    '    int 0x21',
    '    mov ah, 0x09          ; " found: "',
    '    mov dx, tail',
    '    int 0x21',
    '    mov ah, 0x02          ; DI stopped one byte past the match',
    '    mov dl, byte [di-1]',
    '    int 0x21',
    '    mov ax, 0x4C00',
    '    int 0x21',
    '',
    "banner: db 'rep movsb+stosb+scasb -> ', 0x24",
    "tail:   db ' found: ', 0x24",
    "src:    db 'hello, scasb!', 0",
    'src_end:',
    "fill:   times 8 db '.'",
    '        db 0x24',
    'dst:    times 16 db 0',
    ''
  ].join('\n');

  var MODE13 = [
    '; mode13 — switch the VGA to 320x200x256 and paint 200 raster bands.',
    '; The frame buffer is linear at A000:0000, so ES:DI plus rep stosb is all.',
    'bits 16',
    'org 0x100',
    '',
    'start:',
    '    mov ax, 0x0013        ; INT 10h AH=00 AL=13h: 320x200, 256 colours',
    '    int 0x10',
    '    push 0xA000',
    '    pop es                ; ES = video segment',
    '    xor di, di            ; ES:DI = top-left pixel',
    '    mov dx, 200           ; one pass per scan line',
    '    xor bl, bl            ; colour of the current line',
    '.row:',
    '    mov al, bl',
    '    mov cx, 320           ; 320 pixels = 320 bytes in chain-4 mode',
    '    rep stosb',
    '    add bl, 7             ; walk the 6-bit palette for visible bands',
    '    and bl, 0x3F',
    '    dec dx',
    '    jnz short .row',
    '',
    '    mov cx, 0x0400        ; a short bounded hold; no blocking key read',
    '.hold:',
    '    loop .hold',
    '',
    '    mov ax, 0x0003        ; back to text mode 03h',
    '    int 0x10',
    '    mov ah, 0x09',
    '    mov dx, msg',
    '    int 0x21',
    '    mov ax, 0x4C00',
    '    int 0x21',
    '',
    "msg: db 'mode 13h: 200 raster bands drawn, text mode restored.', 13, 10, 0x24",
    ''
  ].join('\n');

  var FPU = [
    '; fpu — a 387 on the die: sqrt(a*a + b*b) with real FPU instructions.',
    '; The stack is st0..st7 and a trailing "p" means "and then pop".',
    'bits 16',
    'org 0x100',
    '',
    'start:',
    '    fninit                ; reset the FPU (the FN form needs no WAIT)',
    '    fild word [a]         ; st0 = 3',
    '    fild word [a]',
    '    fmulp                 ; st1 = st1 * st0, then pop: st0 = 9',
    '    fild word [b]         ; st0 = 4, st1 = 9',
    '    fild word [b]',
    '    fmulp                 ; st0 = 16, st1 = 9',
    '    faddp                 ; st0 = 25',
    '    fsqrt                 ; st0 = 5.0',
    '    fistp word [result]   ; round to an integer and pop',
    '',
    '    mov ax, [result]      ; 5, the hypotenuse of the 3-4-5 triangle',
    '    call printHex',
    '    mov ah, 0x09',
    '    mov dx, msg',
    '    int 0x21',
    '    mov ax, 0x4C00',
    '    int 0x21',
    '',
    'printHex:                     ; AX -> four hex digits via INT 21h AH=02',
    '    push cx',
    '    mov cx, 4',
    '.digit:',
    '    rol ax, 4',
    '    push ax',
    '    and al, 0x0F',
    "    add al, '0'",
    "    cmp al, '9'",
    '    jbe short .emit',
    '    add al, 7',
    '.emit:',
    '    mov dl, al',
    '    mov ah, 0x02',
    '    int 0x21',
    '    pop ax',
    '    loop .digit',
    '    pop cx',
    '    ret',
    '',
    'a:      dw 3                  ; the two legs',
    'b:      dw 4',
    'result: dw 0                  ; sqrt(25) lands here as 0x0005',
    "msg:    db ' = sqrt(3*3 + 4*4)', 13, 10, 0x24",
    ''
  ].join('\n');

  var PROT32 = [
    '; prot32 — "Run flat32" starts us in ring 0 with flat segments already on.',
    '; The first thing a real kernel does is load its own GDT and reload CS with',
    '; a far jump, so that every selector afterwards belongs to its own table.',
    'bits 32',
    'org 0x100000',
    '',
    'start:',
    '    cli',
    '    lgdt [gdtr]           ; GDTR = our descriptor table',
    '    jmp 0x08:.pm          ; far jump: reload CS from our code selector',
    '.pm:',
    '    mov ax, 0x10          ; our flat data selector',
    '    mov ds, ax',
    '    mov es, ax',
    '    mov fs, ax',
    '    mov gs, ax',
    '    mov ss, ax',
    '    mov esp, 0x0010FF00   ; a stack of our own, above the program',
    '',
    '    mov edi, 0x000B8000   ; text mode frame buffer, one word per cell',
    '    mov eax, 0x07200720   ; two spaces, grey on black',
    '    mov ecx, 1000         ; 2000 cells = 1000 dwords',
    '    rep stosd             ; wipe the screen',
    '',
    '    mov edi, 0x000B8000   ; row 0, column 0',
    '    mov esi, msg',
    '    mov ah, 0x0A          ; bright green on black',
    '.copy:',
    '    lodsb                 ; AL = [DS:ESI], then ESI = ESI + 1',
    '    test al, al',
    '    jz short .done',
    '    stosw                 ; AX goes to [ES:EDI], then EDI = EDI + 2',
    '    jmp short .copy',
    '.done:',
    '    hlt                   ; nothing left to do and interrupts are off',
    '',
    'gdt:',
    '    dd 0, 0               ; 0x00 the null descriptor, never selected',
    '    dd 0x0000FFFF, 0x00CF9A00  ; 0x08 ring 0 code, base 0, limit 4 GB, D=1',
    '    dd 0x0000FFFF, 0x00CF9200  ; 0x10 ring 0 data, base 0, limit 4 GB, D=1',
    'gdt_end:',
    '',
    'gdtr:',
    '    dw gdt_end - gdt - 1  ; limit: 24 - 1',
    '    dd gdt                ; linear address of the table',
    '',
    "msg: db 'ring 0, own GDT, flat 4 GB segments.', 0",
    ''
  ].join('\n');

  var TIMER = [
    '; timer — poll the BIOS clock and wait for one 18.2 Hz tick.',
    '; INT 08h bumps 0040:006C and then chains to INT 1Ch, the vector a program',
    '; hooks for a periodic callback; polling INT 1Ah AH=00 is the simple way.',
    'bits 16',
    'org 0x100',
    '',
    'start:',
    '    mov ah, 0x00          ; AH=00: read CX:DX = ticks since midnight',
    '    int 0x1A',
    '    mov si, dx            ; remember the low word of the start tick',
    '    mov bx, 0x0FFF        ; poll budget: give up instead of hanging',
    '.poll:',
    '    mov ah, 0x00',
    '    int 0x1A',
    '    cmp dx, si            ; has the BIOS clock moved?',
    '    jne short .ticked',
    '    dec bx',
    '    jnz short .poll',
    '    mov ah, 0x09',
    '    mov dx, nowait',
    '    int 0x21',
    '    jmp short .exit',
    '.ticked:',
    '    mov ah, 0x09',
    '    mov dx, ticked',
    '    int 0x21',
    '.exit:',
    '    mov ax, 0x4C00',
    '    int 0x21',
    '',
    "ticked: db 'timer: BIOS tick observed, INT 08h is alive.', 13, 10, 0x24",
    "nowait: db 'timer: no tick within the poll budget.', 13, 10, 0x24",
    ''
  ].join('\n');

  var BOOT16 = [
    '; bootsect — a real 512-byte boot sector: INT 19h loads sector 0 to 0x7C00',
    '; and jumps there. This one prints a line with INT 10h and then idles.',
    'bits 16',
    'org 0x7C00',
    '',
    'start:',
    '    cli',
    '    xor ax, ax            ; DS = ES = SS = 0: real-mode flat',
    '    mov ds, ax',
    '    mov es, ax',
    '    mov ss, ax',
    '    mov sp, 0x7C00        ; the stack grows down from here, clear of our code',
    '    sti',
    '    cld',
    '',
    '    mov ax, 0x0003        ; clear the screen, 80x25 text',
    '    int 0x10',
    '    mov si, msg',
    '    mov ah, 0x0E          ; teletype',
    '.next:',
    '    lodsb',
    '    test al, al',
    '    jz short .halt',
    '    int 0x10',
    '    jmp short .next',
    '.halt:',
    '    cli',
    '    hlt                   ; an idle boot sector sleeps until the next interrupt',
    '    jmp short .halt',
    '',
    "msg: db 'boot sector says hello', 13, 10, 'from 0x7C00!', 13, 10, 0",
    '',
    '    times 510 - ($ - $$) db 0   ; pad to 510 bytes ...',
    '    dw 0xAA55                   ; ... and place the signature the ROM wants',
    ''
  ].join('\n');

  var LIST = [
    {
      id: 'hello10',
      title: 'hello10 — INT 10h teletype',
      bits: 16,
      mode: 'com16',
      note: 'Hello World through BIOS INT 10h AH=0E: no DOS, no kernel, just the VGA.',
      source: HELLO10
    },
    {
      id: 'hello21',
      title: 'hello21 — INT 21h AH=09h',
      bits: 16,
      mode: 'com16',
      note: 'DOS style printing: DS:DX points at a $-terminated string.',
      source: HELLO21
    },
    {
      id: 'fib',
      title: 'fib — Fibonacci table',
      bits: 16,
      mode: 'com16',
      note: 'Sixteen terms stored to memory, the low eight printed as hex.',
      source: FIB
    },
    {
      id: 'strings',
      title: 'strings — rep movsb/stosb/scasb',
      bits: 16,
      mode: 'com16',
      note: 'Copy, fill and scan with the string instructions and DF=0.',
      source: STRINGS
    },
    {
      id: 'mode13',
      title: 'mode13 — 320x200 raster bands',
      bits: 16,
      mode: 'com16',
      note: 'Switches the VGA to mode 13h and paints 200 gradient scan lines.',
      source: MODE13
    },
    {
      id: 'fpu',
      title: 'fpu — 387 square root',
      bits: 16,
      mode: 'com16',
      note: 'FILD/FMULP/FADDP/FSQRT/FISTP: the 3-4-5 triangle comes back as 5.',
      source: FPU
    },
    {
      id: 'prot32',
      title: 'prot32 — own GDT, ring 0',
      bits: 32,
      mode: 'flat32',
      note: 'Loads its own GDT, reloads CS with a far jump, writes to the text buffer.',
      source: PROT32
    },
    {
      id: 'timer',
      title: 'timer — INT 1Ah tick poll',
      bits: 16,
      mode: 'com16',
      note: 'Waits for one BIOS clock tick instead of spinning forever.',
      source: TIMER
    },
    {
      id: 'bootsect',
      title: 'bootsect — 512-byte boot sector',
      bits: 16,
      mode: 'boot16',
      note: 'A real boot sector with the AA55 signature, loaded at 0x7C00.',
      source: BOOT16
    }
  ];

  function get(id) {
    var want = String(id === null || id === undefined ? '' : id).toLowerCase();
    for (var i = 0; i < LIST.length; i++) {
      if (LIST[i].id === want) return LIST[i];
    }
    return null;
  }

  function ids() {
    var out = [];
    for (var i = 0; i < LIST.length; i++) out.push(LIST[i].id);
    return out;
  }

  function options(sample) {
    if (sample && sample.mode === 'flat32') return { bits: 32, origin: 0x100000 };
    if (sample && sample.mode === 'boot16') return { bits: 16, origin: 0x7C00 };
    return { bits: 16, origin: 0x100 };
  }

  return {
    Samples: {
      list: LIST,
      get: get,
      ids: ids,
      options: options,
      defaultId: 'hello10'
    }
  };
});
