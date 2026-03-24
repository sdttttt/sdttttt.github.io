# Last Regrets

基于 [Hugo](https://gohugo.io/) 的个人博客，使用 [PaperMod](https://github.com/adityatelange/hugo-PaperMod) 主题。

站点地址: https://sdttttt.online/

## 仓库结构

```
├── content/          # 文章内容 (Markdown)
│   ├── posts/        # 博客文章
│   ├── about.md      # 关于页面
│   ├── archives.md   # 归档页面
│   └── search.md     # 搜索页面
├── static/           # 静态资源
├── themes/PaperMod/  # 主题 (git submodule)
├── layouts/          # 自定义布局模板
├── hugo.toml         # Hugo 配置
└── .github/workflows/ # CI/CD 配置
```

## 本地开发

```bash
# 安装 Hugo (macOS)
brew install hugo

# 启动开发服务器
hugo server -D

# 访问 http://localhost:1313
```

## 发布文章

1. 在 `content/posts/` 创建 `.md` 文件
2. 本地预览: `hugo server -D`
3. 推送到 GitHub，自动部署

## CI/CD

| 工作流 | 触发条件 | 说明 |
|--------|----------|------|
| `deploy.yml` | push 到 master | 构建并部署到 GitHub Pages |
| `format-markdown.yml` | push `.md` 文件 | 自动格式化 Markdown |

## 更新主题

```bash
git submodule update --remote themes/PaperMod
git add themes/PaperMod
git commit -m "Update PaperMod theme"
git push
```

## 首次克隆

```bash
git clone --recursive https://github.com/sdttttt/sdttttt.github.io.git
# 或已克隆后初始化 submodule
git submodule update --init --recursive
```
