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

# 脚本工作流基于 Deno：跑测试
deno task test

# 跑单个脚本（dry-run）
deno task validate-posts
deno task sync-covers-dry
deno task rename-posts-dry
deno task git-commit-push-dry

# 格式化 / 检查 Markdown（依赖全局 prettier）
deno task format-markdown
deno task format-markdown-check
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
├── scripts/              # 维护脚本（Deno + TypeScript）
│   ├── *.ts              # 入口脚本（validate-posts / rename-posts / ...）
│   ├── lib/              # 共用工具（args / frontmatter / git）
│   └── __tests__/        # node:test 测试
├── .github/workflows/    # CI/CD
│   ├── deploy.yml        # push 到 master → 构建并部署
│   ├── validate-posts.yml # 校验 front matter / 封面
│   ├── sync-covers.yml   # 每周清理孤儿封面
│   ├── check-dead-links.yml # 每周检查外链
│   └── test-scripts.yml  # 跑脚本测试
├── deno.json             # Deno 配置（tasks / imports / unstable flags）
└── hugo.toml             # Hugo 配置文件
```

**关键点**：

- PaperMod 主题是子模块，首次克隆需 `git clone --recursive`
- 文章自动部署：推送到 master 分支即可触发 CI/CD
- 维护日志目录：`content/claudelog/`
- **脚本运行时是 Deno，不是 Node.js**：`deno task test` 跑测试；`deno run -A scripts/xxx.ts` 跑单脚本。所有 `node:` 内置 API + `npm:sharp` 都直接可用，无需 `tsc` 编译或 `node_modules`
- prettier 通过 `deno install -g -A npm:prettier@3.9.6` 安装到 `~/.deno/bin/`（`denoland/setup-deno@v2` 已将该目录加入 PATH），无需 setup-node

---

## 操作需确认

以下操作需先询问用户：

- 破坏性：删除文件/分支、`rm -rf`、`git reset --hard`
- 难以撤销：`git push --force`、修改已发布提交
- 对外可见：推送代码、创建 PR/issue
- 绕过检查：带 `--no-verify` 的命令

---

## CLAUDE 维护日志

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

`deploy.yml` 在推送后会自动调用 `deno task format-markdown`（基于全局 prettier）格式化所有 `.md` 文件。`deno task format-markdown-check` 用于本地只检查不写入。
