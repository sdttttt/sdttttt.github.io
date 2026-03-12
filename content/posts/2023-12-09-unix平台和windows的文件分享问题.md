---
title: "Unix平台和Windows的文件分享问题"
date: 2023-12-09
tags: ["思考"]
categories: ["学习思考"]
author: sdttttt
draft: false
---

前几天重新把家里的板子重装了系统，这次打算不使用云盘之类的软件来保存文件了，就用简单的samba之类系统级的文件分享。

samba每次保存大量的漫画说实话速度有点慢。所以这次我想用NFS试试。看很多文章分析NFS处理小文件的速度极快。

Linux上配置NFS比samba还要快，虽然samba的配置我觉得已经够快了。

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
<分享的目录> <*代表都能访问，也可以写网段限制> <(一些功能和权限)>  

$ service nfs-server start
```

就三步Linux就配置好了可以了…

下面是windows：

```jsx
# mount [NFS服务器]:/[路径] [本地驱动器字母]:
mount 192.168.1.1:/home/t1 N:
```

就这么简单。

不过我昨天第一次传文件的时候出现了一些问题。

- nfsd RPC fragment too large

我在网上查了1个多小时，答案是无解，这个好像是系统本身导致的。

但是不知道为什么，今天重新配置了一遍居然好了？

计算机…很奇妙吧…

---

用了几天很难说NFS真的比SMB快，可能我的机器有性能瓶颈吧。

从原理上来说NFS应该是比SMB要快的，因为NFS对linux来说是一个文件系统，也就是内核的一部分。全程都是运行在内核模式中的。

这两天也顺便查了一下这两个文件分享协议的特点：

NFS是SUN公司为了Unix系统打造的协议，比较特殊的点是这个协议使用的是RPC通讯，是一个抽象文件系统，可以很好的兼容现有的本地文件系统。

但是NFS缺点也存在，就是安全性比较差，这个协议最初设计出来的时候没有考虑过这方面的功能。

SMB最初设计出来也是解决了FTP的问题，后来微软介入开始发展SMB，后续也就成了Windows平台的标准协议。

后续微软也提供了开源版本的SMB，名字叫做CIFS（Common Internet File System），Unix这边叫做Samba

两个协议难说谁优谁劣，百科下面有个简单的CIFS和NFS的对比：

（1）CIFS面向[网络连接](https://baike.baidu.com/item/%E7%BD%91%E7%BB%9C%E8%BF%9E%E6%8E%A5/5658236?fromModule=lemma_inlink)的共享协议，对[网络传输](https://baike.baidu.com/item/%E7%BD%91%E7%BB%9C%E4%BC%A0%E8%BE%93/1873698?fromModule=lemma_inlink)的可靠性要求高，常使用[TCP](https://baike.baidu.com/item/TCP/33012?fromModule=lemma_inlink)/IP；NFS是独立于传输的，可使用TCP或[UDP](https://baike.baidu.com/item/UDP/571511?fromModule=lemma_inlink)；

（2）NFS缺点之一，是要求client必须安装[专用软件](https://baike.baidu.com/item/%E4%B8%93%E7%94%A8%E8%BD%AF%E4%BB%B6/6035829?fromModule=lemma_inlink)；而CIFS集成在[OS](https://baike.baidu.com/item/OS/688?fromModule=lemma_inlink) 内部，无需额外添加软件；

（3）NFS属[无状态协议](https://baike.baidu.com/item/%E6%97%A0%E7%8A%B6%E6%80%81%E5%8D%8F%E8%AE%AE/2607781?fromModule=lemma_inlink)，而CIFS属有状态协议；NFS受[故障影响](https://baike.baidu.com/item/%E6%95%85%E9%9A%9C%E5%BD%B1%E5%93%8D/5316102?fromModule=lemma_inlink)小，可以自恢复交互过程，CIFS不行；从[传输效率](https://baike.baidu.com/item/%E4%BC%A0%E8%BE%93%E6%95%88%E7%8E%87/7856651?fromModule=lemma_inlink)上看，CIFS优于NFS，没用太多[冗余信息](https://baike.baidu.com/item/%E5%86%97%E4%BD%99%E4%BF%A1%E6%81%AF/3833637?fromModule=lemma_inlink)传送；

（4）两协议都需要文件[格式转换](https://baike.baidu.com/item/%E6%A0%BC%E5%BC%8F%E8%BD%AC%E6%8D%A2/55388491?fromModule=lemma_inlink)，NFS保留了[unix](https://baike.baidu.com/item/unix/219943?fromModule=lemma_inlink)的[文件格式](https://baike.baidu.com/item/%E6%96%87%E4%BB%B6%E6%A0%BC%E5%BC%8F/6156907?fromModule=lemma_inlink)特性，如所有人、组等等；CIFS则完全按照win的风格来作。