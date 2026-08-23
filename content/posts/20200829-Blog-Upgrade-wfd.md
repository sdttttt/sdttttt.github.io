---
title: "Blog Upgrade"
date: 2020-08-29
description: "记录博客主题更换与自动部署流程改造的过程,包括取消双仓库部署策略并在部署任务中采用异步执行,生成与部署速度相比原先提升约 40%,但托管平台国内访问速度依旧较慢的使用体验与后续优化方向。"
tags: ["学习"]
author: sdttttt
draft: false
cover:
  image: "images/covers/20200829-Blog-Upgrade-wfd.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020082906elcw/"]
---

这几天修改了这个Blog的主题, 加载速度应该是更快了, 而且优化了整个项目的自动部署. 取消了双仓库的部署策略, 在部署任务的执行上也用上了异步.

现在每次修改完成后的生成以及部署的速度比以前快了大概40%左右.但是访问**Github Page**的速度还是一如既往的的满.
