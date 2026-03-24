---
title: "Openclash 米家游戏故障"
date: 2023-09-17
tags: ["工具"]
categories: ["碎片杂文"]
author: sdttttt
draft: false
---

这几天开始我有的时候登录mihoyo的游戏会出现1001_1等登录问题, 这个问题目前和OpenClash有关.

但是暂时不知道具体是什么原因导致的, 目前clash的p内核最新版本8.17是不能玩的. 就算登录上之后, 游戏的延迟也会莫名增加. 到999ms, 但是不会掉线.

clash.meta的最新alpha版本也不能玩, 登录都登不进去.

我主要是clash.meta内核的用户, 版本回退之后测试比较正常的几个版本: 1.14.5, alpha-gefcb278. 5月和4月的内核看起来没什么问题.

alpha-gefcb278

Clash Meta alpha-gefcb278 linux arm64 with go1.20.3 Mon Apr 24 20:16:23 UTC 2023
Use tags: with_low_memory, with_gvisor

---

2023.9.30

问题算是找到了, 算是fake-ip的问题, 我没有持久化fake-ip, 所有有的时候dns解析就会出现问题. 不知道米家的游戏dns是怎么做的, 总是如果是使用fake-ip模式的话, 尽量持久化.

[https://www.notion.so](https://www.notion.so)
