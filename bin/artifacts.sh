#!/usr/bin/env bash
#
# 构建产物与源码是否对得上（preflight 的第 ⑤ 步）。
#
# 用法：
#   ./bin/artifacts.sh check              校验（默认）
#   ./bin/artifacts.sh check --rebuild    额外用 cargo 重编译一次并逐字节比对（最严，需要几秒）
#   ./bin/artifacts.sh stamp              重新记录 wasm 指纹（bin/build-wasm.sh 会调它）
#
# 检查三件事：
#   1. 每张 assets/src/bg/ 下的原图都有对应的 static/bg/*.avif 产物。
#      缺了就是真会出事：CI 不跑图片转换（见 AGENTS.md），发布出去的就是缺图。
#   2. static/ 里没有「源图已删」的孤儿产物 —— 左下角徽标靠 readDir static/bg 发现背景，
#      孤儿会让它去加载一张不该存在的图。这条只警告不失败（旧产物不影响正确性）。
#   3. wasm 产物与 wasm/particles/ 的源码一致。CI 故意不装 Rust（不能重编译），
#      所以「改了 lib.rs 却没重建产物」在 CI 里本来是完全不可见的 ——
#      靠 particles.sha256 这份指纹文件（源文件 + 产物各自的 sha256）把它变得可见。
#      有 Rust 工具链时可用 --rebuild 做最强校验（真编译出来逐字节比）。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

BG_SRC_DIR="assets/src/bg"
BG_OUT_DIR="static/bg"
AVATAR_SRC="assets/src/avatar/avatar.jpg"
AVATAR_OUT="static/avatar.webp"

TMP_MANIFEST="$(mktemp)"
TMP_DIFF="$(mktemp)"
TMP_TARGET="$(mktemp -d)"
trap 'rm -rf "$TMP_MANIFEST" "$TMP_DIFF" "$TMP_TARGET"' EXIT

# 参与指纹的源文件（相对仓库根，字母序固定）。新增源文件会自动进来 ——
# 但 stamp 一次之后才会被记录，这正是「改了源码没重建」能被发现的原因。
wasm_sources() {
  printf '%s\n' "$WASM_SRC_DIR/Cargo.lock" "$WASM_SRC_DIR/Cargo.toml" "$WASM_SRC_DIR"/src/*.rs
}

# 生成指纹内容到 $1。产物放第一行，方便一眼看出「这份记录陪的是哪颗 wasm」。
write_manifest() {
  local out="$1" f
  : >"$out"
  printf '%s  %s\n' "$(sha256_of "$REPO_ROOT/$WASM_ARTIFACT")" "$WASM_ARTIFACT" >>"$out"
  while IFS= read -r f; do
    printf '%s  %s\n' "$(sha256_of "$REPO_ROOT/$f")" "$f" >>"$out"
  done < <(wasm_sources)
}

check_images() {
  local bad=0 src base out found ext
  for src in "$BG_SRC_DIR"/*; do
    [ -e "$src" ] || continue
    base="$(basename "${src%.*}")"
    out="$BG_OUT_DIR/$base.avif"
    if [ ! -f "$out" ]; then
      fail "源图缺少发布产物：$src → $out 不存在"
      fail "  跑 deno task optimize-images 并提交产物；若这张图不该发布，请移出 $BG_SRC_DIR/"
      bad=1
      continue
    fi
    if [ "$src" -nt "$out" ]; then
      warn "$src 比 $out 新 —— 产物可能是旧的（跑 deno task optimize-images）"
    fi
  done

  if [ -f "$AVATAR_SRC" ] && [ ! -f "$AVATAR_OUT" ]; then
    fail "缺少头像产物：${AVATAR_OUT}（跑 deno task optimize-images）"
    bad=1
  fi

  for out in "$BG_OUT_DIR"/*; do
    [ -e "$out" ] || continue
    base="$(basename "${out%.*}")"
    found=0
    for ext in .png .jpg .jpeg; do
      if [ -f "$BG_SRC_DIR/$base$ext" ]; then
        found=1
        break
      fi
    done
    if [ "$found" -eq 0 ]; then
      warn "孤儿产物：$out 没有对应的源图（徽标会把它当成一张背景）"
    fi
  done

  return "$bad"
}

check_wasm() {
  local bad=0
  if [ ! -f "$WASM_ARTIFACT" ]; then
    fail "缺少 wasm 产物：${WASM_ARTIFACT}（跑 deno task build-wasm）"
    return 1
  fi
  if [ ! -f "$WASM_MANIFEST" ]; then
    fail "缺少 wasm 指纹：${WASM_MANIFEST}（跑 deno task build-wasm 生成）"
    return 1
  fi

  write_manifest "$TMP_MANIFEST"
  if diff -u --label "记录（particles.sha256）" --label "现在（工作区）" "$WASM_MANIFEST" "$TMP_MANIFEST" >"$TMP_DIFF"; then
    ok "wasm 产物与源码一致（$(wc -c <"$WASM_ARTIFACT" | tr -d ' ') 字节）"
  else
    fail "wasm 产物与源码不一致（- 记录 / + 现在）："
    cat "$TMP_DIFF" >&2
    fail "  改了 wasm/particles/** 就必须跑 deno task build-wasm 并提交产物与指纹（CI 不构建 wasm）"
    bad=1
  fi

  if [ "$REBUILD" = 1 ]; then
    require_cmd cargo "重编译校验需要 Rust 工具链"
    log "cargo build --release --target wasm32-unknown-unknown（校验用，输出到临时目录）"
    if (cd "$WASM_SRC_DIR" && CARGO_TARGET_DIR="$TMP_TARGET" cargo build --release --target wasm32-unknown-unknown); then
      if cmp -s "$TMP_TARGET/wasm32-unknown-unknown/release/particles.wasm" "$WASM_ARTIFACT"; then
        ok "重编译复现：产物逐字节一致"
      else
        fail "重编译产物与提交的 $WASM_ARTIFACT 不一致"
        bad=1
      fi
    else
      fail "重编译失败"
      bad=1
    fi
  fi

  return "$bad"
}

REBUILD=0
case "${1:-check}" in
check | stamp | "") ;;
*) fail "未知子命令：${1}（check | stamp）"; exit 2 ;;
esac

if [ "${1:-check}" = stamp ]; then
  write_manifest "$REPO_ROOT/$WASM_MANIFEST"
  ok "指纹已更新：${WASM_MANIFEST}（$(wc -l <"$REPO_ROOT/$WASM_MANIFEST" | tr -d ' ') 条）"
  exit 0
fi

shift || true
while [ $# -gt 0 ]; do
  case "$1" in
  --rebuild) REBUILD=1 ;;
  *)
    fail "未知参数：$1"
    exit 2
    ;;
  esac
  shift
done

BAD=0
log "① 图片产物"
if check_images; then ok "图片产物齐全"; else fail "图片产物不齐"; BAD=1; fi
log "② wasm 产物"
if check_wasm; then ok "wasm 产物新鲜"; else fail "wasm 产物不新鲜"; BAD=1; fi
if [ "$BAD" -ne 0 ]; then exit 1; fi
ok "构建产物检查通过"
