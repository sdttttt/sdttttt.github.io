#!/usr/bin/env deno
/**
 * 格式化 Markdown 文件
 *
 * 依赖：需要全局安装 prettier（`deno install -g -A npm:prettier@3.9.6`，wrapper 落在 `~/.deno/bin/`）
 *
 * 用法：
 *   deno task format-markdown          # 格式化所有 .md
 *   deno task format-markdown-check    # 只检查，不写入
 */

import { execSync } from 'node:child_process';
import { parseArgs, getBoolean, type ParsedArgs } from './lib/args.js';

/**
 * 构造 prettier 命令。导出供测试覆盖参数解析逻辑。
 *
 * - `--check` → prettier --check 模式
 * - 默认      → prettier --write 模式
 * - pattern 固定为全部 .md
 */
export function buildCommand(args: ParsedArgs): string {
  const check = getBoolean(args, 'check');
  const sub = check ? '--check' : '--write';
  return `prettier ${sub} "**/*.md"`;
}

if (import.meta.main) {
  const args = parseArgs(process.argv);
  const cmd = buildCommand(args);
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';

  try {
    execSync(cmd, { stdio: 'inherit', shell });
  } catch {
    // prettier --check 发现未格式化文件时会返回非零退出码
    process.exit(1);
  }
}
