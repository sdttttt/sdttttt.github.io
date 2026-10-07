#!/usr/bin/env bash
#
# 把 CI 里 preflight --fix 改出来的差异提交回仓库（deploy.yml 的最后一步）。
#
#   ./bin/publish-autofix.sh          在 CI 里跑（需要 GITHUB_ACTIONS 非空）
#   ./bin/publish-autofix.sh --force  明确允许本地跑（会真的 commit + push）
#
# 为什么需要它：CI 里的 preflight 会改文件（文件改名 / Markdown 格式化）。
# 这些改动如果只留在 runner 上，下一次 push 就会和远端历史分叉
# —— `b68a395`（225 个文件改名）之后要 `51aa901` 补 25 篇 aliases，就是这类事故。
#
# 为什么本地要挡一道：同一条命令在本地跑会把你的工作区直接 commit 掉并 push。
# 而且本地跑它没有意义 —— pre-commit hook（bin/install-hooks.sh）已经保证
# 「提交进去的就是规范化过的内容」，不会产生需要 CI 回填的差异。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

case "${1:-}" in
--force) ;;
"") ;;
-h | --help) usage ;;
*)
  fail "未知参数：$1（-h 看用法）"
  exit 2
  ;;
esac

if [ -z "${GITHUB_ACTIONS:-}" ] && [ "${1:-}" != "--force" ]; then
  fail "这个脚本是 CI 专用的：它会把工作区直接 commit 并 push"
  warn "本地要的就是「提交时就已经规范化」，那由 pre-commit hook 负责："
  warn "  ./bin/install-hooks.sh        # 装一次，之后 commit / push 自动跑 preflight"
  warn "确实要在这里跑（例如复现 CI 行为）：./bin/publish-autofix.sh --force"
  exit 2
fi

require_cmd git "提交回填需要 git"

if [ -z "$(git status --porcelain)" ]; then
  ok "没有需要提交的改动"
  exit 0
fi

log "把 preflight 的修复结果提交回仓库"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -A
git commit -m "chore: auto-fix content"
git pull --rebase
git push
ok "已推送 chore: auto-fix content"
