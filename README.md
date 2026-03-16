# Hugo Blog

基于 [Hugo](https://gohugo.io/) 的静态博客，使用 [Paper](https://github.com/nanxiaobei/hugo-paper) 主题。

## 仓库结构

```
├── content/          # 文章内容 (Markdown)
├── static/           # 静态资源 (图片等)
├── themes/paper/     # 主题 (git submodule)
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
3. 推送到 GitHub:
   ```bash
   git add .
   git commit -m "Add new post"
   git push
   ```
4. GitHub Actions 自动构建并部署

## 更新主题

```bash
git submodule update --remote themes/paper
git add themes/paper
git commit -m "Update paper theme"
git push
```

## 首次克隆

```bash
git clone --recursive <repo-url>
# 或已克隆后初始化 submodule
git submodule update --init --recursive
```

## 部署

- 触发条件: 推送到 `master` 分支
- 构建工具: GitHub Actions
- 托管平台: GitHub Pages

部署状态查看: Actions 页面
