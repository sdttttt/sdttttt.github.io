# 仓库贡献指南（Repository Guidelines）

基于 Hugo 的个人博客仓库（`sdttttt/sdttttt.github.io`），使用 **`sdttttt-paper` 子主题**（fork 自 [nanxiaobei/hugo-paper](https://github.com/nanxiaobei/hugo-paper)）。父主题 vendor-in 到 `themes/hugo-paper/`，自定义修改集中在 `themes/sdttttt-paper/`；两者通过 `hugo.toml` 的 `theme = ["sdttttt-paper", "hugo-paper"]` 列表组合，第一个主题的同名文件覆盖第二个。默认正文语言为简体中文。脚本与测试运行在 **Deno** 上（不是 Node.js）。站点：<https://sdttttt.online/>。

## 项目结构

- `content/posts/` — 博客文章（Markdown + front matter）。
- `content/claudelog/` — Agent 维护日志（每天一个 `YYYY-MM-DD.md`）。
- `themes/sdttttt-paper/` — 自定义子主题，与 `themes/hugo-paper/` 组合（`hugo.toml` 里 `theme = ["sdttttt-paper", "hugo-paper"]`，前者优先，同名文件覆盖后者）：
  - `theme.toml` — 主题元数据（无 `[parent]` —— 那是 Hugo Modules 概念，目录式主题列表下不生效）
  - `layouts/_default/baseof.html` — baseof，调用 bg partial
  - `layouts/partials/bg.html` — 左下角装饰徽标：**WASM 粒子渲染**，双击可切回真实 PNG（滚到底部才揭示）
  - `layouts/partials/header.html` — header 覆写，强制默认亮色
  - `layouts/partials/footer.html` — footer，去掉 powered by / hugo-paper 链接
  - `layouts/_default/particles.html` — `/particles/` 粒子演示页（**`draft: true`，不对外发布**，本地用 `hugo server -D` 看）
  - `assets/custom.css` — 自定义 CSS（徽标 + 粒子页样式）
  - `assets/js/` — `pt-wasm.js`（共享 wasm 加载器）/ `page-bg.js`（徽标）/ `particles-wasm.js`（粒子页主引擎）/ `particles.js`（粒子页的纯 Canvas 2D 降级引擎）
  - `assets/wasm/particles.wasm` — 构建产物（提交进仓库，CI 不需要 Rust）

  （上述路径相对于 `themes/sdttttt-paper/`，完整路径如 `themes/sdttttt-paper/layouts/partials/bg.html`。）

- `themes/hugo-paper/` — vendor-in 的父主题（普通目录，不是 submodule），sync 时只动这个目录
- `wasm/particles/` — **Rust 裸导出的 WASM 引擎源码**（采样 + 物理 + 软件光栅化）；改完跑 `deno task build-wasm`（需 `cargo`），产物拷到 `themes/sdttttt-paper/assets/wasm/particles.wasm`
- `assets/src/` — **图片原图**（`bg/*.png` 背景 cutouts、`avatar/avatar.jpg`）；Hugo **不**发布该目录下未被 Pipes 引用的文件，所以原图只占仓库、不占部署体积。改完跑 `deno task optimize-images`，产物写进 `static/`
- `static/` — 原样拷贝的静态资源（apple-touch-icon / favicon / safari）；`static/bg/*.avif` 与 `static/avatar.webp` 是 `optimize-images` 生成的发布图。
- `scripts/` — Deno + TypeScript 维护脚本：根目录 `*.ts` 为入口，`lib/` 放共用工具（args / frontmatter / fs / git），`__tests__/` 放测试。
- `hugo.toml` — Hugo 配置（`theme = ["sdttttt-paper", "hugo-paper"]` 主题列表，顺序即优先级）；`deno.json` — Deno 任务定义（含 `build-wasm`）。

首次克隆不需要 submodule：`git clone`。

主题同步分两部分（互不干扰）：

1. **同步父主题**（`themes/hugo-paper/`）：手动 `git clone --depth 1 https://github.com/nanxiaobei/hugo-paper.git /tmp/hp-clone`，`diff -ru themes/hugo-paper/ /tmp/hp-clone/`，把需要的上游改动 patch 到 `themes/hugo-paper/`。
2. **同步子主题自定义 override**（`themes/sdttttt-paper/`）：每个 override 文件头注释已写明 "When bumping hugo-paper upstream, sync against themes/hugo-paper/.../X and reapply the diff"，按注释指引手动同步。

推送到 `master` 分支即触发 GitHub Actions 自动部署。

## 构建、测试与开发命令

```bash
hugo server -D                    # 本地预览（含草稿）
hugo --minify                     # 生产构建到 public/

deno task test                    # 跑 scripts/__tests__/ 下全部测试
deno task validate-posts          # 校验 front matter
deno task check-dead-links        # 检查外链死链
deno task rename-posts-dry        # 预览文章改名
deno task optimize-images-dry     # 预览图片转换（不写盘、不装 sharp）
deno task optimize-images         # 把 assets/src/ 的原图转成 static/ 的发布图
deno task format-markdown-check   # 检查 Markdown 格式（不写入）
deno task format-markdown         # 写入式格式化（CI 推送后自动跑）
deno task git-commit-push-dry     # 预览自动 commit + push
```

## 编码与命名规范

- TypeScript 脚本使用 2 空格缩进；依赖 Deno 任务运行，无 `tsc`、无 `node_modules`；只用 `node:` 内置 API 与 import map 里显式列出的 npm 包。
- Markdown 由全局安装的 Prettier 3 格式化（`deno install -g -A npm:prettier@3.9.6`），仓库无本地 Prettier 配置，沿用默认；`deploy.yml` 推送后会自动调用 `deno task format-markdown`。
- 文章文件名：`YYYYMMDD-标题-xxxx.md`（末尾 4 位 hash 短码），例如 `20260817-文章的变化-dqo.md`。
- Front matter 必填：`title`、`date`、`description`；无封面字段（cover 系统已删）。
- 背景图 / 头像：**原图放 `assets/src/`，发布图放 `static/`**。背景 cutouts 是 `assets/src/bg/*.png`（PNG 已用 `@imgly/background-removal-node` 预切），跑 `deno task optimize-images` 生成 `static/bg/*.avif`（640px q45，`--format webp` 可切 WebP）；头像是 `assets/src/avatar/avatar.jpg` → `static/avatar.webp`（192px，固定 WebP）。新增/删除图片会在左下角徽标和 `/particles/` 自动生效（两处都靠 `readDir "static/bg"` 发现 `.avif` / `.webp`）。
- **碰过 `assets/src/**` 就必须重跑 `deno task optimize-images` 并提交产物**：CI 不跑图片转换（同 WASM），忘了就发布会陈旧/缺失的图。
- **WASM 引擎**：Rust 裸导出（不用 wasm-bindgen），只导出 C-ABI 函数。改 `wasm/particles/src/lib.rs` 后必须重新 `deno task build-wasm` 并提交 `.wasm`；搜索建议：`WebAssembly` 相关代码都在 `assets/js/pt-wasm.js`（共享加载器）里。
- **降级链**：左下角徽标的渲染路径会写到 `html[data-pt-engine]` 上，排查时先看这个属性：
  `unsupported`（浏览器不支持 WASM，直接显示原图，连 wasm 都不拉）/ `error`（下载·编译·构建失败，回退原图）/ `wasm`（粒子已就绪）/ `png`（未配置或加载器缺失）。`assets/js/pt-wasm.js` 导出 `supported` 做显式能力检测。

## 测试指南

- 框架：Deno 内置 `Deno.test`，测试位于 `scripts/__tests__/*.test.ts`。
- 断言风格参考 `node:test`；共享工具在 `expect.ts` / `temp-dir.ts`。
- 新脚本须配套 `*.test.ts`；CI 通过 `.github/workflows/test-scripts.yml` 自动跑。

## 提交与 PR 规范

- 提交信息遵循 Conventional Commits，可选作用域：`chore(rename):`、`feat(seo):`、`ci(deploy):`、`chore(format):`、`chore(taxonomies):`、`docs(claudelog):` 等。
- PR 目标分支为 `master`，描述需写清改动范围、关联任务，以及对 front matter / 工作流 / override 文件的潜在影响。
- 推送前跑一遍 `deno task test` / `validate-posts` / `format-markdown-check`；不要提交 `public/` 或临时文件。
- **碰过 `wasm/**` 就必须重建**：推送前跑 `deno task build-wasm`，把更新后的 `themes/sdttttt-paper/assets/wasm/particles.wasm` 一起提交。CI **不**构建 WASM（部署流程故意不装 Rust），所以产物完全靠手动同步，忘了就发布会陈旧的引擎。
- **推送前必须先检查远端是否有新提交**：`git fetch origin && git log HEAD..origin/master --oneline`；如果有新提交（例如 CI bot 的 `chore(format): prettier markdown` 格式化了你刚改的 markdown），必须先 rebase / merge 解决冲突再 push，避免推送时与远端历史分叉、需要 `--force` 才能推上去。`--force-with-lease` 仍是 rebase 后的合规选项，但**能避免就避免**。

## 操作需确认

以下动作必须先与用户确认：

- **破坏性**：删除文件 / 分支、`rm -rf`、`git reset --hard`。
- **难以撤销**：`git push --force`、修改已发布提交。
- **对外可见**：推送代码、创建 PR / issue。
- **绕过检查**：带 `--no-verify` 的命令。

具有副作用的脚本（`rename-posts`、`git-commit-push` 等）务必先用 `*-dry` 任务预览。

## Agent 任务执行规范

- 复杂任务：先给出分步计划再动手。
- 适合脚本的任务（多步并行、需要在脚本里过滤 / 聚合 / 截断、根据上一步结果决定下一步）：优先使用 `codemode`（JavaScript 沙箱内 `Promise.allSettled` 并行调用工具），而不是串行调用一个一个工具。
- 完成后：输出一段工作摘要（做了什么、遇到的问题、遗留事项）。
- 临时文件：任务结束时清理。

## 工具偏好

- 会话内文件查找优先 `rg`（ripgrep），其次 `grep` / `find`。
- 不要自动 commit / push / 开 PR —— 这些对外动作前必须先与用户确认。

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
