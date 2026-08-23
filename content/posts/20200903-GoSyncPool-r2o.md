---
title: "GoSyncPool"
date: 2020-09-03
tags: ["學習"]
description: "sync.pool 一個Go底層的內存複用池."
author: sdttttt
draft: false
cover:
  image: "images/covers/20200903-GoSyncPool-r2o.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020090304bikc/"]
language: "zh-tw"
---

今天在看Sentinel-golang源碼的時候發現sentinel在內部使用了sync.Pool該結構體.看到Sync和Pool的我第一反應想到應該是線程池之類的東西.在實際看過原理之後發現並不是這樣的.

---

sync.Pool 的目的是為了利用對象的複用來減小GC壓力.但是開銷比較高.要斟酌使用.

Pool和golang的GMP協程模型的關係比較大.
sync.Pool對每一個P(系統線程)都分配了一個本地池.

本地池中有2個屬性，分別是private和share。
private只能被當前P訪問，share可以被不同的P訪問.

在執行Get or Put的時候.會對應當前執行P的本地池.

#### Get

1. 嘗試從本地P對應的那個本地池中獲取一個對象值, 並從本地池衝刪除該值。
2. 如果獲取失敗，那麼從共享池中獲取, 並從共享隊列中刪除該值。
3. 如果獲取失敗，那麼從其他P的共享池中偷一個過來，並刪除共享池中的該值(p.getSlow())。
4. 如果仍然失敗，那麼直接通過New()分配一個返回值，注意這個分配的值不會被放入池中。New()返回用戶註冊的New函數的值，如果用戶未註冊New，那麼返回nil。

#### Put

1. 如果放入的值為空，直接return.
2. 檢查當前goroutine的是否設置對象池私有值，如果沒有則將x賦值給其私有成員，並將x設置為nil。
3. 如果當前goroutine私有值已經被設置，那麼將該值追加到共享列表。
