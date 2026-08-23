---
title: "About the Blog"
date: 2020-04-03
description: "說明本博客的內容來源、所用 Hugo 靜態站點生成器、PaperMod 主題以及 utteranc 評論系統的選型理由。"
cover:
  image: "images/covers/20200403-About-the-Blog-1ax5.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020040304fphd/"]
language: "zh-tw"
---

`blog`裡的文章並非全部原創，有一部分是經過修改後整理出`要點`，集中一起寫到這裡面。也包涵了一些我對整個軟件行業的想法。

---

這個`blog`是用`Hugo`構建的，Theme 使用的是`rocinante`,live2D 的紙片人是我自己加的.(不是主題裡自帶的).

我之前還使用過`Vuepress`做為靜態網站生成器，不過自定義程度很低，也不是很複合我的審美。（我希望是旁邊不要出現目錄欄）

後面我就轉戰`Hugo`,優點：用 Go 編寫，生成快。生態圈也比較良好。我第一個使用的 Theme 是`book`，不得不說，配置複雜，我就馬上丟棄了，後面又使用了`Ezhi`，由於我不是很喜歡紅色，就又扔了。

然後就使用了現在這個 Theme，還是比較滿意的，很極簡。後面也加了`utteranc`做為評論模塊，選擇 utteranc 的理由很簡單，最初`Hugo`是自帶`Disqus`做為評論模塊的，但是無奈這個`Disqus`在國外，而且還是被牆的！

後來暫時擱了一段時間，才找到`utteranc`，優點就是結合`Github issues`無需翻牆，使用的 UI 也是 Github 的（Github 使用的 UI 是 Bootstrap 庫），而且零配置，授權一下 App，改一下 JS 的 tag 馬上就可以用。
