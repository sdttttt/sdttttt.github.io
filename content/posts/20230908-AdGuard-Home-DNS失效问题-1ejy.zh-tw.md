---
title: "AdGuard Home DNS失效問題"
date: 2023-09-08
description: "分析 OpenWrt 中 AdGuard Home 突然不再處理 DNS 請求的現象，結合日誌排查後發現關閉 Turbo ACC 的全錐形 NAT 後恢復。"
tags: ["思考", "硬件"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20230908-AdGuard-Home-DNS失效問題-1ejy.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2023090809zhyq/"]
language: "zh-tw"
---

我的軟路由上一般只會開兩個軟件, 一個是Openclash, 還有一個是AdGuardHome.

一般會首先把ADH替換掉dnsmasq, 讓DNS請求全部走到ADH這邊, 我使用ADH的理由也比較簡單, 就是做一個DNS日誌, 然後ADH的上游設成Openclash的DNS, 我使用的clash模式是fake-ip 混合模式, UDP走TUN, TCP走直連. 一般就這麼用著. fake-ip用了很長時間穩定性也不錯, 基本不會遇到什麼問題.

但是有的時候就是會出現ADH的DNS解析突然失效的問題.

其實也不算是ADH掛了, 就是DNS請求突然不走ADH了, 也不是防火牆轉發的問題.

其實這個問題是不影響上網的, 就是我內部的一些放在ADH上的解析重寫突然沒法用了. 出現的症狀也比較簡單, 就是域名解析出來的IP開始變成正常IP了, 不是fake-ip. 很明顯這個就是DNS請求沒有走ADH的情況.

這個問題發生的很突然, 沒有什麼預兆, Openwrt的系統日誌裡也沒有什麼端倪.

如果DNS沒有走ADH, 那是誰解析的DNS呢?

這個問題我一直都沒找到答案. 但是Openwrt上的提供DNS服務的軟件就兩個, 一個是dnsmasq, 還有一個就是ADH. dnsmasq我看過日誌, 沒有解析記錄, 那麼情況就只可能是DNS請求走了上級路由的解析. 這個只能說百思不得其解. DNS沒有在Openwrt中被解析我是沒想到的.

不過調試了很久還是有一定成果, Turbo ACC這個插件會影響DNS的解析. 我昨天嘗試關掉了全錐形NAT, DNS就恢復正常了. 不是很懂全錐形NAT和DNS還有什麼關係???

…
