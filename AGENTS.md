# 仓库贡献指南（Repository Guidelines）

基于 Hugo 的个人博客仓库（`sdttttt/sdttttt.github.io`），使用 PaperMod 主题，默认正文语言为简体中文。脚本与测试运行在 **Deno** 上（不是 Node.js）。站点：<https://sdttttt.online/>。

## 项目结构

- `content/posts/` — 博客文章（Markdown + front matter）。
- `content/claudelog/` — Agent 维护日志（每天一个 `YYYY-MM-DD.md`）。
- `layouts/` — PaperMod 之上自定义的模板覆盖。
- `static/` — 原样拷贝的静态资源；封面图位于 `static/images/covers/`。
- `themes/PaperMod/` — Git 子模块，不要在此目录内做常规改动。
- `scripts/` — Deno + TypeScript 维护脚本：根目录 `*.ts` 为入口，`lib/` 放共用工具（args / frontmatter / git），`__tests__/` 放测试。
- `hugo.toml` — Hugo 配置；`deno.json` — Deno 任务与 import map。

首次克隆需要子模块：`git clone --recursive`。更新主题：`git submodule update --remote themes/PaperMod`。推送到 `master` 分支即触发 GitHub Actions 自动部署。

## 构建、测试与开发命令

```bash
hugo server -D                    # 本地预览（含草稿）
hugo --minify                     # 生产构建到 public/

deno task test                    # 跑 scripts/__tests__/ 下全部测试
deno task validate-posts          # 校验 front matter / 封面
deno task sync-covers-dry         # 预览孤儿封面清理
deno task rename-posts-dry        # 预览文章改名
deno task format-markdown-check   # 检查 Markdown 格式（不写入）
deno task format-markdown         # 写入式格式化（CI 推送后自动跑）
```

## 编码与命名规范

- TypeScript 脚本使用 2 空格缩进；依赖 Deno 任务运行，无 `tsc`、无 `node_modules`；`node:` 内置 API 和 `npm:sharp@0.33.5` 可直接使用。
- Markdown 由全局安装的 Prettier 3 格式化（`deno install -g -A npm:prettier@3.9.6`），仓库无本地 Prettier 配置，沿用默认；`deploy.yml` 推送后会自动调用 `deno task format-markdown`。
- 文章文件名：`YYYYMMDD-标题-xxxx.md`（末尾 4 位 hash 短码），例如 `20260817-文章的变化-dqo.md`。
- Front matter 必填：`title`、`date`、`description`；封面用 `cover.image: "images/covers/..."`。

## 测试指南

- 框架：Deno 内置 `Deno.test`，测试位于 `scripts/__tests__/*.test.ts`。
- 断言风格参考 `node:test`；共享工具在 `expect.ts` / `temp-dir.ts`。
- 新脚本须配套 `*.test.ts`；CI 通过 `.github/workflows/test-scripts.yml` 自动跑。

## 提交与 PR 规范

- 提交信息遵循 Conventional Commits，可选作用域：`chore(rename):`、`feat(seo):`、`ci(deploy):`、`chore(format):`、`chore(taxonomies):` 等。
- PR 目标分支为 `master`，描述需写清改动范围、关联任务，以及对 front matter / 封面 / 工作流的潜在影响。
- 推送前跑一遍 `deno task format-markdown-check` 与 `deno task validate-posts`；不要提交 `public/` 或临时文件。

## 操作需确认

以下动作必须先与用户确认：

- **破坏性**：删除文件 / 分支、`rm -rf`、`git reset --hard`。
- **难以撤销**：`git push --force`、修改已发布提交。
- **对外可见**：推送代码、创建 PR / issue。
- **绕过检查**：带 `--no-verify` 的命令。

具有副作用的脚本（`rename-posts`、`sync-covers` 等）务必先用 `*-dry` 任务预览。

## Agent 任务执行规范

- 复杂任务：先给出分步计划再动手。
- 完成后：输出一段工作摘要（做了什么、遇到的问题、遗留事项）。
- 临时文件：任务结束时清理。

## Agent 维护日志

每次对仓库做出修改后，在 `content/claudelog/` 中创建或追加当天的 `YYYY-MM-DD.md`。模板：

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

已存在则追加，不存在则新建；范围仅限 Agent 自动改动，不包括用户手动编辑。
