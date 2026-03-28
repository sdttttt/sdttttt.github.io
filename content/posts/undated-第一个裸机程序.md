---
title: "第一个裸机程序"
date: 2025-04-20
author: sdttttt
draft: false
---

今天尝试写我的第一个裸机程序，虚拟机使用bochs，这个虚拟机配置很容易，也比较简单，非常新手。

```c
# bochs 配置文件

# 设置Bochs 在运行过程中能够使用的内存，32MB
megs: 32

# BIOS和显示BIOS
romimage: file=/home/admin123/Desktop/bochs/share/bochs/BIOS-bochs-latest
vgaromimage: file=/home/admin123/Desktop/bochs/share/bochs/VGABIOS-lgpl-latest

# 软盘，不用
# floppya: 1_44=a.img, status=inserted

# 使用硬盘
# boot: floppy
boot: disk

# 日志文件的输出。
log: bochs.out

# 关闭鼠标
mouse: enabled=0
keyboard_mapping: enabled=1,map=/home/admin123/Desktop/bochs/share/bochs/keymaps/x11-pc-us.map

# 硬盘设置
ata0-master: type=disk, path="hd60M.img", mode=flat, cylinders=121, heads=16, spt=63
ata0: enabled=1, ioaddr1=0x1f0, ioaddr2=0x3f0, irq=14

# gdb的支持，1234 端口调试
gdbstub: enabled=0, port=1234, text_base=0, data_base=0, bss_base=0

```

```c
[org 0x7c00]
[bits 16]
BOOT_MAIN_ADDR equ 0x500
readdiskmsg db "ReadDisk...", 0

global _start

_start:
    xor ax, ax
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov fs, ax
    mov sp, 0x7c00

    mov ax, 3
    int 0x10

    mov ecx, 2
    mov bl, 2

    mov dx, 0x1f2
    mov al, bl
    out dx, al

    inc dx
    mov al, cl
    out dx, al

    inc dx
    mov al, ch
    out dx, al

    inc dx
    shr ecx, 16
    mov al, cl
    out dx, al

    inc dx
    mov al, ch
    and al, 0b1110_1111
    out dx, al

    inc dx
    mov al, 0x20
    out dx, al

    mov si, readdiskmsg
    call print

.hd_ready_check:
    mov dx, 0x1f7
    in al, dx
    and al, 0b0000_1000
    cmp al, 0b0000_1000
    jnz .hd_ready_check

    mov dx, 0x1f0
    mov cx, 256
    mov edi, BOOT_MAIN_ADDR

.read_boot:
    in ax, dx
    mov [edi], ax
    add edi, 2
    loop .read_boot

    jmp BOOT_MAIN_ADDR

;; mov si, string
;; call print
print:
    mov ah, 0x0e
    mov bh, 0
    mov bl, 0x01
.print_loop:
    mov al, [si]
    cmp al, 0
    jz .print_done
    int 0x10

    inc si
    jmp .print_loop

.print_done:
    ret

times 510 - ($ - $$) db 0
db 0x55, 0xaa
```

汇编具体就不解释了，太累了。

我没有在这个代码里分段，因为分段之后编译出来的二进制会有内存对齐，导致最后大小不是512字节。

运行效果：

![image.png](image%202.png)
