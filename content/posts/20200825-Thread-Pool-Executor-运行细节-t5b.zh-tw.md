---
title: "Thread Pool Executor 運行細節"
date: 2020-08-25
description: "解析 Java 線程池執行器的構造參數與執行流程,說明提交任務時核心線程數、阻塞隊列、最大線程數與拒絕策略的判定順序,以及工作線程循環從阻塞隊列取任務的運行機制與各階段對應的源碼細節與線程池調優要點。"
author: sdttttt
tags: ["學習"]
draft: false
cover:
  image: "images/covers/20200825-Thread-Pool-Executor-運行細節-t5b.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020082505r9um/"]
language: "zh-tw"
---

先說說線程池本身, 由於線程資源本身在計算機中比較昂貴, 創建和銷燬都有相當的開銷, 所以在一些處理簡單但是併發量大的場景使用一個請求對應一個線程的是不明智的選擇.

ThreadPoolExecutor是Java中線程池的一種實現. 構造函數如下:

```java
public ThreadPoolExecutor(int corePoolSize, // 核心線程數量
                              int maximumPoolSize, // 最大線程數量
                              long keepAliveTime, // 存活時間
                              TimeUnit unit, // 時間單位
                              BlockingQueue<Runnable> workQueue // 來個列隊
                        ) {
        this(corePoolSize, maximumPoolSize, keepAliveTime, unit, workQueue,
             Executors.defaultThreadFactory(), defaultHandler);
    }
```

提交任務時的運行如下:

- 如果正在運行的線程數 < coreSize，馬上創建線程執行該task，不排隊等待；
- 如果正在運行的線程數 >= coreSize，把該task放入阻塞隊列；
- 如果隊列已滿 && 正在運行的線程數 < maximumPoolSize，創建新的線程執行該task；
- 如果隊列已滿 && 正在運行的線程數 >= maximumPoolSize，線程池調用handler的reject方法拒絕本次提交。
- 從worker線程自己的角度來看，當worker的task執行結束之後，循環從阻塞隊列中取出任務執行。
