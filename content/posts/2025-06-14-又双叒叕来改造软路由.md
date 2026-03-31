---
title: "又双叒叕来改造软路由"
date: 2025-06-14
author: sdttttt
draft: false
---

警告：这次纯粹是闲得慌🤣

这次改造的目标是原Openwrt更改为（伪）旁路由，主路由这次使用RouterOS系统。

国内国外分流会在RouterOS上执行一次，然后国内流量直接由RouterOS处理和发送，国外流量以及DNS请求会被标记网关会被重定向到Openwrt上.

不过Openwrt这次不会设置为网关，不然所有流量都走openwrt那不就和原来一样了？只有被标记才会走Openwrt.

听了可能比较迷糊，我重新解释一下：

首先是旁路由的第一个功能：DNS服务器，所有的DNS都会被路由到Op上，由Op来做DNS解析。

然后是国内流量的处理，完全由ROS也就是主路由处理，完全不会经过Op.

国外流量在ROS上被标记之后，会被路由到Op上，由Op接管这些连接，然后代替发送连接到代理服务器。

这里贴出我当前的ROS配置: CNIP的合集就不贴出来了，太大了..

```c
# 2025-06-14 22:01:59 by RouterOS 7.19.1
# system id = N9pY/4YCgZA
#
/interface bridge
add name=LAN_G
/interface ethernet
set [ find default-name=ether2 ] disable-running-check=no name=LAN2
set [ find default-name=ether1 ] disable-running-check=no name=VM
set [ find default-name=ether3 ] disable-running-check=no name=WAN
set [ find default-name=ether1 ] comment=\
    "\BE\D6\D3\F2\CD\F8\CE\DE\CF\DF\C2\B7\D3\C9\C6\F7" disable-running-check=\
    no name=WLAN
/interface pppoe-client
add add-default-route=yes disabled=no interface=WAN name=pppoe-out1 user=\
    18072827201
/ip dhcp-server option
add code=6 name=openwrt value="'192.168.10.2'"
add code=3 name=gateway value="'192.168.10.1'"
/ip firewall layer7-protocol
add name=Tencent_qq regexp="^.\?.\?[\\x02|\\x05]\\x22\\x27.+|^.\?.\?[\\x02|\\x\
    05]\\x22\\x27.+[\\x03|\\x09]\$|^.\?.\?\\x02.+\\x03\$|^/xFE/x42../x42/x02/x\
    0B/x7D/x98/x38/xE4.+"
/ip pool
add name=LAN_POOL ranges=192.168.10.100-192.168.10.200
/ip dhcp-server
add address-pool=LAN_POOL interface=LAN_G lease-time=8h30m name=LAN_DHCP
/queue tree
add name=download parent=LAN_G queue=default
add name=down_small packet-mark=sp parent=download priority=1 queue=default
add name=down_big packet-mark=bp parent=download queue=default
/routing table
add disabled=no fib name=free
/interface bridge port
add bridge=LAN_G interface=WLAN
add bridge=LAN_G interface=VM
add bridge=LAN_G interface=LAN2
/ipv6 settings
# ipv6 neighbor configuration has changed, please restart the device in order to apply the new settings
set disable-ipv6=yes
/ip address
add address=192.168.10.1/24 interface=LAN_G network=192.168.10.0
/ip dhcp-client
# DHCP client can not run on slave or passthrough interface!
add interface=WLAN
/ip dhcp-server network
add address=192.168.10.0/24 dns-server=192.168.10.2 gateway=192.168.10.1
/ip dns
set allow-remote-requests=yes max-udp-packet-size=65507 servers=192.168.10.2

/ip firewall mangle
add action=mark-connection chain=forward comment=\
    "HTTP/S\C1\F7\C1\BF\B1\EA\BC\C7" dst-port=80,443 new-connection-mark=sp \
    protocol=tcp
add action=mark-packet chain=forward comment="\D0\A1\B0\FC\B1\EA\BC\C7" \
    new-packet-mark=sp packet-size=0-512
add action=mark-packet chain=forward comment="\B4\F3\B0\FC\B1\EA\BC\C7" \
    new-packet-mark=bp packet-size=!0-512
add action=mark-routing chain=prerouting comment=\
    "\C5\D4\C2\B7\D3\C9\D6\B1\BD\D3\CD\A8\B9\FD" new-routing-mark=main \
    passthrough=no src-address=192.168.10.2
add action=accept chain=prerouting comment=\
    "\C4\DA\CD\F8\B5\D8\D6\B7\CD\A8\B9\FD" dst-address-list=A_LOCAL
add action=mark-routing chain=prerouting comment=\
    "DNS\BD\D9\B3\D6\B5\BD\C5\D4\C2\B7\D3\C9" dst-port=53 new-routing-mark=\
    free passthrough=no protocol=udp
add action=accept chain=prerouting comment="\B9\FA\C4\DAIP\CD\A8\B9\FD" \
    dst-address-list=CN
add action=accept chain=prerouting comment=\
    "\B9\FA\C4\DAIP\D6\B1\BD\D3\CD\A8\B9\FD" disabled=yes dst-address-list=\
    CNIP
add action=accept chain=prerouting comment=\
    "TCP\B8\DF\B6\CB\BF\DA\D6\B1\BD\D3\CD\A8\B9\FD" dst-port=!0-9000 \
    protocol=tcp
add action=accept chain=prerouting comment=\
    "UDP\B8\DF\B6\CB\BF\DA\D6\B1\BD\D3\CD\A8\B9\FD" dst-port=!0-9000 \
    protocol=udp
add action=mark-routing chain=prerouting comment="\B1\EA\BC\C7\B3\F6\B9\FA" \
    new-routing-mark=free src-address-list=ALLOW_FREE
/ip firewall nat
add action=masquerade chain=srcnat out-interface=pppoe-out1
/ip route
add disabled=no distance=1 dst-address=0.0.0.0/0 gateway=192.168.10.2 \
    routing-table=free scope=30 suppress-hw-offload=no target-scope=10
/ipv6 address
add address=::62be:b4ff:fe02:f521 eui-64=yes from-pool=ipv6-pool-pppoe-out1 \
    interface=LAN_G
/ipv6 dhcp-client
add add-default-route=yes default-route-tables=main interface=pppoe-out1 \
    pool-name=ipv6-pool-pppoe-out1 request=prefix
/ipv6 nd
set [ find default=yes ] disabled=yes
add interface=LAN_G mtu=1492
/system clock
set time-zone-name=Asia/Shanghai

```

