#!/usr/bin/env bash
#
# 编译粒子引擎 → 同步到主题 assets/wasm/ → 更新指纹文件。
#
#   ./bin/build-wasm.sh        等价于 deno task build-wasm
#
# 需要 Rust 工具链（rustup target add wasm32-unknown-unknown）。CI 故意不装 Rust，
# 所以这一步永远在本地跑，产物 + 指纹一起提交（见 AGENTS.md）。
#
# 为什么多出一个指纹文件：`themes/self/assets/wasm/particles.sha256`
# 记录「源码摘要 + 产物摘要」，让没有 cargo 的 CI 也能发现「改了 lib.rs 却没重建」
# —— 否则这类陈旧会一路发布出去（2026-10-06 就承诺过 CI 不构建 wasm，
# 那这个承诺的代价必须由检查来还）。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd cargo "需要 Rust 工具链（rustup target add wasm32-unknown-unknown）"

log "cargo build --release --target wasm32-unknown-unknown"
(cd "$REPO_ROOT/$WASM_SRC_DIR" && cargo build --release --target wasm32-unknown-unknown)

cp "$REPO_ROOT/$WASM_SRC_DIR/target/wasm32-unknown-unknown/release/particles.wasm" "$REPO_ROOT/$WASM_ARTIFACT"
chmod 644 "$REPO_ROOT/$WASM_ARTIFACT"
ok "产物已更新：${WASM_ARTIFACT}（$(wc -c <"$REPO_ROOT/$WASM_ARTIFACT" | tr -d ' ') 字节）"

"$BIN_DIR/artifacts.sh" stamp-wasm

warn "记得把产物与指纹一起提交：git add $WASM_ARTIFACT $WASM_MANIFEST"
