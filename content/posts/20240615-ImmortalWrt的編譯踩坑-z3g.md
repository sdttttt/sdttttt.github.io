---
title: "ImmortalWrt的編譯踩坑"
date: 2024-06-15
description: "記錄 ImmortalWrt 編譯時啟用 BPF 相關構建後遇到的 LLVM/clang 版本過低問題，並給出安裝 12 以上版本的命令示例。"
author: sdttttt
draft: false
cover:
  image: "images/covers/20240615-ImmortalWrt的編譯踩坑-z3g.svg"
  alt: ""
  hidden: false
aliases: ["/posts/20240615066upj/"]
language: "zh-tw"
---

這篇文章會經常更新。

我主要在路由器上使用DAE來進行網絡流量處理。

所以必須在系統編譯上開啟一些BPF的相關構建。

以下是一些我遇到過的報錯。

- ERROR: package/kernel/bpf-headers failed to build.

這個問題最後拋出的關鍵信息是 /workdir/openwrt/include/bpf.mk:71: \*\*\* ERROR: LLVM/clang version too old. Minimum required: 12, found: . Stop.

只要安裝LLVM/clang 12以上的版本就可以。

```jsx
sudo sh -c 'echo "deb http://apt.llvm.org/focal/ llvm-toolchain-focal-12 main" >> /etc/apt/sources.list'
sudo sh -c 'echo "deb-src http://apt.llvm.org/focal/ llvm-toolchain-focal-12 main" >> /etc/apt/sources.list'
wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key | sudo apt-key add -

sudo apt update -y
sudo apt full-upgrade -y
sudo apt install -y clang-12 llvm-12
```
