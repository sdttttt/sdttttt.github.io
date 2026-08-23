---
title: Azure Pipelines
date: 2020-04-06
description: "簡介 Azure Pipelines 的免費額度與使用步驟,並給出一個針對 Ruby on Rails 項目的 azure-pipelines.yml 配置示例。"
tags: ["學習"]
cover:
  image: "images/covers/20200406-Azure-Pipelines-mpp.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020040604hir4/"]
language: "zh-tw"
---

Azure Pipelines是一種雲服務，可用於自動構建和測試您的代碼項目並將其提供給其他用戶。它幾乎適用於任何語言或項目類型。

Azure Pipelines將持續集成（CI）和持續交付（CD）相結合，以持續不斷地測試和構建您的代碼並將其交付給任何目標。

Azure Pipelines 支持非常多的語言。

#### Price

如果使用公共項目，則Azure Pipelines是免費的。如果您使用私人項目，則每月可以免費運行多達1800分鐘（30小時）的管道作業。瞭解有關基於並行作業定價的更多信息。

是不是非常的棒呢 o(_////▽////_)q

**請遵循以下基本步驟：**

- 配置Azure Pipelines以使用您的Git存儲庫。
- 編輯azure-pipelines.yml文件以定義構建。
- 將您的代碼推送到版本控制存儲庫。此操作將啟動默認觸發器以構建和部署，然後監視結果。

## Ruby

```yaml
# Ruby
# Package your Ruby project.
# Add steps that install rails, analyze code, save build artifacts, deploy, and more:
# https://docs.microsoft.com/azure/devops/pipelines/languages/ruby

trigger:
  branches:
    # 只有以下分支提交才會觸發CICD
    include:
      - master
      - sdtttttt
      - CICD
      - depend*
  paths:
    # 只有以下文件提交時不觸發CICD
    exclude:
      - README.md
      - appveyor.yml

pool:
  vmImage: "ubuntu-18.04"

steps:
  - task: UseRubyVersion@0
    inputs:
      # 天殺的，微軟提供的Ubuntu 鏡像已經不支持 Ruby2.6.3
      versionSpec: ">= 2.6.3"

  # Rails 內置數據庫 SQLite3 需要依賴以下工具
  - script: sudo apt-get -yqq install libsqlite3-dev libpq-dev
    displayName: install sqlite3

  - script: |
      gem install bundler
      bundle install --retry=3 --jobs=4
    displayName: "bundle install"

  - script: bundle exec rake
    displayName: "bundle exec rake"
```
