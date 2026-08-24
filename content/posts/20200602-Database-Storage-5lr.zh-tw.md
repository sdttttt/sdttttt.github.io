---
title: "Database Storage"
date: 2020-06-02
description: "總結 CMU 數據庫課程存儲章節內容,對比元組存儲與分槽頁兩種頁內組織方式,講解頭部、槽位數組、元組數組三部分的佈局,以及按槽位管理數據帶來的維護成本、空間碎片處理機制與按頁加槽位索引的查找示例。"
author: sdttttt
draft: false
cover:
  image: "images/covers/20200602-Database-Storage-5lr.svg"
  alt: ""
  hidden: false
aliases: ["/posts/20200602013uup/"]
language: "zh-tw"
---

**CMU Database System 15-445/645** 儲存 Part 1

數據庫存儲的數據在 FS(File System) 中是以 **塊(Block)** 的方式表示的.

實際上你很可能已經見到過了,在MySQL中的數據庫就是以一切Block文件的方式存儲的.

這篇文章會告訴你目前常見的數據庫存儲方式.

---

最開始用**Tuple Storage**來嘗試改善數據庫的存儲結構.

![](https://imgkr.cn-bj.ufileos.com/0029ea52-6d5b-4989-a8e0-a7dec2e0d49c.png)

它的工作原理比較簡單, 每一個**Page**維護一個**Header**,
Header中會包含一些Page的元數據,以及被存儲數據的偏移值.

每當插入一個Tuple,我們就會Update Header中的偏移值.

這個設計中存在比較大的問題, 如果我們刪除了底下Tuple,就不得不移動所有Tuple.
如果不移動數據, 那我們也要花費高昂的代價去維護Header中Page的meta數據.

---

目前最常見的就是**Slotted Pages**的方式去存儲數據.
在不同數據庫中的實現細節可能不同,但是從高級層面來講,大多數數據庫系統,
用的都是這種方式去存儲數據.

![](https://imgkr.cn-bj.ufileos.com/a47909a8-e0e6-48ea-a0b7-e3e327d7fdf2.png)

每個Page中有三個部分:

- **Header**: 保存最基本的matedata, 還包含一些checksum和訪問時間之類的.
- **SlotArray**: 將每一個特定的Slot映射到對應Tuple的偏移值上.
- **TupleArray**: 儲存每一個Tuple.

在這個結構中Header後面緊接這SoltArray, 而Tuple是從Page的尾部開始存儲的.
每個Page存儲的Tuple的個數是固定的.

如果Tuple被刪除,我們也只需要刪除固定的Solt就行.
空出來的空間碎片,可以由數據庫的空間整理功能去完成.
維護每個Tuple的成本也比較小.只需要改變Solt就可以.

---

最後講一個Demo來演示數據庫的工作過程.

假如我想要找一個叫A的人,我會先去查找索引.
從索引裡我知道A的Page是123, Solt是2.
我去找管理Pages的人,讓他把Page123的指針給我,
然後拿著Page的指針,找到Solt2中的偏移地址,找到了A這個人.
