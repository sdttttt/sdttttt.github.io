# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 项目概述

基于 Hugo 的个人博客，使用 PaperMod 主题，通过 GitHub Actions 自动部署到 GitHub Pages。

站点：https://sdttttt.online/ | 仓库：sdttttt/sdttttt.github.io

---

## 常用命令

```bash
# 本地开发（预览网站，包含草稿）
hugo server -D

# 构建生产版本
hugo --minify

# 更新 PaperMod 主题（子模块）
git submodule update --remote themes/PaperMod

# 创建新文章
hugo new posts/文章标题.md
```

---

## 项目架构

```
├── content/              # Markdown 内容
│   ├── posts/            # 博客文章
│   └── claudelog/        # AI 维护日志（见下方）
├── layouts/              # 自定义布局模板
├── static/               # 静态资源（图片、favicon 等）
├── themes/PaperMod/      # PaperMod 主题（git submodule）
├── .github/workflows/    # CI/CD
│   ├── deploy.yml        # push 到 master → 构建并部署
│   └── format-markdown.yml # Markdown 自动格式化
└── hugo.toml             # Hugo 配置文件
```

**关键点**：

- PaperMod 主题是子模块，首次克隆需 `git clone --recursive`
- 文章自动部署：推送到 master 分支即可触发 CI/CD
- 维护日志目录：`content/maintenance/`

---

## 操作需确认

以下操作需先询问用户：

- 破坏性：删除文件/分支、`rm -rf`、`git reset --hard`
- 难以撤销：`git push --force`、修改已发布提交
- 对外可见：推送代码、创建 PR/issue
- 绕过检查：带 `--no-verify` 的命令

---

## AI 维护日志

**每次修改项目后**，在 `content/claudelog/` 中创建或更新当日日志：

```markdown
---
title: "YYYY-MM-DD"
date: YYYY-MM-DD
tags: ["维护记录"]
---

## 维护记录

### 完成的工作

- 任务描述 ✅

### 遇到的问题

- 问题描述 ⚠️ - 解决方案

### 下次建议

- 改进建议
```

规则：

- 文件名格式：`YYYY-MM-DD.md`
- 已存在则追加，不存在则创建
- 适用范围：仅 AI 操作，不包括用户自己的修改

---

## 任务执行规范

- 复杂任务前：先提供分步计划
- 完成后：提供工作摘要
- 临时文件：任务结束时清理

---

## Markdown 格式

项目配置了自动格式化（`.github/workflows/format-markdown.yml`），push `.md` 文件时会自动格式化。
