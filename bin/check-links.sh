#!/usr/bin/env bash
#
# 死链检查（CI 的 check-dead-links.yml 与本地都调它）。
#
#   ./bin/check-links.sh          本地：有死链时退出码 1（方便你马上看见并修）
#   ./bin/check-links.sh --soft   退出码恒 0，只报告（前身是 CI 里的 `|| true`）
#   ./bin/check-links.sh --strict 强制退出码 1（即使在 CI 里）
#
# 403 / 429 / 451 一类「服务器把我们挡在门外」的链接由脚本单独归类，不算死链、
# 也不影响退出码 —— 判据见 scripts/check-dead-links.ts 的 BLOCKED_STATUSES。
#
# 在 CI 里（GITHUB_ACTIONS 非空）默认 --soft：外链会抖（临时 5xx / 反爬），
# 死链不该阻塞部署。但不能像以前那样 `|| true` 一吞了事 ——
# 那样 2026-10-05 发现的 9 张失效外链图在日志里毫无痕迹。所以这里会写
# ::warning:: 注解 + job summary，仍然留痕，只是不失败。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

STRICT=1
if [ -n "${GITHUB_ACTIONS:-}" ]; then STRICT=0; fi

for arg in "$@"; do
  case "$arg" in
  --strict) STRICT=1 ;;
  --soft) STRICT=0 ;;
  -h | --help) usage ;;
  *)
    fail "未知参数：${arg}（-h 看用法）"
    exit 2
    ;;
  esac
done

require_deno

set +e
output="$(deno task check-dead-links 2>&1)"
status=$?
set -e
printf '%s\n' "$output"

if [ "$status" -eq 0 ]; then
  ok "未发现失效外链"
  # 被拦住的链接不算死链，但仍让它们露个面：否则「未发现失效外链」会被
  # 误读成「全都验证过了」，而这批链接其实一次都没验证成功。
  case "$output" in
  *没能验证*)
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      {
        printf '## ℹ️ 死链检查：未发现失效外链\n\n'
        printf '这些链接被服务器拦住了（403/429/451 等），没能验证，不算死链：\n\n'
        printf '```\n%s\n```\n' "$output"
      } >>"$GITHUB_STEP_SUMMARY"
      ok "已写入 job summary（被拦住的链接）"
    fi
    ;;
  esac
  exit 0
fi

warn "发现失效外链（详见上方日志）"

if [ -n "${GITHUB_ACTIONS:-}" ]; then
  printf '::warning title=死链检查::发现失效外链（不阻塞部署），详见上方日志与 job summary\n'
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '## ⚠️ 死链检查发现失效外链\n\n'
    printf '不阻塞部署（外链会抖），但需要人工看一眼：\n\n'
    printf '```\n%s\n```\n' "$output"
  } >>"$GITHUB_STEP_SUMMARY"
  ok "已写入 job summary"
fi

if [ "$STRICT" = 1 ]; then
  fail "check-links 失败（--strict）"
  exit 1
fi
exit 0
