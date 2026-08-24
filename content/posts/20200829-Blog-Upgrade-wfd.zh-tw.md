---
title: "Blog Upgrade"
date: 2020-08-29
description: "記錄博客主題更換與自動部署流程改造的過程,包括取消雙倉庫部署策略並在部署任務中採用異步執行,生成與部署速度相比原先提升約 40%,但託管平臺國內訪問速度依舊較慢的使用體驗與後續優化方向。"
tags: ["學習"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20200829-Blog-Upgrade-wfd.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020082906elcw/"]
language: "zh-tw"
---

這幾天修改了這個Blog的主題, 加載速度應該是更快了, 而且優化了整個項目的自動部署. 取消了雙倉庫的部署策略, 在部署任務的執行上也用上了異步.

現在每次修改完成後的生成以及部署的速度比以前快了大概40%左右.但是訪問**Github Page**的速度還是一如既往的的滿.
