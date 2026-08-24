---
title: "Unix平臺和Windows的文件分享問題"
date: 2023-12-09
description: "比較 NFS 與 SMB 在 Linux、Windows 和 Unix 文件共享中的配置、速度、協議、兼容性與安全性特點，並記錄實際使用問題。"
tags: ["思考"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20231209-Unix平臺和Windows的文件分享問題-mh2.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2023120904fth1/"]
language: "zh-tw"
---

前幾天重新把家裡的板子重裝了系統，這次打算不使用雲盤之類的軟件來保存文件了，就用簡單的samba之類系統級的文件分享。

samba每次保存大量的漫畫說實話速度有點慢。所以這次我想用NFS試試。看很多文章分析NFS處理小文件的速度極快。

Linux上配置NFS比samba還要快，雖然samba的配置我覺得已經夠快了。

```jsx
$ sudo apt install nfs-common
$ sudo vim /etc/exports

# /etc/exports: the access control list for filesystems which may be exported
#               to NFS clients.  See exports(5).
#
# Example for NFSv2 and NFSv3:
# /srv/homes       hostname1(rw,sync,no_subtree_check) hostname2(ro,sync,no_subtree_check)
#
# Example for NFSv4:
# /srv/nfs4        gss/krb5i(rw,sync,fsid=0,crossmnt,no_subtree_check)
# /srv/nfs4/homes  gss/krb5i(rw,sync,no_subtree_check)
#

/home/t1 *(rw,async,no_subtree_check,no_root_squash,fsid=0)
<分享的目錄> <*代表都能訪問，也可以寫網段限制> <(一些功能和權限)>

$ service nfs-server start
```

就三步Linux就配置好了可以了…

下面是windows：

```jsx
# mount [NFS服務器]:/[路徑] [本地驅動器字母]:
mount 192.168.1.1:/home/t1 N:
```

就這麼簡單。

不過我昨天第一次傳文件的時候出現了一些問題。

- nfsd RPC fragment too large

我在網上查了1個多小時，答案是無解，這個好像是系統本身導致的。

但是不知道為什麼，今天重新配置了一遍居然好了？

計算機…很奇妙吧…

---

用了幾天很難說NFS真的比SMB快，可能我的機器有性能瓶頸吧。

從原理上來說NFS應該是比SMB要快的，因為NFS對linux來說是一個文件系統，也就是內核的一部分。全程都是運行在內核模式中的。

這兩天也順便查了一下這兩個文件分享協議的特點：

NFS是SUN公司為了Unix系統打造的協議，比較特殊的點是這個協議使用的是RPC通訊，是一個抽象文件系統，可以很好的兼容現有的本地文件系統。

但是NFS缺點也存在，就是安全性比較差，這個協議最初設計出來的時候沒有考慮過這方面的功能。

SMB最初設計出來也是解決了FTP的問題，後來微軟介入開始發展SMB，後續也就成了Windows平臺的標準協議。

後續微軟也提供了開源版本的SMB，名字叫做CIFS（Common Internet File System），Unix這邊叫做Samba

兩個協議難說誰優誰劣，百科下面有個簡單的CIFS和NFS的對比：

（1）CIFS面向[網絡連接](https://baike.baidu.com/item/%E7%BD%91%E7%BB%9C%E8%BF%9E%E6%8E%A5/5658236?fromModule=lemma_inlink)的共享協議，對[網絡傳輸](https://baike.baidu.com/item/%E7%BD%91%E7%BB%9C%E4%BC%A0%E8%BE%93/1873698?fromModule=lemma_inlink)的可靠性要求高，常使用[TCP](https://baike.baidu.com/item/TCP/33012?fromModule=lemma_inlink)/IP；NFS是獨立於傳輸的，可使用TCP或[UDP](https://baike.baidu.com/item/UDP/571511?fromModule=lemma_inlink)；

（2）NFS缺點之一，是要求client必須安裝[專用軟件](https://baike.baidu.com/item/%E4%B8%93%E7%94%A8%E8%BD%AF%E4%BB%B6/6035829?fromModule=lemma_inlink)；而CIFS集成在[OS](https://baike.baidu.com/item/OS/688?fromModule=lemma_inlink) 內部，無需額外添加軟件；

（3）NFS屬[無狀態協議](https://baike.baidu.com/item/%E6%97%A0%E7%8A%B6%E6%80%81%E5%8D%8F%E8%AE%AE/2607781?fromModule=lemma_inlink)，而CIFS屬有狀態協議；NFS受[故障影響](https://baike.baidu.com/item/%E6%95%85%E9%9A%9C%E5%BD%B1%E5%93%8D/5316102?fromModule=lemma_inlink)小，可以自恢復交互過程，CIFS不行；從[傳輸效率](https://baike.baidu.com/item/%E4%BC%A0%E8%BE%93%E6%95%88%E7%8E%87/7856651?fromModule=lemma_inlink)上看，CIFS優於NFS，沒用太多[冗餘信息](https://baike.baidu.com/item/%E5%86%97%E4%BD%99%E4%BF%A1%E6%81%AF/3833637?fromModule=lemma_inlink)傳送；

（4）兩協議都需要文件[格式轉換](https://baike.baidu.com/item/%E6%A0%BC%E5%BC%8F%E8%BD%AC%E6%8D%A2/55388491?fromModule=lemma_inlink)，NFS保留了[unix](https://baike.baidu.com/item/unix/219943?fromModule=lemma_inlink)的[文件格式](https://baike.baidu.com/item/%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F/6156907?fromModule=lemma_inlink)特性，如所有人、組等等；CIFS則完全按照win的風格來作。
