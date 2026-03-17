---
title: "重装软路由"
date: 
author: sdttttt
draft: false
---

平时使用的软路由方案渐渐成型了，想着自己开始编译一个更加干净的固件。

本来想用lean的固件但是还是自己不会编译，就算了。本人在编译固件上完全就是苦手，太懒了。

最后用的是天灵的ImmortalWrt 23.05.1，主要是这个官方有一个固件生成器，非常好用

我的软路由软件用的只有DAED和mosdns，mosdns倒是简单，没有外部依赖的。

主要是DAED比较麻烦，这个有依赖一些内核模块，需要编译的时候在依赖里加上：

```jsx
kmod-sched-core kmod-sched-bpf kmod-xdp-sockets-diag
```

---

今天是12.7

今天测试了一下天灵大佬的Immortalwrt和404大佬的YAOF固件，平台不一样，测试结果有点哈人，测试的时Orangepi R1 Plus LTS和R2S

![Untitled](Untitled%202.png)

这是immortalwrt 23.05.1 Orangepi R1 Plus LTS 的测试，在油管上看播放4k，播放的时候经常卡住… 

![Untitled](Untitled%203.png)

这个是YAOF 23.05.2 R2S上的测试，在油管上看播放4k，可以说非常流畅。负载也低了不少。

说实话有点震惊，因为这两台机器的配置基本是差不多的，CPU是一样的型号，不同的只有网卡和内存。但是不同固件成绩差距会这么大么？

---

又测试了一下R2S上的Immortalwrt固件，成绩和YAOF差不多，看来固件对设备的适配还是很重要的…Orangepi 属于是优化不好的案例。

所以说大伙买软路由还是得买热门的设备，这种软件上支持会比较好啊。