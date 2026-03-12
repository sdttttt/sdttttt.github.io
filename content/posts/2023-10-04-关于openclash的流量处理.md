---
title: "关于OpenClash的流量处理"
date: 2023-10-04
tags: ["软路由"]
categories: ["学习思考"]
author: sdttttt
draft: false
---

这几天闲来无事, 学习了一些关于iptables的知识, 同时也了解了一下OpenClash在OpenWRT上是怎么对经过网关的流量做透明代理的.

首先是Filter规则, filter是一个专门的流量过滤器, 它是不做任何流量处理的, 只负责拦截.

```
Chain INPUT (policy ACCEPT)
target     prot opt source               destination
openclash_wan_input  all  --  anywhere             anywhere             ! match-set localnetwork src
ACCEPT     all  --  anywhere             anywhere             policy match dir in pol ipsec proto esp
SOCAT      all  --  anywhere             anywhere
ACCEPT     all  --  anywhere             anywhere             /* !fw3 */
input_rule  all  --  anywhere             anywhere             /* !fw3: Custom input rule chain */
ACCEPT     all  --  anywhere             anywhere             ctstate RELATED,ESTABLISHED /* !fw3 */
syn_flood  tcp  --  anywhere             anywhere             tcp flags:FIN,SYN,RST,ACK/SYN /* !fw3 */
zone_lan_input  all  --  anywhere             anywhere             /* !fw3 */
zone_wan_input  all  --  anywhere             anywhere             /* !fw3 */
zone_VPN_input  all  --  anywhere             anywhere             /* !fw3 */
zone_vpn_input  all  --  anywhere             anywhere             /* !fw3 */
zone_docker_input  all  --  anywhere             anywhere             /* !fw3 */
```

这里我们只看第一条目标是`openclash_wan_input` 的规则简单的解释一下, 所有自外部网络的所有流量（all）转发到 OpenClash 进行处理，但不包括来自本地网络的流量（localnetwork）, 

```
Chain openclash_wan_input (1 references)
target     prot opt source               destination
REJECT     udp  --  anywhere             anywhere             multiport dports 7892,7895,9090,7890,7891,7893,7874 reject-with icmp-port-unreachable
REJECT     tcp  --  anywhere             anywhere             multiport dports 7892,7895,9090,7890,7891,7893,7874 reject-with icmp-port-unreachable
```

然后`openclash_wan_input` 这个也比较简单, 拒绝所有TCP/UDP目标是7892,7895,9090,7890,7891,7893,7874的流量. 这些端口是clash的一些dns, 透明代理等端口.

上下文连起来就可以知道, 这个filter就是openclash不希望非内部的主机连接clash的端口.

---

接下来看NAT的规则, NAT可以对数据包的目的地和源地址做修改, 起着转发的作用. 这里是PREROUTING链, 一般是数据包在进入防火墙之前会被放在这里处理.

```
Chain PREROUTING (policy ACCEPT)
target     prot opt source               destination
prerouting_rule  all  --  anywhere             anywhere             /* !fw3: Custom prerouting rule chain */
zone_lan_prerouting  all  --  anywhere             anywhere             /* !fw3 */
zone_wan_prerouting  all  --  anywhere             anywhere             /* !fw3 */
zone_VPN_prerouting  all  --  anywhere             anywhere             /* !fw3 */
zone_vpn_prerouting  all  --  anywhere             anywhere             /* !fw3 */
zone_docker_prerouting  all  --  anywhere             anywhere             /* !fw3 */
REDIRECT   udp  --  anywhere             OpenWrt.lan          udp dpt:domain redir ports 5352
REDIRECT   udp  --  anywhere             192.168.1.5          udp dpt:domain redir ports 5352
openclash  tcp  --  anywhere             anywhere
```

openclash自己的是这里表里的最后一条规则. 如果上面的规则都没有命中, 就会走到Openclash这里.

```
Chain openclash (1 references)
target     prot opt source               destination
RETURN     tcp  --  anywhere             anywhere             tcp spt:1688
RETURN     tcp  --  anywhere             anywhere             tcp spt:1723
RETURN     tcp  --  anywhere             anywhere             tcp spt:openvpn
RETURN     all  --  anywhere             anywhere             match-set localnetwork dst
REDIRECT   tcp  --  anywhere             anywhere             redir ports 7892
```

