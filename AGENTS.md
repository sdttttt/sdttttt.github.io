# 仓库贡献指南（Repository Guidelines）

基于 Hugo 的个人博客仓库（`sdttttt/sdttttt.github.io`），使用 **`sdttttt-paper` 子主题**（fork 自 [nanxiaobei/hugo-paper](https://github.com/nanxiaobei/hugo-paper)）。父主题 vendor-in 到 `themes/hugo-paper/`，自定义修改集中在 `themes/sdttttt-paper/`；两者通过 `hugo.toml` 的 `theme = ["sdttttt-paper", "hugo-paper"]` 列表组合，第一个主题的同名文件覆盖第二个。默认正文语言为简体中文。脚本与测试运行在 **Deno** 上（不是 Node.js）。站点：<https://sdttttt.online/>。

## 项目结构

- `content/posts/` — 博客文章（Markdown + front matter）。
- `content/changelog/` — Agent 维护日志（每天一个 `YYYY-MM-DD.md`；目录在 `99d262c` 由 `content/claudelog/` 改名而来）。
- `themes/sdttttt-paper/` — 自定义子主题，与 `themes/hugo-paper/` 组合（`hugo.toml` 里 `theme = ["sdttttt-paper", "hugo-paper"]`，前者优先，同名文件覆盖后者）：
  - `theme.toml` — 主题元数据（无 `[parent]` —— 那是 Hugo Modules 概念，目录式主题列表下不生效）
  - `layouts/_default/baseof.html` — baseof，调用 bg partial
  - `layouts/partials/bg.html` — 左下角装饰徽标：**WASM 粒子渲染**（滚到底部时「飞入聚合 → 落地顿一下 → 待机漂浮」，**每次揭示都重新随机一张图**（抽签推迟到滚到页底那一刻，且要等上一条淡出动画走完才算「藏起来」，见下），`$cfg` 里的 `thumpPower` / `idleEffect` / `floatAmp` / `floatPeriod` 是动效旋钮，`rippleMode` / `rippleAmp` / `rippleLength` / `ripplePeriod` 是备选水波（`idleEffect: 'ripple'` 时才生效），`gapFree` / `sizeRatio` / `pitchCss` 是密度与无缝旋钮），双击可切回真实 PNG
  - `layouts/partials/header.html` — header 覆写，强制默认亮色
  - `layouts/partials/footer.html` — footer，去掉 powered by / hugo-paper 链接
  - `layouts/_default/particles.html` — `/particles/` 粒子演示页（**`draft: true`，不对外发布**，本地用 `hugo server -D` 看）
  - `layouts/_default/archives.html` — `/archives/` 归档页（`content/archives.md` 的 `layout: archives` 指向它）：按年 → 月分组，每月一段 inline 流；口径是 `where site.RegularPages "Type" "in" site.Params.mainSections`（= 209 篇，自动排除 changelog 与 `build.list: never` 的私密文章）
  - `assets/custom.css` — 自定义 CSS（徽标 + 粒子页 + 归档页样式）。⚠️ **给 `h1`–`h6` 设 `font-size` 必须带 `!important`**：`themes/hugo-paper/assets/main.css:74` 的 `h1…h6 { font-size: inherit }` 与 `:1382` 的 `h1, h2, h3 { @apply font-semibold }` 都带 `:not(#\#)` 特异性炸弹（`:not(#\#)` 里的 `#\#` 是 ID 选择器 → (2,0,1) / (5,0,1)），普通类选择器永远打不过；字重不用写，继承主题的 600
  - `layouts/_default/search.html` + `layouts/index.json` + `assets/js/search.js` — `/search/` 站内搜索：构建期产出 `/searchindex.json`（`hugo.toml` 的 `[outputFormats.JSON]`，`notAlternative = true`），前端第一次敲字才懒加载索引做加权过滤
  - `layouts/_default/_markup/render-image.html` — markdown 图片渲染钩子：全站图片补 `loading="lazy"` / `decoding="async"`；占位图 `/images/image-lost.svg` 的 `title` 渲染成图下一行小字（`<span class="img-lost__note">`，不用 `figure/figcaption` —— 钩子里的 `.IsBlock` 在 Hugo 0.161.1 里**恒为 false**，且图片嵌在 `<p>` 内）
  - `layouts/robots.txt` — 覆写 Hugo 内置 robots.txt，补上 `Sitemap:` 行
  - `assets/js/` — `pt-wasm.js`（共享 wasm 加载器）/ `page-bg.js`（徽标 + 飞入/落地/漂浮的 rAF 状态机）/ `particles-wasm.js`（粒子页主引擎）/ `particles.js`（粒子页的纯 Canvas 2D 降级引擎）
  - `assets/wasm/particles.wasm` — 构建产物（提交进仓库，CI 不需要 Rust）

  （上述路径相对于 `themes/sdttttt-paper/`，完整路径如 `themes/sdttttt-paper/layouts/partials/bg.html`。）

- `themes/hugo-paper/` — vendor-in 的父主题（普通目录，不是 submodule），sync 时只动这个目录
- `wasm/particles/` — **Rust 裸导出的 WASM 引擎源码**（采样 + 物理 + 软件光栅化）；改完跑 `deno task build-wasm`（需 `cargo`），产物拷到 `themes/sdttttt-paper/assets/wasm/particles.wasm`；单元测试在 `src/tests.rs`（`#[cfg(test)] mod tests;`，约 31 个，`deno task test-wasm` 跑，**只在宿主上编译、不进 wasm 产物**；引擎 100% 行覆盖，见文件头注释里的复现命令）
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
deno task test-wasm               # 跑 wasm/particles 的 Rust 单元测试（需 cargo）
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
- 文章文件名：`YYYYMMDD-标题-xxxx.md`（末尾 4 位 hash 短码），例如 `20260817-文章的变化-dqo.md`。hash 取自**正文**，所以改正文 / 标题都会触发 `rename-posts` 改名；脚本会自动把旧 URL 追加进该篇的 `aliases`（幂等），**别名不要手删**，否则旧链接 404。
- Front matter 必填：`title`、`date`、`description`；无封面字段（cover 系统已删）。
- 背景图 / 头像：**原图放 `assets/src/`，发布图放 `static/`**。背景 cutouts 是 `assets/src/bg/*.png`（PNG 已用 `@imgly/background-removal-node` 预切），跑 `deno task optimize-images` 生成 `static/bg/*.avif`（640px q45，`--format webp` 可切 WebP）；头像是 `assets/src/avatar/avatar.jpg` → `static/avatar.webp`（192px，固定 WebP）。新增/删除图片会在左下角徽标和 `/particles/` 自动生效（两处都靠 `readDir "static/bg"` 发现 `.avif` / `.webp`）。
- 文章内联图片：外链图床（Gitee / imgkr / idanmu）会烂掉，**原图丢了就换成 `static/images/image-lost.svg` 占位**，markdown 写成 `![alt](/images/image-lost.svg "原托管方 + 暂缺原因")`（`title` 由 `render-image.html` 渲染成图下小字）；新图建议放 `static/images/posts/<slug>/` 并提交进仓库。
- **碰过 `assets/src/**` 就必须重跑 `deno task optimize-images` 并提交产物**：CI 不跑图片转换（同 WASM），忘了就发布会陈旧/缺失的图。
- **WASM 引擎**：Rust 裸导出（不用 wasm-bindgen），只导出 C-ABI 函数。改 `wasm/particles/src/lib.rs` 后必须重新 `deno task build-wasm` 并提交 `.wasm`；改完先 `deno task test-wasm` 过一遍单元测试（`src/tests.rs`，测试直接读写 `Engine` 私有字段，靠一把全局锁把并行的 `cargo test` 串起来）；搜索建议：`WebAssembly` 相关代码都在 `assets/js/pt-wasm.js`（共享加载器）里。
- **降级链**：左下角徽标的渲染路径会写到 `html[data-pt-engine]` 上，排查时先看这个属性：
  `deferred`（还没滚到接近页底，引擎按需预热尚未开始）/ `pending`（引擎加载中，或已加载完但还没滚到页底揭示）/ `unsupported`（浏览器不支持 WASM，直接显示原图，连 wasm 都不拉）/ `error`（下载·编译·构建失败，回退原图）/ `wasm`（粒子已就绪）/ `png`（未配置或加载器缺失）。`assets/js/pt-wasm.js` 导出 `supported` 做显式能力检测。
- **徽标按需预热**：`assets/js/page-bg.js` 只在「距离页底还有 2 个视口高度」时才拉 wasm（`start()` **只拉 wasm**），所以不读到底的访问不会付 23KB wasm 的成本；`mark('deferred')` 在首个 `syncGate()` 之前同步写下，用来挡住 baseof 的 2s 兜底定时器。
- **抽图推迟到「揭示」那一刻，且每次揭示都重抽**：`syncGate()` 里只在 `html.at-bottom` **从无到有**的那一刻调 `showImage()` —— 抽签（`pickImage()`，会避开上一张）、换 `<img>` 的 `src`、`sizeCanvas()` + 采样 + `build()` 全在这一刻发生。因此「读过但没滚到底」的访问既不付采样成本、也**永远不会抽签**。首次揭示保留粒子撒在画布外的初态去跑「飞入」，之后每次揭示都只是 `settle()` 吸附成型（`draw()`）—— 在页底上下滚不会反复播 1.6s 的飞入。`revealed` / `pending` / `shownOnce` / `building` / `needsPick` 五个标志 + `hideTimer` 管住整条状态机。
- **「隐藏」要等淡出走完才算数**：滚离页底只摘掉 `html.at-bottom`（CSS 开始淡出），旧帧**先留着** —— `hideTimer = setTimeout(hideFadeDone, hideMs())`，`hideMs()` 直接读 `.page-bg__box` 的 `transitionDuration`（不硬编码，`prefers-reduced-motion` 下 CSS 是 `transition: none` → 自动变 0）。淡出走完才 `discardFrame()` + `needsPick = true`（下次揭示才重抽）；**淡出没走完就又滚回页底 → `clearTimeout` 撤销、`needsPick` 保持 false，`revealShow()` 直接把粒子、图片、动效状态原样接着显示**。计时器只在「这一轮」离开页底时起一次（`if (!hideTimer)`），否则每个滚动事件都会把它往后推。
- **粒子白线（徽标的白色网格）**：`rasterize()` 把每颗粒子居中吸附到**整数设备像素**，所以当采样间距不是整数（如 3.2）时，相邻方块中心距会在 floor/ceil 之间跳变 —— 跳到 ceil 而边长只有 floor（旧参数：间距 3.2 / 边长 3）就裂出 1px 白线，整幅图上一层可见网格。修法在 `wasm/particles/src/lib.rs` 的 `make()`：`size_mode` 传 2（`$cfg.gapFree`）时 `size = ceil(间距) + round(ratio)`，**此时 `sizeRatio` 的含义从「比例」变成「额外出血量（设备 px）」**。实测首图剪影内孔洞 15.97%（最长连续 630px）→ 3.17%（最长 62px）。⚠️ 出血量同时是**动效安全预算**：相邻两颗粒子反向位移之和超过出血量就会在运动中重新裂洞（实测出血 1.8 设备 px 下，逐粒子漂浮 amp 0.4 / 0.6 CSS px 安全，0.9 开始裂）。
- **徽标待机动效的判据是「位移梯度」，不是相干性**：格子已几乎拼满，判据是相邻粒子（一个采样间距）的**相对位移**必须远小于出血量。旧参数（出血 0.2 设备 px）下相干场必裂 —— 竖直行波静位移 5px 时头发上浮出横竖条纹、1px 时又完全看不出动过（可用区间近乎为零），绕中心缩放 `pulse()` 虽仿射不拍摩尔纹但仍有整体「呼吸」感 —— 据此一度写下「待机动效只能非相干」的结论；改成无缝边长（出血 1.8 设备 px）后**相干波重新可用**，即引擎里的 `ripple_on()`：
  - `rippleMode: 'rise'`（默认，单向纵波）：波前为水平线、**自下而上**行进，位移沿纵向。位移只随 y 变化 ⇒ 相邻采样行的相对位移 ≈ `amp·k·间距`（λ=80 CSS px 时只有 0.5 设备 px）；
  - `rippleMode: 'radial'`（径向涟漪）：相对位移同类，振幅沿半径衰减；
  - `rippleMode: 'shear'`（横向剪切）：位移只随 y 变化**且只有横向分量** ⇒ 行距分毫不变 ⇒ 相对位移恒为 0，结构上不可能裂。
  - `'rise'` 与 `'shear'` 共用引擎里的模式 0（`t = py*k + phase`，只随 y 变化），区别**只在于把振幅给哪个分量**（`rise` 给 `ampY`、`shear` 给 `ampX`）；`t = py*k + φ` 中 φ 递增 ⇒ 波峰向 y 减小方向走 ⇒ 天然「自下而上」。
  - 但 2026-10-06 最终**没用相干波**：水波压到 amp 2 CSS px / λ 80 / 7.5s 后仍被嫌「整幅在动」，于是 `idleEffect` 回退到 **`'float'`（逐粒子随机漂浮，非相干）** —— 每颗粒子拿一套随机相位/振幅、各绕自己的初始位画圆，单颗粒子只挪亚像素级（amp 0.4 CSS px），整幅看上去是轻微的像素闪烁。`floatOn`/`ripple_on` 两个入口都留在引擎里，改 `$cfg.idleEffect` 即可切换（引擎侧的默认值是 `float`，写错值也按 float）。
- 给徽标加新交互力前，先确认它要么**非相干**、要么**仿射**（整体平移 / 缩放 / 旋转）、要么**梯度足够低**（按上面的相对位移判据算），并且**必须在 1:1 逐帧对比图上验** —— 用 `sharp` 的 `nearest` 做非整数降采样（如 640→200）本身就会造出条纹假象。`fast_sin()`（Bhaskara 近似）就是为了不把 libm 拖进 wasm（`WebAssembly.Module.imports()` 必须为空），实测最大绝对误差 0.0016，够用。

## 测试指南

- 框架：Deno 内置 `Deno.test`，测试位于 `scripts/__tests__/*.test.ts`。
- 断言风格参考 `node:test`；共享工具在 `expect.ts` / `temp-dir.ts`。
- 新脚本须配套 `*.test.ts`；CI 通过 `.github/workflows/test-scripts.yml` 自动跑。

## 提交与 PR 规范

- 提交信息遵循 Conventional Commits，可选作用域：`chore(rename):`、`feat(seo):`、`ci(deploy):`、`chore(format):`、`chore(taxonomies):`、`docs(changelog):` 等。
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

每次对仓库做出修改后，在 `content/changelog/` 中创建或追加当天的 `YYYY-MM-DD.md`。模板：

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
