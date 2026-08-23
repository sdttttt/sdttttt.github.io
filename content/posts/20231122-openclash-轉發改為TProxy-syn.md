---
title: "openclash 轉發改為TProxy"
date: 2023-11-22
description: "說明將 OpenClash 從 TCP Redirect、UDP TProxy 改為 TCP/UDP 統一使用 TProxy 的背景，並列出 mangle 規則與防火牆腳本修改。"
tags: ["思考", "硬件"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20231122-openclash-轉發改為TProxy-syn.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2023112207y3a0/"]
language: "zh-tw"
---

最近不想用Tun了，但是OpenClash的轉發也不是全走的TProxy，TCP走Redirect，UDP走TProxy

這次修改一下防火牆來達到兩個協議都用TProxy

```jsx

iptables -t mangle -N clash_tproxy

iptables -t mangle -A clash_tproxy -p udp -m udp --sport 500 -j RETURN
iptables -t mangle -A clash_tproxy -i lo -j RETURN
iptables -t mangle -A clash_tproxy -m set --match-set localnetwork dst -j RETURN

iptables -t mangle -A clash_tproxy -p udp -m udp --dport 53 -j RETURN

iptables -t mangle -A clash_tproxy -d 198.18.0.0/16 -p udp -j TPROXY --on-port 7895 --on-ip 0.0.0.0 --tproxy-mark 0x162
iptables -t mangle -A clash_tproxy -d 198.18.0.0/16 -p tcp -j TPROXY --on-port 7895 --on-ip 0.0.0.0 --tproxy-mark 0x162

iptables -t mangle -A clash_tproxy -p udp -j TPROXY --on-port 7895 --on-ip 0.0.0.0 --tproxy-mark 0x162
iptables -t mangle -A clash_tproxy -p tcp -j TPROXY --on-port 7895 --on-ip 0.0.0.0 --tproxy-mark 0x162

iptables -t mangle -N clash_tproxy_output

iptables -t mangle -A clash_tproxy_output -p udp -m udp --sport 500 -j RETURN
iptables -t mangle -A clash_tproxy_output -d 198.18.0.0/16 -p udp -m owner ! --uid-owner 65534 -j MARK --set-xmark 0x162
iptables -t mangle -A clash_tproxy_output -d 198.18.0.0/16 -p tcp -m owner ! --uid-owner 65534 -j MARK --set-xmark 0x162

iptables -t mangle -A PREROUTING -j clash_tproxy
iptables -t mangle -A OUTPUT -j clash_tproxy_output
```

然後修改OpenClash的系統腳本

```jsx
#!/bin/sh
. /usr/share/openclash/log.sh
. /lib/functions.sh

# This script is called by /etc/init.d/openclash
# Add your custom firewall rules here, they will be added after the end of the OpenClash iptables rules

LOG_OUT "Tip: Start Add Custom Firewall Rules..."

// 刪除NAT的端口轉發，默認這條規則在10下標位置
iptables -t nat -D PREROUTING 10

// 刪除原本的UDPTProxy代理轉發
iptables -t mangle -D PREROUTING 2
iptables -t mangle -D PREROUTING 2

// 同上
iptables -t mangle -D OUTPUT 2
iptables -t mangle -D OUTPUT 2

exit 0
```
