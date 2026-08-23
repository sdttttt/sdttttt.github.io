---
title: "About Gcr"
date: 2020-04-06
description: "介紹作者用 Rust 編寫的 Git 提交信息規範化命令行工具 GCR 的設計初衷與 Node.js 平臺同類工具的差異。"
cover:
  image: "images/covers/20200406-About-Gcr-gl8.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020040600mqb0/"]
language: "zh-tw"
---

十多天前, 我創建了 GCR 這個項目, 原因比較純粹,
我是個命令行工具愛好者, 我認為命令行能帶來更好的工作效率以及收益,
我平時編碼, 也是遵守 Git 提交規範的,
使用`Node.js`平臺上的`git-cz`工具來格式化我的提交信息,
不過由於它屬於`Node.js`這個平臺, 不可避免, 你需要安裝 Node.js 的 runtime 環境.

我想要一種更加方面快速的工具, 所以我建立了 GCR 這個項目,
它是使用`Rust`編寫的, 不需要安裝任何環境, 比起 Node, 它會更快, 而且保留了跨平臺的特性.
在 GCR 中我還會加入一些比較個性化的元素. GCR 看起來可能會是一個更好用的`Git?`.

這個項目可能還需要幾個星期的時間, 請期待吧.
