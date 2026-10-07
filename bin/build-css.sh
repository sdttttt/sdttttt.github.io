#!/usr/bin/env bash
#
# 编译 Tailwind → 写回主题 → 更新指纹文件。
#
#   ./bin/build-css.sh        等价于 deno task build-css
#
# 为什么需要它：`themes/self/assets/main.css` 是 Tailwind v4 的编译产物，Hugo 只做
# concat + minify + fingerprint（themes/self/layouts/partials/head.html），不会重编译。
# 合并主题时上游的 package.json / bun.lock / postcss.config.mjs 被一并删掉了，产物于是
# 变成「只能手改」的化石 —— 2026-10-07 恢复：以后改样式只改 assets/app.css（或模板里的类），
# 然后跑这条命令，别手改 main.css。
#
# 为什么 bun.lock 必须一起 vendor、且必须 --frozen-lockfile：产物对 postcss-preset-env 的
# 传递依赖（@csstools/*）版本敏感 —— 不钉死 lockfile 会重新解析出更新的 patch 版本，
# 同一份 app.css 编出不同字节（实测 `#0000` 变成 `rgba(0,0,0,0)`）。所以 lockfile 原样
# 从上游搬来，连用不上的 prettier devDeps 也一起留着（删掉就要重写 lockfile）。
#
# 为什么还要指纹文件：CI 不装 bun（`themes/self/assets/main.css.sha256`），
# 靠它把「改了 app.css / 模板却没重编译」变可见（同 wasm 的做法，见 bin/build-wasm.sh）。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd bun "需要 bun（brew install bun）；CI 不装 bun，产物与指纹一起提交"

log "bun install --frozen-lockfile（在 ${CSS_THEME_DIR}/）"
(cd "$REPO_ROOT/$CSS_THEME_DIR" && bun install --frozen-lockfile)

log "postcss assets/app.css -o assets/main.css"
(cd "$REPO_ROOT/$CSS_THEME_DIR" && ./node_modules/.bin/postcss assets/app.css -o assets/main.css)
ok "产物已更新：${CSS_ARTIFACT}（$(wc -c <"$REPO_ROOT/$CSS_ARTIFACT" | tr -d ' ') 字节）"

"$BIN_DIR/artifacts.sh" stamp-css

warn "记得把产物与指纹一起提交：git add $CSS_ARTIFACT $CSS_MANIFEST"
