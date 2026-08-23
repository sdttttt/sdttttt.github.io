---
title: Rails ENV
date: 2020-04-06
description: "記錄在 Windows 10 和 Ubuntu 上搭建 Ruby on Rails 開發環境的步驟、踩過的坑,以及 Bootstrap 集成與 RVM 依賴問題的解決方法。"
tags: ["學習"]
cover:
  image: "images/covers/20200406-Rails-ENV-g3n.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020040605xg0j/"]
language: "zh-tw"
---

# Rails ENV

環境配置參考 Ruby China 社區的 Wiki

### Windows 10

在 Windowns 10 的環境下和Linux上差不多，不過不需要RVM

- 首先在Ruby官方網站下載好安裝包
- 之後使用RubyChina提供的Source替換Gem的Source
- 之後使用Gem下載 Bundler 和 Rails
- 創建Rails項目運行即可

有一個軟件叫做 <code>RailsInstaller</code> 可以直接幫你省下1和3步也就是直接幫你安裝好了Ruby和Rails還有Gem，bundler。
但是🙅我目前使用的Railsinstaller有點問題。他的Ruby版本是2.3，rails版本是5，rails5依賴的是 >= 2.4版本的ruby，這就有問題了。我也沒接著用這個軟件了。

在rails6中加入了<code>Webpacker</code>的打包工具，運行之前需要先安裝webpacker不然會報錯。 <code>$ rails webpacker:install</code>

注意在上面可能會有點問題，Gem創建Rails項目的時候會下載各種依賴，這些依賴有可能會在Windows的環境上出現問題，比如我遇到的 SQLite3,所以Ruby最好還是不要在Windowns上運行。

還有Rails 是要依賴 Yarn和 nodejs 最好是10版本以上

## Development Note

花了很長時間去吧Rails和一些大前端的框架合二為一，最後以失敗而告終。
Rails終究是個全棧式的Web框架，老老實實用簡單的就行。

- Bootstrap Configuration

```ruby
# => 首先在 Gemfile 中加入
gem 'bootstrap', '~> 4.3.1'
gem 'jquery-rails'
```

之後將<code>app\assets\stylesheets\application.css</code> 改為 scss

刪掉所有的東西包括註釋

加入<code>@import "bootstrap";</code>

---

## Ruby Note Todo

```
Error running 'requirements_debian_libs_install g++ gcc autoconf automake bison libc6-dev libffi-dev libgdbm-dev libncurses5-dev libsqlite3-dev libtool libyaml-dev make pkg-config sqlite3 zlib1g-dev libgmp-dev libreadline-dev libssl-dev',
please read /home/sdttttt/.rvm/log/1573869340/package_install_g++_gcc_autoconf_automake_bison_libc6-dev_libffi-dev_libgdbm-dev_libncurses5-dev_libsqlite3-dev_libtool_libyaml-dev_make_pkg-config_sqlite3_zlib1g-dev_libgmp-dev_libreadline-dev_libssl-dev.log
Requirements installation failed with status: 100.
```

碰到這種錯誤不需要緊張，<code>rvm requirements</code> command 的原理就是會使用你係統的包管理工具去下載這些依賴，所以原因很簡單，你的源裡找不到這些依賴就會報出100的錯誤。
是Ubuntu的話下面我提供了源

```
#添加阿里源
deb http://mirrors.aliyun.com/ubuntu/ bionic main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ bionic-security main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ bionic-updates main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ bionic-proposed main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ bionic-backports main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ bionic main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ bionic-security main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ bionic-updates main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ bionic-proposed main restricted universe multiverse
deb-src http://mirrors.aliyun.com/ubuntu/ bionic-backports main restricted universe multiverse
```
