---
title: "OrangePi R1 Plus LTS"
date: 2023-04-25
description: "2023年04月25日"
tags: ["日誌", "硬件"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20230425-OrangePi-R1-Plus-LTS-13z0.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2023042505qp2y/"]
language: "zh-tw"
---

這幾天沒忍住，又入手了一塊便宜的軟路由，就是這個香橙派的R1plusLTS，這個型號的上一款R1plus和NanoPi R2S的配置一模一樣，處理器和網卡內存等等都一樣，這個LTS型號據說是芯片短缺的時候出現的，把網卡從RTL8211E換成了YT8531C了，內存從DDR4換成了LPDDR3, 其他還是一樣，不過這兩個硬件一換的話，原本R2S的固件和R1plus還能兼容，現在是沒辦法兼容了，網上對R1plusLTS適配的固件也比較少. 最壞的情況也得自己編譯了。

我目前打算使用[https://github.com/haiibo/OpenWrt](https://github.com/haiibo/OpenWrt)的編譯腳本，編譯一個LTS的固件，如果失敗了就使用[https://github.com/XiaoBinin/Actions-immortalwrt](https://github.com/XiaoBinin/Actions-immortalwrt)的固件.

晚上試試吧…

**2023/04/26**

目前用了https://github.com/XiaoBinin/Actions-immortalwrt的固件，不使用Lean固件的主要原因是有一個斷網問題，我平時玩遊戲的時候大概2-3小時就會出現一次間歇性斷網，斷網時間大概是10s左右，這個時間也不像是系統重啟，更感覺像是OpenClash的問題，我也嘗試找過這個問題，什麼修改模式，更換內核什麼的都做過了，但是還是老毛病，這次換成immortalwrt的固件試試看，能不能解決這個問題。