Openwrt 的规则保持原本即可。

RouterOS Firewall:

![image.png](image%203.png)

---

稍微说一下对RouterOS的感受，如同它的名字一样，纯粹的路由器系统。

对比OpenWrt，你无法使用高度自由的命令行工具了，自然也无法在它上面安装各种各样的插件。

有点像思科之类的路由器那种感觉的命令行。

第一次初始化设置起来也相对于Openwrt更加麻烦，比如PPPoE拨号之后你

本身提供了一个GUI界面和各种网络功能支持，还有一个和iptables功能类似的firewall

多亏由这个firewall，所以才能做分流。

不过这个图形化的iptables用起来还是没那么顺手罢了，比如无法同时选择多个协议。

还有一点就是RouterOS的流量监控功能挺全面的。除了能针对接口监控，你还能对QoS队列，甚至防火墙的某一条规则进行流量监控。

---

顺便记一次脑瘫的BUG修复记录。

一开始我OP使用的DNS使用的是国内直连IP，国外也是直连。

后面我开始使用国内直连IP，国外使用FakeIP的模式。

我就发现FakeIP大部分国外网站无法登录，部分常用网站倒是可以，花了我2个小时排查问题。

ROS分流没问题→DNS解析没问题→连接也是标记路由到OP没问题

问题就出在OP连接发起上，我又查看了Clash的调试日志，访问油管推特时有出现连接发起的日志。

但是访问exhentai和wiki就完全一点连接日志也没有，连DNS解析日志都没有。

后面我就开始排查可能是nftables的规则导致的问题。

我仔细盯着每条规则，脑内把所有流量经过链的顺序都模拟了一遍，也没问题啊。

然后就懵逼了，重新从ROS开始排查，又重复了一遍….

最后又回到了nftables的规则上来。

这次我仔细的查看了所有的规则，以及匹配的集合。

其中有一条规则是daddr = @chnip 的，这个是chinadns-ng自动分流产生的@chnip来做缓存，方便防火墙分流，这个集合里大概有1w以上的IP地址。然后我直接一个grep查找，果然发现了fakeip的一部分范围也在这个里面…