来看看openclash.其实这里的规则我不用解释应该也能看得懂. 就不解释了

然后看看nat中的output链, 该链的处理时间是在数据包通过防火墙的时候会被处理.

```
Chain OUTPUT (policy ACCEPT)
target     prot opt source               destination
openclash_output  all  --  anywhere             anywhere
```

非常简单的一条, 所有流量都会流到openclash.

```
Chain openclash_output (1 references)
target     prot opt source               destination
RETURN     tcp  --  anywhere             anywhere             tcp spt:1688
RETURN     tcp  --  anywhere             anywhere             tcp spt:1723
RETURN     tcp  --  anywhere             anywhere             tcp spt:openvpn
REDIRECT   tcp  --  anywhere             198.18.0.0/16        ! owner UID match nobody redir ports 7892
RETURN     all  --  anywhere             anywhere             match-set localnetwork dst
REDIRECT   tcp  --  anywhere             anywhere             ! owner UID match nobody redir ports 7892
```

然后我们看看这里面的规则.

第一条是如果源端口是1688, 并且是TCP协议, 那么直接返回, 停止后续匹配, `RETURN` 就起着这样的作用

第二天也是大概同理.

第三条也差不多, 不过openvpn是一个ipset也就是集合, 里面存放了一些用来匹配的主机信息.

第四天是如果目标是`198.18.0.0/16` 网段, `! owner UID match nobody` 是这个数据包的用户不能是nobody, 这个我也不太理解, 外部来的数据包一般的所属用户会是谁? 最后会被转发到7892端口, 这个端口也就是clash的透明代理端口, 至于`198.18.0.0/16` 这个实际上是我开了fake-ip的原因. 所有的dns都会是在该网段中的地址.

第五条和之前的filter类似, 如果目标连接是本地连接就终止匹配.

最后一条和第四条类似, 这条应该是非fake-ip状态下的规则.

---

以上就是Openclash对直连情况下的流量做的处理, 还有一种就是流量会经过TUN的时候.

> TUN 作为网络层设备, 它可以用来处理 TCP、UDP、ICMP 流量. 它已经在生产环境中进行了广泛的测试和使用 - 您甚至可以用它来玩竞技游戏.
> 
> 
> 使用 Clash TUN 的最大优势之一是内置支持对操作系统路由表、路由规则和 nftable 的自动管理.
> 

我使用的方案是混合模式, TCP流量走直连, UDP流量走TUN.

这里也看一下Openclash是如何处理UDP流量的.

```
root@OpenWrt:~# iptables -t mangle -L
Chain PREROUTING (policy ACCEPT)
target     prot opt source               destination
openclash  udp  --  anywhere             anywhere
```

这是mangle表, 这张表所做的工作比filter和nat更细一些, mangle能修改数据包的各种属性. 如标记（mark）、TTL（Time to Live）值、TOS（Type of Service）字段等。

```
Chain openclash (1 references)
target     prot opt source               destination
RETURN     udp  --  anywhere             anywhere             udp spt:openvpn
RETURN     udp  --  anywhere             anywhere             udp spt:4500
RETURN     udp  --  anywhere             anywhere             udp spt:isakmp
RETURN     udp  --  anywhere             anywhere             udp spt:isakmp
RETURN     udp  --  anywhere             anywhere             udp spt:bootpc
RETURN     all  --  anywhere             anywhere
RETURN     all  --  anywhere             anywhere             match-set localnetwork dst
openclash_upnp  udp  --  anywhere             anywhere
MARK       all  --  anywhere             anywhere             MARK set 0x162
```

上面部分其实没什么好看的, 主要是最后一条, 讲数据包标记为162. mark是策略路由经常使用的一个方法.

接下来我们就需要知道162到底是会被如何路由.

```
root@OpenWrt:~# ip rule list
0:      from all lookup local
32764:  from all fwmark 0x162 lookup 354
32765:  from all fwmark 0x162 lookup 354
32766:  from all lookup main
32767:  from all lookup default
```

如果数据包的标记等于`0x162`，那么它们将被路由到表354（lookup 354）。

```
root@OpenWrt:~# ip route list table 354
default dev utun scope link
```

结束了, 所有进来的流量都会流到utun网卡.

以上就是OpenClash对防火墙做的所有操作.

不过听说近几年nftable有崛起的趋势, 要把iptable代替. 并且nft性能也更优秀配置更加简单.

不过这种事还早着.