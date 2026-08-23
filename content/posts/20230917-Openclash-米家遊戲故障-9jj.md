---
title: "Openclash 米家遊戲故障"
date: 2023-09-17
description: "記錄 OpenClash 下米哈遊遊戲登錄失敗和延遲升高的問題，比較不同內核版本後確認與未持久化 fake-ip 有關。"
tags: ["學習"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20230917-Openclash-米家遊戲故障-9jj.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2023091703wp89/"]
language: "zh-tw"
---

這幾天開始我有的時候登錄mihoyo的遊戲會出現1001_1等登錄問題, 這個問題目前和OpenClash有關.

但是暫時不知道具體是什麼原因導致的, 目前clash的p內核最新版本8.17是不能玩的. 就算登錄上之後, 遊戲的延遲也會莫名增加. 到999ms, 但是不會掉線.

clash.meta的最新alpha版本也不能玩, 登錄都登不進去.

我主要是clash.meta內核的用戶, 版本回退之後測試比較正常的幾個版本: 1.14.5, alpha-gefcb278. 5月和4月的內核看起來沒什麼問題.

alpha-gefcb278

Clash Meta alpha-gefcb278 linux arm64 with go1.20.3 Mon Apr 24 20:16:23 UTC 2023
Use tags: with_low_memory, with_gvisor

---

2023.9.30

問題算是找到了, 算是fake-ip的問題, 我沒有持久化fake-ip, 所有有的時候dns解析就會出現問題. 不知道米家的遊戲dns是怎麼做的, 總是如果是使用fake-ip模式的話, 儘量持久化.

[https://www.notion.so](https://www.notion.so)
