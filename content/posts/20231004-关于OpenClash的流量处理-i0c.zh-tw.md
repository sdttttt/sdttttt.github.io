---
title: "關於OpenClash的流量處理"
date: 2023-10-04
description: "結合 iptables 規則分析 OpenClash 在 OpenWrt 網關上的透明代理流程，涵蓋 Filter、NAT、PREROUTING、OUTPUT 與 TUN 處理。"
tags: ["硬件"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20231004-關於OpenClash的流量處理-i0c.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2023100403k2e5/"]
language: "zh-tw"
---

這幾天閒來無事, 學習了一些關於iptables的知識, 同時也瞭解了一下OpenClash在OpenWRT上是怎麼對經過網關的流量做透明代理的.

首先是Filter規則, filter是一個專門的流量過濾器, 它是不做任何流量處理的, 只負責攔截.

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

這裡我們只看第一條目標是`openclash_wan_input` 的規則簡單的解釋一下, 所有自外部網絡的所有流量（all）轉發到 OpenClash 進行處理，但不包括來自本地網絡的流量（localnetwork）,

```
Chain openclash_wan_input (1 references)
target     prot opt source               destination
REJECT     udp  --  anywhere             anywhere             multiport dports 7892,7895,9090,7890,7891,7893,7874 reject-with icmp-port-unreachable
REJECT     tcp  --  anywhere             anywhere             multiport dports 7892,7895,9090,7890,7891,7893,7874 reject-with icmp-port-unreachable
```

然後`openclash_wan_input` 這個也比較簡單, 拒絕所有TCP/UDP目標是7892,7895,9090,7890,7891,7893,7874的流量. 這些端口是clash的一些dns, 透明代理等端口.

上下文連起來就可以知道, 這個filter就是openclash不希望非內部的主機連接clash的端口.

---

接下來看NAT的規則, NAT可以對數據包的目的地和源地址做修改, 起著轉發的作用. 這裡是PREROUTING鏈, 一般是數據包在進入防火牆之前會被放在這裡處理.

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

openclash自己的是這裡表裡的最後一條規則. 如果上面的規則都沒有命中, 就會走到Openclash這裡.

```
Chain openclash (1 references)
target     prot opt source               destination
RETURN     tcp  --  anywhere             anywhere             tcp spt:1688
RETURN     tcp  --  anywhere             anywhere             tcp spt:1723
RETURN     tcp  --  anywhere             anywhere             tcp spt:openvpn
RETURN     all  --  anywhere             anywhere             match-set localnetwork dst
REDIRECT   tcp  --  anywhere             anywhere             redir ports 7892
```

來看看openclash.其實這裡的規則我不用解釋應該也能看得懂. 就不解釋了

然後看看nat中的output鏈, 該鏈的處理時間是在數據包通過防火牆的時候會被處理.

```
Chain OUTPUT (policy ACCEPT)
target     prot opt source               destination
openclash_output  all  --  anywhere             anywhere
```

非常簡單的一條, 所有流量都會流到openclash.

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

然後我們看看這裡面的規則.

第一條是如果源端口是1688, 並且是TCP協議, 那麼直接返回, 停止後續匹配, `RETURN` 就起著這樣的作用

第二天也是大概同理.

第三條也差不多, 不過openvpn是一個ipset也就是集合, 裡面存放了一些用來匹配的主機信息.

第四天是如果目標是`198.18.0.0/16` 網段, `! owner UID match nobody` 是這個數據包的用戶不能是nobody, 這個我也不太理解, 外部來的數據包一般的所屬用戶會是誰? 最後會被轉發到7892端口, 這個端口也就是clash的透明代理端口, 至於`198.18.0.0/16` 這個實際上是我開了fake-ip的原因. 所有的dns都會是在該網段中的地址.

第五條和之前的filter類似, 如果目標連接是本地連接就終止匹配.

最後一條和第四條類似, 這條應該是非fake-ip狀態下的規則.

---

以上就是Openclash對直連情況下的流量做的處理, 還有一種就是流量會經過TUN的時候.

> TUN 作為網絡層設備, 它可以用來處理 TCP、UDP、ICMP 流量. 它已經在生產環境中進行了廣泛的測試和使用 - 您甚至可以用它來玩競技遊戲.
>
> 使用 Clash TUN 的最大優勢之一是內置支持對操作系統路由表、路由規則和 nftable 的自動管理.

我使用的方案是混合模式, TCP流量走直連, UDP流量走TUN.

這裡也看一下Openclash是如何處理UDP流量的.

```
root@OpenWrt:~# iptables -t mangle -L
Chain PREROUTING (policy ACCEPT)
target     prot opt source               destination
openclash  udp  --  anywhere             anywhere
```

這是mangle表, 這張表所做的工作比filter和nat更細一些, mangle能修改數據包的各種屬性. 如標記（mark）、TTL（Time to Live）值、TOS（Type of Service）字段等。

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

上面部分其實沒什麼好看的, 主要是最後一條, 講數據包標記為162. mark是策略路由經常使用的一個方法.

接下來我們就需要知道162到底是會被如何路由.

```
root@OpenWrt:~# ip rule list
0:      from all lookup local
32764:  from all fwmark 0x162 lookup 354
32765:  from all fwmark 0x162 lookup 354
32766:  from all lookup main
32767:  from all lookup default
```

如果數據包的標記等於`0x162`，那麼它們將被路由到表354（lookup 354）。

```
root@OpenWrt:~# ip route list table 354
default dev utun scope link
```

結束了, 所有進來的流量都會流到utun網卡.

以上就是OpenClash對防火牆做的所有操作.

不過聽說近幾年nftable有崛起的趨勢, 要把iptable代替. 並且nft性能也更優秀配置更加簡單.

不過這種事還早著.
