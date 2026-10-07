#!/usr/bin/env bash
#
# 生产构建到 public/（CI 的 deploy.yml 与本地都调它）。
#
#   ./bin/build.sh            等价于 hugo --minify
#   ./bin/build.sh --gc       额外参数会透传给 hugo
#
# 本地调试用 hugo server -D（含草稿）；这个脚本是「CI 构建的那一份」，
# 所以它故意不带任何本地预览参数。
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd hugo "本地需 hugo 0.161.1 extended；CI 由 peaceiris/actions-hugo 安装"
exec hugo --minify "$@"
