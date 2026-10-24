#!/usr/bin/env bash
#
# 生成 UnoCSS 产物 → 写回主题 → 更新指纹文件。
#
#   ./bin/build-css.sh        等价于 deno task build-css
#
# 为什么需要它：`themes/self/assets/uno.css` 是 `unocss` CLI 扫 `layouts/**/*.html`
# 生成的（reset + 主题变量 + typography + 工具类），Hugo 只做
# concat + minify + fingerprint（themes/self/layouts/partials/head.html），不会生成样式。
# 手写的两组样式不走这条管线：assets/app.css（主题规则）与 assets/custom.css（站点自有），
# 它们由 Hugo 在 head.html 里跟在 uno.css 后面 concat。
#
# 为什么不用 PostCSS：2026-10-24 起去掉。@unocss/postcss 只是把同一份生成器包进
# PostCSS 管线，而它会把 @property 的描述符漏进普通规则体、主题变量顺序还会抖（要额外写
# 排序插件才能过指纹）；unocss CLI 原生按序输出，连跑多次逐字节一致。代价是 @apply 不再
# 可用（它只有 bundler 插件 / postcss 插件能解析），主题规则改写成了普通 CSS。
#
# 为什么 bun.lock 必须一起 vendor、且必须 --frozen-lockfile：生成结果对 unocss 与其传递
# 依赖的版本敏感，不钉死 lockfile 会重新解析出更新的 patch 版本，同一份模板编出不同字节。
#
# 为什么还要指纹文件：CI 不装 bun（`themes/self/assets/uno.css.sha256`），
# 靠它把「改了模板 / app.css 却没重新生成」变可见（同 wasm 的做法，见 bin/build-wasm.sh）。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd bun "需要 bun（brew install bun）；CI 不装 bun，产物与指纹一起提交"

log "bun install --frozen-lockfile（在 ${CSS_THEME_DIR}/）"
(cd "$REPO_ROOT/$CSS_THEME_DIR" && bun install --frozen-lockfile)

log "unocss 'layouts/**/*.html' -o assets/uno.css"
(cd "$REPO_ROOT/$CSS_THEME_DIR" && ./node_modules/.bin/unocss 'layouts/**/*.html' -o "./assets/uno.css")
ok "产物已更新：${CSS_ARTIFACT}（$(wc -c <"$REPO_ROOT/$CSS_ARTIFACT" | tr -d ' ') 字节）"

"$BIN_DIR/artifacts.sh" stamp-css

warn "记得把产物与指纹一起提交：git add $CSS_ARTIFACT $CSS_MANIFEST"
