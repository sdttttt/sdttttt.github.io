---
title: "Redis Compile"
date: 2020-11-11
description: "2020年11月11日"
tags: ["日誌"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20201111-Redis-Compile-p7v.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020111104s57w/"]
language: "zh-tw"
---

也不知道我發了什麼瘋, 在windows上編譯了一遍redis. 事實上我找到的windows上最新的redis版本是3.

這個版本以及相當老了. 目前最新的redis是在6. 我不想功能相差過大,就重新在windows上編譯了一次.

中間搗鼓了很久. 由於redis是在unix環境上開發的, windows上編譯還是很麻煩. 首先試了`cygwin`這個unix模擬環境可惜編譯失敗了. 後面我下載了`msys2`這個unix的工具套件. 這次很順利. redis6的包我就放在[這裡](https://github.com/adminwbb/adminwbb.github.io/releases/download/1/redis6.7z), 需要可以下載.
