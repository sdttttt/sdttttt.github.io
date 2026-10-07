#!/usr/bin/env bash
#
# 规范化 + 校验，一次跑完。CI 的部署流程与本地（手跑 / pre-commit hook）用的是同一个文件。
#
# 用法：
#   ./bin/preflight.sh             只读检查（默认，不改任何文件）
#   ./bin/preflight.sh --fix       CI 用：先按规则修复，再校验
#   ./bin/preflight.sh --fix --re-stage
#                                  pre-commit 用：修复后把改动重新 git add
#   ./bin/preflight.sh -h          看用法
#
# 退出码：0 通过 / 1 有检查未通过 / 2 参数错 / 127 缺工具
#
# 五个步骤（即原来散在 deploy.yml 里的那几步）：
#   ① 文章文件名   YYYYMMDD-slug-hash。hash 取自正文，所以任何正文改动都会改 URL，
#                  改名时脚本会把旧 URL 追加进该篇的 aliases（幂等）
#   ② Markdown     prettier（版本由 CI 与本地共用，见 AGENTS.md）
#   ③ front matter 必填字段与 slug 冲突
#   ④ 单元测试     deno test
#   ⑤ 构建产物     图片产物是否齐全 + wasm 产物是否与源码一致（bin/artifacts.sh）
#
# 为什么 --check 是默认：CI 里修复是必须的（它要把改动提交回来），但人手动跑这个
# 脚本时，静默改掉自己的工作区很吓人；所以 CI 明确写 --fix。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

MODE=check
RE_STAGE=0
for arg in "$@"; do
  case "$arg" in
  --check) MODE=check ;;
  --fix) MODE=fix ;;
  --re-stage) RE_STAGE=1 ;;
  -h | --help) usage ;;
  *)
    fail "未知参数：${arg}（-h 看用法）"
    exit 2
    ;;
  esac
done

require_deno

if [ "$MODE" = fix ]; then
  run_step "① 文章文件名（修复）" deno task rename-posts
  run_step "② Markdown 格式（修复）" deno task format-markdown
else
  run_step "① 文章文件名" deno task rename-posts-check
  run_step "② Markdown 格式" deno task format-markdown-check
fi
run_step "③ front matter 校验" deno task validate-posts
run_step "④ 单元测试" deno task test
run_step "⑤ 构建产物新鲜度" "$BIN_DIR/artifacts.sh" check

if [ "$CHECK_FAILED" -ne 0 ]; then
  fail "preflight 未通过（${MODE}）：先修掉上面标 XX 的问题"
  exit 1
fi
ok "preflight 通过（${MODE}）"

if [ "$MODE" = fix ]; then
  changed="$(git status --porcelain -- '*.md' 2>/dev/null || true)"
  if [ -n "$changed" ]; then
    if [ "$RE_STAGE" = 1 ]; then
      git add -A -- '*.md'
      ok "已把修复结果重新加入 index"
    fi
    warn "工作区里的 Markdown 改动（含 preflight 的修复）："
    printf '%s\n' "$changed"
    if [ "$RE_STAGE" = 0 ]; then
      warn "CI 会把它们提交回来（chore: auto-fix content）；本地请自己提交"
    fi
  fi
fi
