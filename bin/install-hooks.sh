#!/usr/bin/env bash
#
# 把 bin/hooks/ 装成这个仓库的 git hooks（core.hooksPath），于是「本地跑同一套检查」
# 不需要任何额外工具：
#
#   pre-commit   跑 preflight --fix --re-stage：提交前把文章文件名 / Markdown 格式
#                就地规范好并重新入 index
#   pre-push     跑 preflight --check：push 前只读校验，别让 CI 替你改文件
#
# 用法：
#   ./bin/install-hooks.sh              装上
#   ./bin/install-hooks.sh --uninstall  卸掉（恢复 git 默认的 .git/hooks）
#
# 为什么用 core.hooksPath 而不是往 .git/hooks 里拷脚本：hooks 因此是**版本化**文件，
# 改动跟着仓库走，升级 / 回滚不用重装。
# 绕过 hook 用 `git commit --no-verify` —— AGENTS.md 里属于需要确认的动作。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd git "hooks 依赖 git"

if [ "${1:-}" = "--uninstall" ]; then
  git config --unset core.hooksPath || true
  ok "已恢复默认 hooks 路径（.git/hooks），bin/hooks/ 不再生效"
  exit 0
fi

chmod +x "$BIN_DIR"/hooks/*
git config core.hooksPath bin/hooks

ok "已启用 core.hooksPath = bin/hooks"
printf '  pre-commit  %s\n' "$BIN_DIR/hooks/pre-commit"
printf '  pre-push    %s\n' "$BIN_DIR/hooks/pre-push"
warn "hooks 会在 commit / push 时自动触发；想手动跑同一套检查：./bin/preflight.sh"
