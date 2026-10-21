# 仓库贡献指南（Repository Guidelines）

基于 Hugo 的个人博客仓库（`sdttttt/sdttttt.github.io`），使用 **`self` 主题**（fork 自 [nanxiaobei/hugo-paper](https://github.com/nanxiaobei/hugo-paper)；2026-10-07 起上游同步已停止，原 `themes/hugo-paper/` 合并进 `themes/self/`，现在它是仓库里唯一的主题，`hugo.toml` 只写 `theme = "self"`）。默认正文语言为简体中文。脚本与测试运行在 **Deno** 上（不是 Node.js）。站点：<https://sdttttt.online/>。

## 项目结构

- `content/posts/` — 博客文章（Markdown + front matter）。
- `content/changelog/` — Agent 维护日志（每天一个 `YYYY-MM-DD.md`；目录在 `99d262c` 由 `content/claudelog/` 改名而来）。
- `themes/self/` — 唯一的主题（`hugo.toml` 里 `theme = "self"`）。以下文件是本仓库自己维护的；其余（`404.html` / `static/*`）仍来自上游 hugo-paper，改动前先去上游仓库看一眼是不是已经修过。**2026-10-07 删掉了一批死功能**（RSS 生成、`<meta name="description">`、评论 / KaTeX / mermaid / highlight.js / `collapse` shortcode、20 个用不上的 `i18n/*.yaml`、无资源的社交图标导航）—— 细节见 `themes/self/README.md` 的删除清单，别再照上游抄回来：
  - `theme.toml` — 主题元数据
  - `layouts/_default/baseof.html` — baseof，调用 bg partial；`avatar_url` scratch 每页都解析（header 的 32px 头像要用，`head.html` 因此每页 preload 这 8.6KB）
  - `layouts/partials/bg.html` — **待机屏保**：全视口固定画布（不是整个滚动文档），10 秒无输入后把随机一张 `static/bg/*.avif` 按 contain 画到透明底上，按 2px 网格交给 WASM 粒子组装（人物画在透明底上，页面由 CSS 毛玻璃透出来）；`$cfg` 的 `idleMs` / `prewarmMs` / `blockPx` / `maxBlocks` / `maxPixels` / `maxParticles` / `assembleMs` / `sizeRatio` / `floatAmp` / `floatPeriod` / `scatterRadius` / `scatterPower` 是全部旋钮，详见下方「待机屏保」段。无 `<img>` 兜底：无 JS / wasm 失败时页面保持原样。
  - `layouts/partials/header.html` — header 覆写，强制默认亮色；2026-10-21 起左上角是**身份块**（32px 圆角头像 + `site.Params.name`，回退 `site.Title`，整组链接回首页），站点标题挪到首页 hero
  - `layouts/_default/list.html` — 列表页；首页第一页的 hero 是大号站点标题 `<h1 class="home-title">`（3rem，样式在 custom.css），原来的「头像 + 名字 + bio」块已并入 header
  - `layouts/partials/footer.html` — footer，去掉上游的 powered by 链接；右端挂一枚 powered by dsh 徽标（SVG 自托管在 `static/images/powered-by-dsh.svg`，样式是 `custom.css` 的 `.dsh-badge`；`opacity-60` 只留给版权行，否则徽标连 #555 / #4D6BFE 一起发灰）
  - `layouts/_default/particles.html` — `/particles/` 粒子演示页（**`draft: true`，不对外发布**，本地用 `hugo server -D` 看）
  - `layouts/_default/archives.html` — `/archives/` 归档页（`content/archives.md` 的 `layout: archives` 指向它）：按年 → 月分组，每月一段 inline 流；口径是 `where site.RegularPages "Type" "in" site.Params.mainSections`（= 209 篇，自动排除 changelog 与 `build.list: never` 的私密文章）
  - `assets/custom.css` — 自定义 CSS（待机屏保 + 粒子页 + 归档页 + 页脚徽标样式）。⚠️ **给 `h1`–`h6` 设 `font-size` 必须带 `!important`**：`assets/main.css:74` 的 `h1…h6 { font-size: inherit }` 与 `:1382` 的 `h1, h2, h3 { @apply font-semibold }` 都带 `:not(#\#)` 特异性炸弹（`:not(#\#)` 里的 `#\#` 是 ID 选择器 → (2,0,1) / (5,0,1)），普通类选择器永远打不过；字重不用写，继承主题的 600
  - `layouts/_default/search.html` + `layouts/index.json` + `assets/js/search.js` — `/search/` 站内搜索：构建期产出 `/searchindex.json`（`hugo.toml` 的 `[outputFormats.JSON]`，`notAlternative = true`），前端第一次敲字才懒加载索引做加权过滤
  - `layouts/_default/_markup/render-image.html` — markdown 图片渲染钩子：全站图片补 `loading="lazy"` / `decoding="async"`；占位图 `/images/image-lost.svg` 的 `title` 渲染成图下一行小字（`<span class="img-lost__note">`，不用 `figure/figcaption` —— 钩子里的 `.IsBlock` 在 Hugo 0.161.1 里**恒为 false**，且图片嵌在 `<p>` 内）
  - `layouts/robots.txt` — 覆写 Hugo 内置 robots.txt，补上 `Sitemap:` 行
  - `assets/js/` — `pt-wasm.js`（共享 wasm 加载器）/ `page-bg.js`（待机屏保：10s 空闲、8s 预热、30Hz 组装、持续漂浮、指针散开场、wake 层）/ `particles-wasm.js`（粒子页主引擎）/ `particles.js`（粒子页的纯 Canvas 2D 降级引擎）
  - `assets/wasm/particles.wasm` — 构建产物（提交进仓库，CI 不需要 Rust）
  - `assets/app.css` + `assets/main.css` + `package.json` + `bun.lock` + `postcss.config.mjs` — **Tailwind v4 管线**（2026-10-07 恢复）：`app.css` 是源（`@import 'tailwindcss'` + `@plugin '@tailwindcss/typography'` + `@custom-variant dark` + `@theme` + `@utility dark-bg`），`main.css` 是提交进仓库的编译产物（Hugo 只做 concat + minify + fingerprint，见 `layouts/partials/head.html`）。改样式 / 类名后跑 `deno task build-css`（= `bin/build-css.sh`：`bun install --frozen-lockfile` → `postcss assets/app.css -o assets/main.css` → 更新 `assets/main.css.sha256`），**别手改 `main.css`**。`bun.lock` 原样 vendor 自上游（连用不上的 prettier devDeps 也留着）：产物对 `postcss-preset-env` 的传递依赖（`@csstools/*`）版本敏感，不钉死 lockfile 会重新解析出更新的 patch 版本、同一份 `app.css` 编出不同字节（实测 `#0000` 变成 `rgba(0,0,0,0)`）
  - ⚠️ **Tailwind v4 的扫描根就是主题目录（编译时的 cwd）**，所以 `layouts/**` 之外的 `README.md`、`i18n/*.yaml`、**上一版 `main.css` 自己**都在扫描范围内：上一版产物里的类会被重新发射（死类化石自我延续 —— 上游删掉的 `exampleSite/` 就是这么留下社交图标的类），README 的散文也可能造出规则（`collapse` 就是这么进来的）。因此改 README 也会让指纹失配，重跑一次 `build-css` 即可（幂等）。但**别在散文里写真实类名**：实测把字面量 `dark-bg`（`app.css` 里 `@utility` 的名字）写进 `themes/self/README.md`，会让 `.dark-bg:where(.dark,.dark *)` 多背一层 `:not(#\#)` 特异性 bumpers（产物 57,943 → 58,801 字节）；把那个词换掉就逐字节复原

  （上述路径相对于 `themes/self/`，完整路径如 `themes/self/layouts/partials/bg.html`。）

- `wasm/particles/` — **Rust 裸导出的 WASM 引擎源码**（采样 + 物理 + 软件光栅化）；改完跑 `deno task build-wasm`（需 `cargo`），产物拷到 `themes/self/assets/wasm/particles.wasm`（当前 32,062 字节）；单元测试在 `src/tests.rs`（`#[cfg(test)] mod tests;`，约 37 个，`deno task test-wasm` 跑，**只在宿主上编译、不进 wasm 产物**；引擎 100% 行覆盖，见文件头注释里的复现命令）
- `assets/src/` — **图片原图**（`bg/*.png` 背景 cutouts、`avatar/avatar.jpg`）；Hugo **不**发布该目录下未被 Pipes 引用的文件，所以原图只占仓库、不占部署体积。改完跑 `deno task optimize-images`，产物写进 `static/`
- `static/` — 原样拷贝的静态资源（apple-touch-icon / favicon / safari）；`static/bg/*.avif` 与 `static/avatar.webp` 是 `optimize-images` 生成的发布图。
- `bin/` — **CI 与本地共用的 shell 脚本层**（bash 3.2 兼容，macOS 自带 bash 也能跑）。`.github/workflows/*.yml` 只声明「触发条件 + 权限 + 第三方 action + 工具链安装」，实际跑什么全在 `bin/*.sh` 里 —— 所以本地能跑出和 CI 一样的结果，也不用读 YAML 才知道 CI 干了什么：
  - `lib.sh`（被 source 的底座：定位仓库根、把 vendored 的 `.tools/deno/bin` 前置进 PATH、日志、以及「失败不中断、最后汇总」的 `run_step`/`report`）、`preflight.sh`（`--check` 只读 / `--fix` 就地修 / `--re-stage` 修完重新入 index）、`validate-posts.sh`、`test.sh`、`build.sh`、`build-wasm.sh`、`build-css.sh`、`artifacts.sh`、`check-links.sh`、`publish-autofix.sh`（CI 专用，本地会拒绝执行）
  - `hooks/pre-commit`（`preflight --fix --re-stage`）与 `hooks/pre-push`（`preflight --check`），用 `./bin/install-hooks.sh` 装成 `core.hooksPath`（因此 hooks 是版本化文件，跟着仓库走）
- `scripts/` — Deno + TypeScript 维护脚本：根目录 `*.ts` 为入口，`lib/` 放共用工具（args / frontmatter / image-plan / paths），`__tests__/` 放测试。
- `hugo.toml` — Hugo 配置（`theme = "self"`）。**RSS 全站关闭**：`[outputs]` 把 `home` 写成 `["HTML", "JSON"]`、并把 `section` / `taxonomy` / `term` 单独钉成 `["HTML"]`（只改 `home` 关不干净 —— Hugo 对这三类页面有自带的 RSS 默认值，`/tags/*/index.xml` 就是这么来的）；`deno.json` — Deno 任务定义（含 `build-wasm` / `build-css`）。

首次克隆不需要 submodule：`git clone`。

**主题不再跟随上游同步**（2026-10-07 把 `themes/hugo-paper/` 合并进了 `themes/self/`，两个目录的同名文件冲突已在当时解决）。想看上游有没有值得抄的改动，临时 clone 一份对比即可（`git clone --depth 1 https://github.com/nanxiaobei/hugo-paper.git /tmp/hp-clone`），需要的话直接把改动落在这个主题的对应文件里。

推送到 `master` 即触发 `.github/workflows/deploy.yml` 自动部署（部署前会先跑一遍 `bin/*.sh`）。

## 构建、测试与开发命令

```bash
hugo server -D                    # 本地预览（含草稿）
hugo --minify                     # 生产构建到 public/

deno task test                    # 跑 scripts/__tests__/ 下全部测试
deno task test-wasm               # 跑 wasm/particles 的 Rust 单元测试（需 cargo）
deno task build-wasm              # 重建 wasm 产物 + 指纹（需 cargo；CI 不跑）
deno task build-css               # 重建 Tailwind 产物 main.css + 指纹（需 bun；CI 不跑）
deno task validate-posts          # 校验 front matter
deno task check-dead-links        # 检查外链死链（拆成「真死链 / 没能验证 / 已归档」三栏）
deno task rename-posts-dry        # 预览文章改名
deno task optimize-images-dry     # 预览图片转换（不写盘、不装 sharp）
deno task optimize-images         # 把 assets/src/ 的原图转成 static/ 的发布图
deno task format-markdown-check   # 检查 Markdown 格式（不写入）
deno task format-markdown         # 写入式格式化（CI 推送后自动跑）
deno task lint                    # deno lint scripts/（已 exclude no-sloppy-imports）
```

## CI 与本地检查（`bin/`）

**设计原则：YAML 只做 YAML 该做的事** —— 触发条件、`permissions`、`environment`、第三方 action、工具链安装、`concurrency`；所有逻辑都写进 `bin/*.sh`。改 CI 行为 = 改 shell 脚本，而本地跑同一个脚本就能复现 CI 的结果。

```bash
./bin/preflight.sh                   # 只读：CI 会跑的那五道检查，本地跑一遍就知道 CI 会不会绿
./bin/preflight.sh --fix             # 就地修（文件名 + Markdown 格式），CI 里用这个
./bin/install-hooks.sh               # 装一次 pre-commit / pre-push hook（core.hooksPath=bin/hooks）
./bin/artifacts.sh check             # 图片 / wasm / Tailwind 产物是否齐全且新鲜
./bin/artifacts.sh check --rebuild   # 额外重编译逐字节比对：cargo 编 wasm；有 bun + node_modules 时也重编 CSS
./bin/test.sh                        # shell 语法检查 + deno 单测
./bin/build.sh                       # hugo --minify
./bin/build-css.sh                   # Tailwind：bun install --frozen-lockfile → postcss → main.css + 指纹（幂等）
./bin/check-links.sh                 # 死链检查（CI 里失败只出 warning，不挡部署）
#   死链只算「确实打不开」的；403/429/451 与反爬域名（baike.baidu.com）下的任何响应都归「没能验证」，
#   正文里已注明失效的链接写进 scripts/check-dead-links.ts 的 ARCHIVED_URLS（连请求都不发，有测试守着）
```

- **`preflight.sh` 的五步**：① 文章文件名（`rename-posts --check`）② Markdown 格式（prettier）③ front matter 校验 ④ 单测 ⑤ 构建产物新鲜度（图片 / wasm / Tailwind）。任一步失败都会汇总到最后一行，退出码非零即「CI 会红」。
- **产物新鲜度靠指纹，不靠 mtime**：`themes/self/assets/wasm/particles.sha256` 记的是「产物 + 各源文件」的 sha256（sha256sum 格式，故意不用 JSON）。CI **不装 Rust**，所以它靠这份指纹发现「改了 `wasm/**` 却忘了重建」；本地有 cargo 时用 `--rebuild` 做最强校验（重编译 + `cmp`）。图片产物缺了则直接硬失败（提示跑 `deno task optimize-images`）。
- 改了 `wasm/**` 后跑 `deno task build-wasm`（= `bin/build-wasm.sh`：构建 + 复制产物 + 更新指纹），**产物与指纹一起提交**。
- 改了 `themes/self/` 里被 Tailwind 扫描的内容（`assets/app.css`、模板里的类名、`README.md`）后跑 `deno task build-css`，**产物 `assets/main.css` 与指纹 `assets/main.css.sha256` 一起提交**。
- 四个 workflow 都只剩这一层壳：`deploy.yml`（`preflight --fix` → `build.sh` → 上传 Pages → `publish-autofix.sh` 把修复提交回仓库）、`test-scripts.yml`、`validate-posts.yml`、`check-dead-links.yml`。

## 编码与命名规范

- TypeScript 脚本使用 2 空格缩进；依赖 Deno 任务运行，无 `tsc`、无 `node_modules`；只用 `node:` 内置 API 与 import map 里显式列出的 npm 包。
- Markdown 由全局安装的 Prettier 3 格式化（`deno install -g -A npm:prettier@3.9.6`），仓库无本地 Prettier 配置，沿用默认；`deploy.yml` 推送后会自动调用 `deno task format-markdown`。
- 文章文件名：`YYYYMMDD-标题-xxxx.md`（末尾 3–4 位 hash 短码），例如 `20260817-文章的变化-dqo.md`。hash 取自**正文**，所以改正文 / 标题都会触发 `rename-posts` 改名；脚本会自动把旧 URL 追加进该篇的 `aliases`（幂等），**别名不要手删**，否则旧链接 404。
- Front matter 必填：`title`、`date`、`description`；无封面字段（cover 系统已删）。`description` 现在只喂 OG / Twitter 卡片与 schema（`og:description` / `twitter:description` / `itemprop=description`，来自 `_internal/*.html`），**不再**生成 `<meta name="description">`（那行已从 `head.html` 删除）。
- 背景图 / 头像：**原图放 `assets/src/`，发布图放 `static/`**。背景 cutouts 是 `assets/src/bg/*.png`（PNG 已用 `@imgly/background-removal-node` 预切），跑 `deno task optimize-images` 生成 `static/bg/*.avif`（640px q45，`--format webp` 可切 WebP）；头像是 `assets/src/avatar/avatar.jpg` → `static/avatar.webp`（192px，固定 WebP）。新增/删除图片会在待机屏保和 `/particles/` 自动生效（两处都靠 `readDir "static/bg"` 发现 `.avif` / `.webp`）。
- 文章内联图片：外链图床（Gitee / imgkr / idanmu）会烂掉，**原图丢了就换成 `static/images/image-lost.svg` 占位**，markdown 写成 `![alt](/images/image-lost.svg "原托管方 + 暂缺原因")`（`title` 由 `render-image.html` 渲染成图下小字）；新图建议放 `static/images/posts/<slug>/` 并提交进仓库。
- **碰过 `assets/src/**` 就必须重跑 `deno task optimize-images` 并提交产物**：CI 不跑图片转换（同 WASM），忘了就发布会陈旧/缺失的图。
- **WASM 引擎**：Rust 裸导出（不用 wasm-bindgen），只导出 C-ABI 函数。改 `wasm/particles/src/lib.rs` 后必须重新 `deno task build-wasm` 并提交 `.wasm`；改完先 `deno task test-wasm` 过一遍单元测试（`src/tests.rs`，测试直接读写 `Engine` 私有字段，靠一把全局锁把并行的 `cargo test` 串起来）；搜索建议：`WebAssembly` 相关代码都在 `assets/js/pt-wasm.js`（共享加载器）里。
- **Tailwind 管线**：`themes/self/assets/main.css` 是编译产物（首行 `/*! tailwindcss v4.1.18 | MIT License */`），不要手改；改样式 / 类名后跑 `deno task build-css` 并提交 `main.css` + `main.css.sha256`（幂等，可反复跑）。搜索建议：`@theme` / `@utility dark-bg` 在 `themes/self/assets/app.css`，站点自有样式全在 `themes/self/assets/custom.css`（`main.css` 里的规则是 Tailwind 生成的，改它会被下次编译覆盖）。
- **待机屏保（2026-10-20 重做）**：`assets/js/page-bg.js` 从页面加载起计时，**10 秒没有任何输入**就进入待机；8 秒时先预热 wasm（约 34KB）并解码一张图，10 秒到点再合成、`build()`、组装。
  - **范围**：固定定位的**视口层**（`position:fixed; inset:0; z-index:100`），不是整个滚动文档 —— 按文档高度铺 2px 网格会到几十万粒子 / 几十 MB framebuffer。`page-bg` 自身是半透明底色 + `backdrop-filter` 毛玻璃（暗色单独 tint），所以正文仍然透出来，粒子间隙看到的是原页面而不是第二张图。
  - **2px 网格的预算**：backing store 用 CSS px、**不乘 dpr**，总像素上限 1.5MP；1440×900 是 720×450 = 324,000 个格子，但图是透明底 cutout，只有人物覆盖的格子会变成粒子（实测 5.3–7.4 万颗 @1440×900，随图不同），5.2MB/帧、30fps ≈ 156MB/s（旧徽标 60fps 约 138MB/s，同一量级）。屏幕太大时 `blockCss = max(2, sqrt(视口面积 / 400000))` 自动放大，且 backing 缩放后 step 会取整（1920 约 2.3px，2560 约 3.0px，4K 约 4.6px）；`maxParticles` 180k 只是引擎安全阀。
  - **构图**：`compose()` 只把 cutout 按 contain 画到**透明**画布上（不画底、不做 tint），引擎按 alpha > 128 采样，所以人物之外一个粒子都没有；合成图与画布同尺寸 ⇒ `fit` 1:1、`step=size`、目标位是整数，2px 方块严格平铺、没有白线。
  - **毛玻璃**：`.page-bg` 用 `color-mix(in srgb, var(--bg) 55%, transparent)` + `backdrop-filter: blur(10px) saturate(0.92)`；暗色 `#0b0b0b/55%`，手机降到 6px。canvas 背景全透明，`putImageData` 只覆盖人物像素，原博客内容从缝隙里透出来。
  - **组装**：Rust 的 `assemble_on(frames)` 按 `hash01(i)` 在 `assembleMs`（默认 1200ms）内随机放行；未放行的粒子**既不跑弹簧也不画**，放行后从 `build()` 撒好的远处（spread 2.4×画布）飞回目标位。`tick()` 在窗口内恒返回 1（单测 `assemble_gate_releases_by_hash_and_keeps_tick_reporting_motion` 守这条）。
  - **30Hz 固定步长**：rAF 只负责攒时间，攒够 1/30s 才调一次 `tick()`；60Hz / 120Hz 屏上组装时长一致，也把整屏 `putImageData` 压在 150–180MB/s。`float_on` 让 `tick()` 恒返回 1，所以画面持续跑 30Hz；淡入淡出结束、切后台或退出才停。
  - **漂浮 / 散开场**：`sizeRatio` 0.55 → 2px 网格里是 1px 方块 + 1px 缝隙；`floatAmp` 0.6 / `floatPeriod` 6000ms 让每颗粒子持续漂浮。鼠标经过时 `pointer_set(x, y, 240, 7)` 打开一个径向斥力场：半径内粒子按「目标位到指针的距离」受到每帧冲量（中心最强、半径处归零），从指针下方**散开**而不是淡出，alpha 始终 255；每颗粒子再叠一点索引哈希的力度 / 切向抖动（0.55–1.45 ×、±0.35 rad），边缘因此是蓬松的云而不是整齐的环；平衡位移约 `12.5 × scatterPower × jitter` 设备 px。指针移开 / 离开窗口时 `pointer_clear()`，弹簧把它们送回目标位。粒子从未删除，所以恢复后就是原图。
  - **退出**：**点击 / 按键**才 `exit()` 淡出（`hideMs()` 读 CSS 的 0.55s）；`pointermove` 只推开 / 散开粒子、不关闭；`wheel` / `touchmove` 被 wake 层吞掉，也不关闭。第一次点击的 `click` 由 capture 监听吞掉，避免误点链接。`keydown` 只拦普通键，组合键 / F5 / F12 交给浏览器。**每页只进一次**（`done`）；切后台停表，回来重新计 10s。
  - **降级**：`html[data-pt-engine]` = `waiting` / `prewarm` / `wasm` / `floating` / `settled` / `reduced` / `error` / `save-data`。`prefers-reduced-motion` 不加载 wasm，10s 后淡入静态合成图；`saveData` 直接不进入；无 JS / wasm 失败 → 页面完全不受影响（**没有 `<img>` 兜底**，也不再付首屏 50KB 图片）。
  - **调试**：`?pt-bg=now` 跳过 10 秒等待；`html[data-pt-particles]` / `html[data-pt-block]` / `html[data-pt-size]` 记录实际粒子数、采样步长与粒子边长（2px 网格下确认没被 `maxParticles` 推粗）。
  - **旧徽标已删**：`at-bottom`、`pt-bg-ready` / `pt-bg-photo`、双击切图、`<img>` 兜底、`wipe_on` 逐行显现、`float` / `ripple` 待机都不再被站点使用。引擎里 `wipe_on` / `float_on` / `ripple_on` 仍保留（`/particles/` 目前只用 `settle()`，以后可复用）；新增的 `assemble_on` 是屏保专用。

## 测试指南

- 框架：Deno 内置 `Deno.test`，测试位于 `scripts/__tests__/*.test.ts`。
- 断言风格参考 `node:test`；共享工具在 `expect.ts` / `temp-dir.ts`。
- 新脚本须配套 `*.test.ts`；CI 通过 `.github/workflows/test-scripts.yml` 自动跑。

## 提交与 PR 规范

- 提交信息遵循 Conventional Commits，可选作用域：`chore(rename):`、`feat(seo):`、`ci(deploy):`、`chore(format):`、`chore(taxonomies):`、`docs(changelog):` 等。
- PR 目标分支为 `master`，描述需写清改动范围、关联任务，以及对 front matter / 工作流 / override 文件的潜在影响。
- 推送前跑一遍 `./bin/preflight.sh`（只读，等价于 CI 的检查；装了 `./bin/install-hooks.sh` 后 push 会自动跑）；不要提交 `public/` 或临时文件。
- **碰过 `wasm/**` 就必须重建**：推送前跑 `deno task build-wasm`（= `bin/build-wasm.sh`），把更新后的 `themes/self/assets/wasm/particles.wasm` **和指纹 `particles.sha256`** 一起提交。CI **不**构建 WASM（部署流程故意不装 Rust），所以产物完全靠手动同步，忘了就发布会陈旧的引擎（`./bin/artifacts.sh check` 就是为了在本地逮住这件事）。
- **碰过 Tailwind 源码就必须重编译**：改了 `themes/self/assets/app.css`、任何模板里的 class、甚至 `themes/self/README.md`（它也在扫描范围内），推送前跑 `deno task build-css`，把 `themes/self/assets/main.css` 与 `themes/self/assets/main.css.sha256` 一起提交。CI 不装 bun，`./bin/artifacts.sh check` 是唯一能逮住陈旧的关卡（本地有 bun 时用 `--rebuild` 做最强校验）。
- **推送前必须先检查远端是否有新提交**：`git fetch origin && git log HEAD..origin/master --oneline`；如果有新提交（例如 CI bot 的 `chore: auto-fix content` —— 它在 `deploy.yml` 里把改名的文章 / 格式化后的 Markdown 提交回来），必须先 rebase / merge 解决冲突再 push，避免推送时与远端历史分叉、需要 `--force` 才能推上去。`--force-with-lease` 仍是 rebase 后的合规选项，但**能避免就避免**。

## 操作需确认

以下动作必须先与用户确认：

- **破坏性**：删除文件 / 分支、`rm -rf`、`git reset --hard`。
- **难以撤销**：`git push --force`、修改已发布提交。
- **对外可见**：推送代码、创建 PR / issue。
- **绕过检查**：带 `--no-verify` 的命令。

具有副作用的脚本（`rename-posts`、`optimize-images` 等）务必先用 `*-dry` 任务预览。

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
