---
title: "DS and [address]"
date: 2020-04-06
description: "講解 8086 中 DS 段寄存器存放段地址以及通過 [偏移地址] 訪問內存單元的方式,並解釋為何不能直接給段寄存器賦值。"
tags: ["學習"]
draft: true
cover:
  image: "images/covers/20200406-DS-and-address-h97.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020040603epkj/"]
language: "zh-tw"
---

在8086PC 中要讀取`內存單元`時，必須先知道它的地址，地址由段地址和偏移地址構成。

8086PC中, `DS寄存器`專門用來存放段地址。

比如讀取1000H單元的內容：

```asm
mov bs, 1000H
mov ds, bs
mov [0], ax
```

逐行解析:

1000H 移動至BS寄存器.

BS寄存器數據送入DS寄存器.

AX從DS寄存器數據為段地址，讀取偏移為0的地址的內存單元.

---

為什麼不直接`mov ds, 1000H`吶？

> 因為`8086PC`就是這樣設計的，不允許數據直接送入段寄存器。

`[0]`是個啥玩意？

> 偏移地址, 段地址: 1000H, [0] = 1000H , [1] = 1001H

既然能有`mov 寄存器, 段寄存器`那麼肯定有`mov 段寄存器, 寄存器`嘍？

> Yes.

既然有`mov 寄存器, 內存單元`那麼肯定有`mov 內存單元, 寄存器`嘍？

> Yes.
