---
title: "openclash 转发改为TProxy"
date: 2023-11-22
tags: ["思考", "软路由"]
categories: ["学习思考"]
author: sdttttt
draft: false
---

最近不想用Tun了，但是OpenClash的转发也不是全走的TProxy，TCP走Redirect，UDP走TProxy

这次修改一下防火墙来达到两个协议都用TProxy

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

然后修改OpenClash的系统脚本

```jsx
#!/bin/sh
. /usr/share/openclash/log.sh
. /lib/functions.sh

# This script is called by /etc/init.d/openclash
# Add your custom firewall rules here, they will be added after the end of the OpenClash iptables rules

LOG_OUT "Tip: Start Add Custom Firewall Rules..."

// 删除NAT的端口转发，默认这条规则在10下标位置
iptables -t nat -D PREROUTING 10

// 删除原本的UDPTProxy代理转发
iptables -t mangle -D PREROUTING 2
iptables -t mangle -D PREROUTING 2

// 同上
iptables -t mangle -D OUTPUT 2
iptables -t mangle -D OUTPUT 2

exit 0
```