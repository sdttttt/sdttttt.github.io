# 海边

基于 [Hugo](https://gohugo.io/) 的个人博客，使用 [hugo-paper](https://github.com/nanxiaobei/hugo-paper) 主题（vendor-in 到 `themes/hugo-paper/`），默认正文语言为简体中文。

站点地址：<https://sdttttt.online/>

## 仓库结构

```
├── content/
│   ├── posts/         博客文章（Markdown + front matter）
│   └── claudelog/     AI 维护日志（每日一份 YYYY-MM-DD.md）
├── layouts/           hugo-paper 之上的自定义模板覆盖（bg.html / header.html / _default/baseof.html）
├── assets/custom.css  hugo-paper 用户 CSS 入口（背景图样式在这里）
├── static/            原样拷贝的静态资源（apple-touch-icon / favicon / bg/ cutouts）
├── themes/hugo-paper/ 主题（vendor-in，普通目录，同步上游需手动 patch 对应文件）
├── scripts/           维护脚本（Deno + TypeScript）
│   ├── *.ts           入口脚本（validate-posts / rename-posts / git-commit-push / ...）
│   ├── lib/           共用工具（args / frontmatter / git / fs）
│   └── __tests__/     node:test 测试
├── deno.json          Deno 任务定义
├── hugo.toml          Hugo 配置
└── .github/workflows/ CI/CD
```

## 本地预览

```bash
hugo server -D               # 含草稿
hugo --minify                # 生产构建到 public/
```

## 维护命令

```bash
deno task test                    # 跑 scripts/__tests__/ 全部测试
deno task validate-posts          # 校验 front matter
deno task rename-posts-dry        # 预览文章改名
deno task format-markdown-check   # 只检查 Markdown 格式（不写入）
deno task format-markdown         # 写入式格式化（CI 推送后自动跑）
deno task git-commit-push-dry     # 预览自动 commit + push
```

全局 prettier 通过 `deno install -g -A npm:prettier@3.9.6` 安装，无需本地 Prettier 配置。

## CI/CD

| 工作流                 | 触发                     | 作用                      |
| ---------------------- | ------------------------ | ------------------------- |
| `deploy.yml`           | push `master`            | 构建并部署到 GitHub Pages |
| `validate-posts.yml`   | push `content/**`        | 校验 front matter         |
| `check-dead-links.yml` | 每周 + push `content/**` | 检查外链死链              |
| `test-scripts.yml`     | push `scripts/**`        | 跑 Deno 测试              |

`deploy.yml` 在部署前会自动调用 `deno task format-markdown`。

## 命名约定

- 文章文件名：`YYYYMMDD-标题-xxxx.md`，末尾 4 位为短 hash 码，例如 `20260817-文章的变化-dqo.md`
- Front matter 必填：`title`、`date`、`description`

## 发布文章

1. 在 `content/posts/` 创建 `.md` 文件（参考现有文章的 front matter）
2. 推送 `master` 分支，CI 自动校验 + 格式化 + 部署

## 同步主题

hugo-paper 是 vendor-in 到 `themes/hugo-paper/` 的普通目录，同步上游需要手动 patch：

```bash
git clone --depth 1 https://github.com/nanxiaobei/hugo-paper.git /tmp/hp-clone
diff -ru themes/hugo-paper/ /tmp/hp-clone/ --brief
# 决定哪些文件要 cherry-pick 后手动合并
rm -rf /tmp/hp-clone
```

注意主仓库里以下文件依赖主题文件同步：

- `layouts/_default/baseof.html`（baseof.html 上游变动要同步）
- `layouts/partials/header.html`（header.html 上游变动要同步）

## 首次克隆

```bash
git clone https://github.com/sdttttt/sdttttt.github.io.git
```

主题已经 vendor-in，不需要 submodule。

## Agent 维护日志

每次 AI / Agent 自动改动仓库后，会在 `content/claudelog/YYYY-MM-DD.md` 追加条目。范围仅限自动改动，不包含用户的手动编辑。详见 `AGENTS.md`。
