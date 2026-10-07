#!/usr/bin/env bash
#
# bin/ 下所有脚本共享的底座（只被 source，不直接执行）。
#
# 为什么有 bin/ 这个目录：CI 只负责「触发条件 + 权限 + 第三方 action + 工具链安装」，
# 所有实际逻辑都写在 bin/*.sh 里。于是 CI 与本地跑的是同一份代码，
# 不会再有「CI 会改我的文件、我本地不知道」这种漂移。
#
# 兼容 bash 3.2（macOS 自带）：没有关联数组、没有 globstar、没有 mapfile。
# 只依赖 POSIX 附近的工具（awk / sed / diff / mktemp / shasum|sha256sum）。

set -euo pipefail

BIN_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$BIN_DIR/.." && pwd)"
export REPO_ROOT BIN_DIR

# 仓库把 Deno 工具链 vendored 在 .tools/ 下（见 .gitignore），所以本机不装任何东西
# 就能跑；CI 里没有 .tools/，由 denoland/setup-deno 提供全局 deno。
# 注意 prettier 也在这个目录（.tools/deno/bin/prettier 是 deno 的 shim，本身需要 PATH 上有 deno）。
if [ -d "$REPO_ROOT/.tools/deno/bin" ]; then
  PATH="$REPO_ROOT/.tools/deno/bin:$PATH"
  export PATH
fi

# ── 构建产物布局（bin/artifacts.sh 与 bin/build-wasm.sh 共用，改路径只改这一处）──
WASM_SRC_DIR="wasm/particles"
WASM_ARTIFACT="themes/sdttttt-paper/assets/wasm/particles.wasm"
WASM_MANIFEST="themes/sdttttt-paper/assets/wasm/particles.sha256"

# ── 输出 ──
log() { printf '==> %s\n' "$*"; }
ok() { printf '  ok  %s\n' "$*"; }
warn() { printf '  ~~  %s\n' "$*"; }
fail() { printf '  XX  %s\n' "$*" >&2; }

# 打印脚本头部注释块（第一个非 # 行之前）作为用法
usage() {
  awk 'NR==1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit 0
}

# ── 环境 ──
have() { command -v "$1" >/dev/null 2>&1; }

require_cmd() {
  if have "$1"; then return 0; fi
  fail "找不到命令：$1${2:+（$2）}"
  exit 127
}

require_deno() {
  require_cmd deno "本机应有 .tools/deno/bin/deno；CI 由 denoland/setup-deno 提供"
}

# 所有命令都以仓库根为 cwd（deno task / hugo / git 都依赖它）
cd "$REPO_ROOT"

# ── 摘要 ──
sha256_of() {
  if have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  elif have sha256sum; then sha256sum "$1" | awk '{print $1}'
  else fail "缺少 shasum / sha256sum，无法计算摘要"; return 127; fi
}

sha256_stream() {
  if have shasum; then shasum -a 256 | awk '{print $1}'
  elif have sha256sum; then sha256sum | awk '{print $1}'
  else fail "缺少 shasum / sha256sum，无法计算摘要"; return 127; fi
}

# bash -n 一次只检查第一个文件（其余会被当成位置参数），所以必须逐个来
shell_syntax_check() {
  local f
  for f in "$@"; do
    if ! bash -n "$f"; then
      fail "语法检查未通过：$f"
      return 1
    fi
  done
  return 0
}

# ── 检查项累加器 ──
# 所有步骤都跑完再统一判定：一次看到全部问题，而不是修一个跑一次。
CHECK_FAILED=0

run_step() {
  local name="$1"
  shift
  log "$name"
  if "$@"; then
    ok "$name"
  else
    fail "$name"
    CHECK_FAILED=1
  fi
}

report() {
  if [ "$CHECK_FAILED" -ne 0 ]; then
    fail "$1：有检查未通过"
    exit 1
  fi
  ok "$1"
}
