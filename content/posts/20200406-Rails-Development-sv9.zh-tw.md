---
title: Rails Development
date: 2020-04-06
description: "彙總 Rails 6 開發中的 Webpacker 安裝、生產環境 master.key 生成、資產預編譯以及靜態文件託管等常用配置。"
tags: ["學習"]
cover:
  image: "images/covers/20200406-Rails-Development-sv9.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020040605padm/"]
language: "zh-tw"
---

### Webpacker

Rails 6 版本開始依賴 Webpacker，在運行之前必須先安裝 Webpacker 這玩意。

```sh
rails webpacker:install
```

如果需要安裝前端框架，請使用 yarn 來安裝，這樣部署的時候能享受到 webpacker 打包便利。

### production

Rails 6 啟動時需要一串 Key 作為加密的 salt，key 不能隨意生成。
生成 key 時，請刪除 config 下的 credentials.enc.yml 和 master.key 文件。
然後運行

```sh
rails credentials:edit
```

然後 Rails 訪問靜態資源，需要使用 webpacker 打包編譯後的資產。
運行

```sh
rails assets:precompile
```

Rails 6 在生產環境下認為你使用 Apache 和 Nginx 緩存編譯後的靜態資產。如果你不使用他們，需要

```ruby
# config/environments/production.rb
config.public_file_server.enabled = true
```

記住，打包之後的 js 以及 css 統一叫 application.js/css 在 view 頁面引用時需要引用 application 這個名字。其他的會報錯
