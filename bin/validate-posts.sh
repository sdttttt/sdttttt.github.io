#!/usr/bin/env bash
#
# front matter 校验（CI 的 validate-posts.yml 与本地都调它）。
#
#   ./bin/validate-posts.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_deno
exec deno task validate-posts
