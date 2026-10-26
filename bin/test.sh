#!/usr/bin/env bash
#
# 类型检查（tsc）+ 单元测试（vitest）+ shell 脚本语法检查（CI 的 test-scripts.yml 与本地都调它）。
#
#   ./bin/test.sh
#
# 为什么顺手检查 bin/*.sh 的语法：这些脚本是 CI 真正在跑的东西，坏掉的代价是
# 「部署才发现」。bash -n 只花毫秒级，而它必须在**两种 bash** 下都成立 ——
# 本地是 macOS 自带的 3.2，CI 是 ubuntu 的 5.x。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_node
require_pnpm
require_node_modules

shopt -s nullglob
shells=("$BIN_DIR"/*.sh "$BIN_DIR"/hooks/*)
shopt -u nullglob

run_step "① shell 语法检查（${#shells[@]} 个文件）" shell_syntax_check "${shells[@]}"
run_step "② 类型检查（tsc --noEmit）" pnpm run typecheck
run_step "③ 单元测试（vitest）" pnpm run test

report "测试通过"
