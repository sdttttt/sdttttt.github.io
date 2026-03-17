---
title: "ImmortalWrt的编译踩坑"
date: 
author: sdttttt
draft: false
---

这篇文章会经常更新。

我主要在路由器上使用DAE来进行网络流量处理。

所以必须在系统编译上开启一些BPF的相关构建。

以下是一些我遇到过的报错。

- ERROR: package/kernel/bpf-headers failed to build.

这个问题最后抛出的关键信息是 /workdir/openwrt/include/bpf.mk:71: *** ERROR: LLVM/clang version too old. Minimum required: 12, found: . Stop.

只要安装LLVM/clang 12以上的版本就可以。

```jsx
sudo sh -c 'echo "deb http://apt.llvm.org/focal/ llvm-toolchain-focal-12 main" >> /etc/apt/sources.list'
sudo sh -c 'echo "deb-src http://apt.llvm.org/focal/ llvm-toolchain-focal-12 main" >> /etc/apt/sources.list'
wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key | sudo apt-key add -

sudo apt update -y
sudo apt full-upgrade -y
sudo apt install -y clang-12 llvm-12
```