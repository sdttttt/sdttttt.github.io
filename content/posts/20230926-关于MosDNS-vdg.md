---
title: "关于MosDNS"
date: 2023-09-26
description: "介绍 MosDNS 作为可编程 DNS 服务器的请求处理和分流能力，并通过示例说明可自定义拒绝、缓存和放行等处理流程。"
tags: ["硬件"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20230926-关于MosDNS-vdg.svg"
  alt: ""
  hidden: false
aliases: ["/posts/202309260673s4/"]
---

其实在翻SmartDNS文档的时候找到了另一个DNS服务器, 那就是MosDNS.

“一个 DNS 转发器” MosDNS官方是这么介绍这个DNS的, 但是实际上我更愿意称它是一个**可编程的DNS服务器.**

MosDNS对比其他DNS服务器不同之处就是它的在请求的逻辑处理能力, 以及分流能力非常优秀.

这么说可能不太好理解, 举个例子, MosDNS可以通过DNS协议请求某个值, 来做一些其他的处理 ,例如拒绝, 通过, 缓存等等行为.

可以以编写代码的方式来自定义一个属于自己网络特点的DNS的处理流程.

不过MosDNS并不适合我, 如果你的使用Passwall或者其他没有很强分流能力的网络工具, MosDNS或许你用的上.

我使用的是OpenClash的方案, Clash自身已经集成了很强的分流规则. 不需要更多的分流处理. 所以我使用的是SmartDNS.
