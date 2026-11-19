# 海边

我的个人博客，基于 [Hugo](https://gohugo.io/)，主题是 `self`（fork 自 [hugo-paper](https://github.com/nanxiaobei/hugo-paper)，已合并为仓库内独立主题、不再跟随上游同步）。正文默认简体中文。

线上：<https://sdttttt.online/>

## 本地预览

```bash
hugo server -D      # 含草稿
hugo --minify       # 生产构建到 public/
```

## 写文章

在 `content/posts/` 新建 `YYYY-MM-DD.md`（`title` / `date` / `description` 必填），推送 `master` 即自动校验、格式化并部署。文件名只有日期（同一天多篇会自动加 `-2`、`-3` 后缀）；改了 front matter 的日期后跑 `bun run rename-posts` 就地改名并把旧 URL 写进 `aliases`；装了 hook 后提交时自动做这件事。

## 常用命令

本地需要 Bun 1.4+（https://bun.sh；脚本靠 Bun 原生跑 TypeScript，不用编译）。

```bash
./bin/preflight.sh                # 只读：跑一遍 CI 会做的全部检查（推荐 push 前）
./bin/install-hooks.sh            # 装 pre-commit / pre-push hook（提交时自动规范化）

bun install                      # 装根依赖（prettier + vitest）
bun run test                     # 跑测试（vitest）
bun run typecheck                # 类型检查（tsc --noEmit）
bun run validate-posts           # 校验 front matter
bun run rename-posts-dry         # 预览文章改名
bun run format-markdown-check    # 检查 Markdown 格式
```

`.github/workflows/` 只是壳，CI 实际跑的是 `bin/*.sh` —— 本地同一个脚本能跑出一样的结果，细节见 [`bin/`](bin/)。

主题同步、WASM 粒子引擎、图片流水线、部署流程等细节都写在 [`AGENTS.md`](AGENTS.md) 里，README 就不重复了。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
