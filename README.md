# 海边

我的个人博客，基于 [Hugo](https://gohugo.io/)，主题是自定义子主题 `sdttttt-paper`（fork 自 [hugo-paper](https://github.com/nanxiaobei/hugo-paper)）。正文默认简体中文。

线上：<https://sdttttt.online/>

## 本地预览

```bash
hugo server -D      # 含草稿
hugo --minify       # 生产构建到 public/
```

## 写文章

在 `content/posts/` 新建 `YYYYMMDD-标题-xxxx.md`（`title` / `date` / `description` 必填），推送 `master` 即自动校验、格式化并部署。

## 常用命令

```bash
deno task test                    # 跑测试
deno task validate-posts          # 校验 front matter
deno task rename-posts-dry        # 预览文章改名
deno task format-markdown-check   # 检查 Markdown 格式
```

主题同步、WASM 粒子引擎、图片流水线、部署流程等细节都写在 [`AGENTS.md`](AGENTS.md) 里，README 就不重复了。
