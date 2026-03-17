---
title: Rails Development
tags: ["Rails"]
---

### Webpacker

Rails 6 版本开始依赖 Webpacker，在运行之前必须先安装 Webpacker 这玩意。

```sh
rails webpacker:install
```

如果需要安装前端框架，请使用 yarn 来安装，这样部署的时候能享受到 webpacker 打包便利。

### production

Rails 6 启动时需要一串 Key 作为加密的 salt，key 不能随意生成。
生成 key 时，请删除 config 下的 credentials.enc.yml 和 master.key 文件。
然后运行

```sh
rails credentials:edit
```

然后 Rails 访问静态资源，需要使用 webpacker 打包编译后的资产。
运行

```sh
rails assets:precompile
```

Rails 6 在生产环境下认为你使用 Apache 和 Nginx 缓存编译后的静态资产。如果你不使用他们，需要

```ruby
# config/environments/production.rb
config.public_file_server.enabled = true
```

记住，打包之后的 js 以及 css 统一叫 application.js/css 在 view 页面引用时需要引用 application 这个名字。其他的会报错
