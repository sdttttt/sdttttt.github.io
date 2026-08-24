---
title: "MultiplexingIO"
date: 2020-04-06
description: "解釋 I/O 多路複用的真正含義,即單線程通過跟蹤每個 socket 的狀態同時管理多個 I/O 流,並對比 select、poll 和 epoll 的演進。"
tags: ["學習"]
draft: false
cover:
  image: "images/covers/20200406-MultiplexingIO-1caf.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020040609je5b/"]
language: "zh-tw"
---

其實“I/O多路複用”這個坑爹翻譯可能是這個概念在中文裡面如此難理解的原因。所謂的I/O多路
複用在英文中其實叫 I/O multiplexing. 如果你搜索multiplexing啥意思,基本上都會出這個圖:

![](/multiplexIO/1.png)

於是大部分人都直接聯想到"一根網線,多個sock複用" 這個概念,包括上面的幾個回答, 其實不
管你用多進程還是I/O多路複用, 網線都只有一根好伐。**多個Sock複用一根網線這個功能是在內核 +驅動層實現的.**

**重要的事情再說一遍: I/O multiplexing 這裡面的 multiplexing 指的其實是在單個線程通過記
錄跟蹤每一個Sock(I/O流)的狀態(對應空管塔裡面的Fight progress strip槽)來同時管理多個I/O
流.** 發明它的原因,是儘量多的提高服務器的吞吐能力。

是不是聽起來好拗口,看個圖就懂了.

![](/multiplexIO/2.png)

在同一個線程裡面, 通過撥開關的方式,來同時傳輸多個I/O流, (學過EE的人現在可以站出來義正
嚴辭說這個叫“時分複用”了)。

什麼,你還沒有搞懂 “一個請求到來了,nginx使用epoll接收請求的過程是怎樣的”, 多看看這個
圖就瞭解了。提醒下,ngnix會有很多鏈接進來, epoll會把他們都監視起來,然後像撥開關一樣,
誰有數據就撥向誰,然後調用相應的代碼處理。

---

瞭解這個基本的概念以後,其他的就很好解釋了。

**select, poll, epoll 都是I/O多路複用的具體的實現,之所以有這三個鬼存在,其實是他們出現是有
先後順序的。**

I/O多路複用這個概念被提出來以後, select是第一個實現 (1983 左右在BSD裡面實現的)。

select 被實現以後,很快就暴露出了很多問題。

- select 會修改傳入的參數數組,這個對於一個需要調用很多次的函數,是非常不友好的。
- select 如果任何一個sock(I/O stream)出現了數據,select 僅僅會返回,但是並不會告訴你是那
  個sock上有數據,於是你只能自己一個一個的找,10幾個sock可能還好,要是幾萬的sock每次
- select 不是線程安全的,如果你把一個sock加入到select, 然後突然另外一個線程發現,尼瑪,這
  個sock不用,要收回。對不起,這個select 不支持的,如果你喪心病狂的竟然關掉這個sock,
  select的標準行為是。。呃。。不可預測的, 這個可是寫在文檔中的哦.

> “If a file descriptor being monitored by select() is closed in another thread, the result is
> unspecified.”

於是14年以後(1997年)一幫人又實現了poll, poll 修復了select的很多問題,比如:

- poll 去掉了1024個鏈接的限制,於是要多少鏈接呢, 主人你開心就好。
- poll 從設計上來說,不再修改傳入數組,不過這個要看你的平臺了,所以行走江湖,還是小心為
  妙.

**其實拖14年那麼久也不是效率問題, 而是那個時代的硬件實在太弱,一臺服務器處理1千多個鏈接
簡直就是神一樣的存在了,select很長段時間已經滿足需求。**

---

於是5年以後, 在2002, 大神 Davide Libenzi 實現了epoll.

epoll 可以說是I/O 多路複用最新的一個實現,epoll 修復了poll 和select絕大部分問題, 比如:

- epoll 現在是線程安全的。
- epoll 現在不僅告訴你sock組裡面數據,還會告訴你具體哪個sock有數據,你不用自己去找了。

可是epoll 有個致命的缺點。。只有linux支持。比如BSD上面對應的實現是kqueue。

其實有些國內知名廠商把epoll從安卓裡面裁掉這種腦殘的事情我會主動告訴你嘛。什麼,你說沒人
用安卓做服務器,尼瑪你是看不起p2p軟件了啦。

而ngnix 的設計原則裡面, 它會使用目標平臺上面最高效的I/O多路複用模型咯,所以才會有這個
設置。一般情況下,如果可能的話,儘量都用epoll/kqueue吧。
