# Last Regrets

基于 [Hugo](https://gohugo.io/) 的个人博客，使用 [PaperMod](https://github.com/adityatelange/hugo-PaperMod) 主题，默认正文语言为简体中文。

站点地址：<https://sdttttt.online/>

## 仓库结构

```
├── content/
│   ├── posts/         博客文章（Markdown + front matter）
│   └── claudelog/     AI 维护日志（每日一份 YYYY-MM-DD.md）
├── layouts/           PaperMod 之上的自定义模板覆盖
├── static/            原样拷贝的静态资源（封面在 static/images/covers/）
├── themes/PaperMod/   主题（git submodule，不要在此目录常规改动）
├── scripts/           维护脚本（Deno + TypeScript）
│   ├── *.ts           入口脚本（validate-posts / sync-covers / ...）
│   ├── lib/           共用工具（args / frontmatter / git）
│   └── __tests__/     node:test 测试
├── deno.json          Deno 任务与 import map
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
deno task validate-posts          # 校验 front matter / 封面
deno task sync-covers-dry         # 预览孤儿封面清理
deno task rename-posts-dry        # 预览文章改名
deno task format-markdown-check   # 只检查 Markdown 格式（不写入）
deno task format-markdown         # 写入式格式化（CI 推送后自动跑）
```

全局 prettier 通过 `deno install -g -A npm:prettier@3.9.6` 安装，无需本地 Prettier 配置。

## CI/CD

| 工作流                 | 触发                     | 作用                               |
| ---------------------- | ------------------------ | ---------------------------------- |
| `deploy.yml`           | push `master`            | 构建并部署到 GitHub Pages          |
| `validate-posts.yml`   | push `content/**`        | 校验 front matter 与封面一致性     |
| `sync-covers.yml`      | 每周 + push              | 清理孤儿封面                       |
| `check-dead-links.yml` | 每周 + push `content/**` | 检查外链死链                       |
| `test-scripts.yml`     | push `scripts/**`        | 跑 Deno 测试                       |
| `update-papermod.yml`  | 每周                     | 检测 PaperMod upstream 更新并开 PR |

`deploy.yml` 在部署前会自动调用 `deno task format-markdown`。

## 命名约定

- 文章文件名：`YYYYMMDD-标题-xxxx.md`，末尾 4 位为短 hash 码，例如 `20260817-文章的变化-dqo.md`
- Front matter 必填：`title`、`date`、`description`
- 封面：`cover.image: "images/covers/..."`

## 发布文章

1. 在 `content/posts/` 创建 `.md` 文件（参考现有文章的 front matter）
2. 推送 `master` 分支，CI 自动校验 + 格式化 + 部署

## 更新主题

```bash
git submodule update --remote themes/PaperMod
git add themes/PaperMod
git commit -m "chore(deps): bump PaperMod"
git push
```

## 首次克隆

```bash
git clone --recursive https://github.com/sdttttt/sdttttt.github.io.git
# 已克隆但未初始化 submodule：
git submodule update --init --recursive
```

## Agent 维护日志

每次 AI / Agent 自动改动仓库后，会在 `content/claudelog/YYYY-MM-DD.md` 追加条目。范围仅限自动改动，不包含用户的手动编辑。详见 `AGENTS.md`。
