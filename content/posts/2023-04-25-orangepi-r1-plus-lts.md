---
title: "OrangePi R1 Plus LTS"
date: 2023-04-25
tags: ["日志", "软路由"]
author: sdttttt
draft: false
---

这几天没忍住，又入手了一块便宜的软路由，就是这个香橙派的R1plusLTS，这个型号的上一款R1plus和NanoPi R2S的配置一模一样，处理器和网卡内存等等都一样，这个LTS型号据说是芯片短缺的时候出现的，把网卡从RTL8211E换成了YT8531C了，内存从DDR4换成了LPDDR3, 其他还是一样，不过这两个硬件一换的话，原本R2S的固件和R1plus还能兼容，现在是没办法兼容了，网上对R1plusLTS适配的固件也比较少. 最坏的情况也得自己编译了。

我目前打算使用[https://github.com/haiibo/OpenWrt](https://github.com/haiibo/OpenWrt)的编译脚本，编译一个LTS的固件，如果失败了就使用[https://github.com/XiaoBinin/Actions-immortalwrt](https://github.com/XiaoBinin/Actions-immortalwrt)的固件.

晚上试试吧…

**2023/04/26**

目前用了https://github.com/XiaoBinin/Actions-immortalwrt的固件，不使用Lean固件的主要原因是有一个断网问题，我平时玩游戏的时候大概2-3小时就会出现一次间歇性断网，断网时间大概是10s左右，这个时间也不像是系统重启，更感觉像是OpenClash的问题，我也尝试找过这个问题，什么修改模式，更换内核什么的都做过了，但是还是老毛病，这次换成immortalwrt的固件试试看，能不能解决这个问题。
