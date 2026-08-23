---
title: "Github Actions"
date: 2020-03-11
description: "介紹通過 Github Actions 在打 tag 時自動打包並上傳項目 Releases 資產的工作流配置示例。"
cover:
  image: "images/covers/20200311-Github-Actions-1b19.svg"
  alt: ""
  hidden: false
aliases: ["/posts/2020031100oh3i/"]
language: "zh-tw"
---

## Github Actions 上傳 Releases

```yaml
name: release

# https://help.github.com/en/articles/workflow-syntax-for-github-actions#on
on:
  push:
    tags:
      - "*"

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v1
      - name: "find env"
        run: |
          set | grep GITHUB_ | grep -v GITHUB_TOKEN
          zip -r pkg.zip *.md
      - uses: xresloader/upload-to-github-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          file: "*.md;*.zip"
          tags: true
          draft: false
          prerelease: true
          overwrite: true
          verbose: true
```
