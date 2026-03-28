---
title: "尝试写一个strlen"
date: 2025-04-10
author: sdttttt
draft: false
---

```c
#include <stdio.h>

extern int strlen2(char *str);

int main() {
        char a[] = "hello,world";
        int len = strlen2(a);

        printf("%s len:%d  \n", a, len);

        return 0;
}
```

```nasm
SECTION .data

SECTION .text
	global strlen2

strlen2:
	mov rax, rdi
next:
	cmp byte [rax], 0
	je down
	inc rax
	jmp next
down:
	sub rax, rdi
	ret
```
