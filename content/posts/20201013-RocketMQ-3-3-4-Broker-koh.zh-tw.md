---
title: "RocketMQ 3.3.4 Broker"
date: 2020-10-13
description: "逐段解析 RocketMQ Broker 啟動入口的 main、createBrokerController、start 三個函數,涵蓋命令行參數解析、配置類初始化、各層服務啟動順序、定時註冊到 NameServer 與刪除冗餘 Topic 等核心流程,以及控制器內部職責、各組件協作關係、關鍵源碼細節解讀與流程串聯示意。"
tags: ["學習"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20201013-RocketMQ-3-3-4-Broker-koh.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020101304327j/"]
language: "zh-tw"
---

差不多可以看消息隊列的源碼了。
在下從gitee上找到了rocketmq的早期版本（3.2.2），
壞消息是這個2014年的項目裡沒有單元測試極少, 調試會比較困難.
好消息是這個時候的RocketMQ還沒開源多久，裡面有很多中文註釋。看起來會很舒服。

我們從Broker開始塗鴉。關於RocketMQ中每個角色的作用這裡不再陳述：

先從初始化開始：

```Java
    public static void main(String[] args) {
        start(createBrokerController(args));
    }
```

rocketmq是從`commandline`啟動的，`createBrokerController`函數比較長，
會有很多額外的邏輯干擾你，我這裡直接說重點：

- 讀取環境變量，沒有就用默認值。
- 解析命令行參數。
- 初始化配置類。
- 打印默認配置內容。
- 檢查NameServer地址設置是否正確。
- 檢查broker的類型（master，slave）
- 初始化日誌配置類。
- 再次打印。
- 初始化服務控制對象.
- 最後增加一個關閉Broker時觸發的hook.

> 服務控制對象： Broker各個服務控制器，包括存儲層配置，配置文件版本號，消費進度存儲，Consumer連接、訂閱關係管理等等。

以上就是`createBrokerController`的內容，函數雖然長，但是並不複雜。

下面為`start`函數的內容, 在`main`中的`start`函數實際上是去委託了`BrokerController`去執行.

```java
    public void start() throws Exception {

        // 啟動Broker的各層服務

        if (this.messageStore != null) {
            this.messageStore.start();
        }

        if (this.remotingServer != null) {
            this.remotingServer.start();
        }

        if (this.brokerOuterAPI != null) {
            this.brokerOuterAPI.start();
        }

        if (this.pullRequestHoldService != null) {
            this.pullRequestHoldService.start();
        }

        if (this.clientHousekeepingService != null) {
            this.clientHousekeepingService.start();
        }

        if (this.filterServerManager != null) {
            this.filterServerManager.start();
        }

        // 啟動時，註冊該Broker的信息到所有的NameServer
        this.registerBrokerAll(true);

        // 定時註冊Broker到Name Server
        this.scheduledExecutorService.scheduleAtFixedRate(() -> {
            try {
                this.registerBrokerAll(true);
            } catch (Exception e) {
                log.error("registerBrokerAll Exception", e);
            }
        }, 1000 * 10, 1000 * 30, TimeUnit.MILLISECONDS);

        if (this.brokerStatsManager != null) {
            // 看起來就是一些數據統計線程
            this.brokerStatsManager.start();
        }

        // 刪除多餘的Topic
        this.addDeleteTopicTask();
    }
```

整個Borker的流程差不多就是這樣.代碼裡並沒有什麼亮點說實話.
