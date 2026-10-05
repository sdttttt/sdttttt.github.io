# 海边

基于 [Hugo](https://gohugo.io/) 的个人博客，使用自定义子主题 `sdttttt-paper`（fork 自 [hugo-paper](https://github.com/nanxiaobei/hugo-paper)）。父主题 vendor-in 到 `themes/hugo-paper/`，自定义修改在 `themes/sdttttt-paper/`，两者通过 `theme = ["sdttttt-paper", "hugo-paper"]` 组合（前者同名文件覆盖后者）。默认正文语言为简体中文。

站点地址：<https://sdttttt.online/>

## 特性

- 默认亮色主题（不跟随系统 / 手动可切暗色）
- 左下角装饰徽标：**WASM 粒子渲染**（滚到页面底部揭示，双击切回真实 PNG）
- `/particles/`：粒子效果演示页（同一套 WASM 引擎；`?engine=js` 可切到纯 Canvas 2D 版对比）。**`draft: true`，只存在于本地，不发布到线上**（`hugo server -D` 预览）
- 中英混排友好（`hasCJKLanguage = true`）
- AI 维护日志：`content/claudelog/YYYY-MM-DD.md`，每个 commit 都留痕

## 仓库结构

```
├── content/
│   ├── posts/         博客文章（Markdown + front matter）
│   └── claudelog/     AI 维护日志（每日一份 YYYY-MM-DD.md）
├── themes/
│   ├── sdttttt-paper/ 自定义子主题（覆盖父主题同名文件）
│   │   ├── layouts/partials/{bg,header,footer}.html
│   │   ├── layouts/_default/particles.html
│   │   ├── assets/js/       pt-wasm / page-bg / particles-wasm / particles
│   │   ├── assets/wasm/     particles.wasm（Rust 构建产物）
│   │   └── assets/custom.css
│   └── hugo-paper/    父主题（vendor-in，同步上游需手动 patch）
├── wasm/particles/    WASM 引擎源码（Rust 裸导出；deno task build-wasm）
├── static/            原样拷贝的静态资源（apple-touch-icon / favicon / bg/ cutouts）
├── scripts/           维护脚本（Deno + TypeScript）
│   ├── *.ts           入口脚本（validate-posts / rename-posts / git-commit-push / ...）
│   ├── lib/           共用工具（args / frontmatter / git / fs）
│   └── __tests__/     node:test 测试
├── deno.json          Deno 任务定义
├── hugo.toml          Hugo 配置
├── AGENTS.md          AI / Agent 贡献指南（编码规范、命名约定、操作需确认、维护日志模板）
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
deno task check-dead-links        # 检查外链死链
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

主题分两部分，互不干扰。

**1. 父主题 `themes/hugo-paper/`**（vendor-in，不是 submodule）：

```bash
git clone --depth 1 https://github.com/nanxiaobei/hugo-paper.git /tmp/hp-clone
diff -ru themes/hugo-paper/ /tmp/hp-clone/ --brief
# 决定哪些文件要 cherry-pick 后手动合并
rm -rf /tmp/hp-clone
```

**2. 子主题 override `themes/sdttttt-paper/`**：父主题同步后，按下表 reapply 本地 diff（每个文件头注释也写明了同步对象）：

| 文件                           | 相对父主题的改动                  |
| ------------------------------ | --------------------------------- |
| `layouts/_default/baseof.html` | 多了 `{{ partial "bg.html" . }}`  |
| `layouts/partials/header.html` | 暗色 JS 改为默认亮色              |
| `layouts/partials/footer.html` | 去掉 powered by / hugo-paper 链接 |
| `layouts/partials/bg.html`     | 本项目新增，无需同步              |
| `assets/custom.css`            | 本项目新增，无需同步              |

## 首次克隆

```bash
git clone https://github.com/sdttttt/sdttttt.github.io.git
```

主题已经 vendor-in，不需要 submodule。

## Agent 维护日志

每次 AI / Agent 自动改动仓库后，会在 `content/claudelog/YYYY-MM-DD.md` 追加条目。范围仅限自动改动，不包含用户的手动编辑。详见 `AGENTS.md`。
