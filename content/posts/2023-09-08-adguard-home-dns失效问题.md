---
title: "AdGuard Home DNS失效问题"
date: 2023-09-08
tags: ["思考", "软路由"]
author: sdttttt
draft: false
---

我的软路由上一般只会开两个软件, 一个是Openclash, 还有一个是AdGuardHome.

一般会首先把ADH替换掉dnsmasq, 让DNS请求全部走到ADH这边, 我使用ADH的理由也比较简单, 就是做一个DNS日志, 然后ADH的上游设成Openclash的DNS, 我使用的clash模式是fake-ip 混合模式, UDP走TUN, TCP走直连. 一般就这么用着. fake-ip用了很长时间稳定性也不错, 基本不会遇到什么问题.

但是有的时候就是会出现ADH的DNS解析突然失效的问题.

其实也不算是ADH挂了, 就是DNS请求突然不走ADH了, 也不是防火墙转发的问题.

其实这个问题是不影响上网的, 就是我内部的一些放在ADH上的解析重写突然没法用了. 出现的症状也比较简单, 就是域名解析出来的IP开始变成正常IP了, 不是fake-ip. 很明显这个就是DNS请求没有走ADH的情况.

这个问题发生的很突然, 没有什么预兆, Openwrt的系统日志里也没有什么端倪.

如果DNS没有走ADH, 那是谁解析的DNS呢? 

这个问题我一直都没找到答案. 但是Openwrt上的提供DNS服务的软件就两个, 一个是dnsmasq, 还有一个就是ADH. dnsmasq我看过日志, 没有解析记录, 那么情况就只可能是DNS请求走了上级路由的解析. 这个只能说百思不得其解. DNS没有在Openwrt中被解析我是没想到的.

不过调试了很久还是有一定成果, Turbo ACC这个插件会影响DNS的解析. 我昨天尝试关掉了全锥形NAT, DNS就恢复正常了. 不是很懂全锥形NAT和DNS还有什么关系???

…