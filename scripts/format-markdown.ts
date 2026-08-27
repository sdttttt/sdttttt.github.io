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

import { spawn } from 'node:child_process';
import { parseArgs, getBoolean, type ParsedArgs } from './lib/args.js';

/**
 * 构造 prettier 子进程参数（数组形式而非 shell 字符串，避免 pattern 被 shell 解释）。
 * 导出供测试覆盖参数解析逻辑。
 *
 * - `--check` → prettier --check 模式
 * - 默认      → prettier --write 模式
 * - pattern 固定为全部 .md
 */
export function buildCommand(args: ParsedArgs): string[] {
  const check = getBoolean(args, 'check');
  const sub = check ? '--check' : '--write';
  return ['prettier', sub, '**/*.md'];
}

if (import.meta.main) {
  const args = parseArgs(process.argv);
  const cmdArgs = buildCommand(args);

  // 走 spawn 数组形式而不是 execSync+shell：避免 glob pattern 被 shell 提前展开，
  // 同时退出码能精确透传（prettier --check 命中未格式化文件返回非零 → 退出1）。
  const child = spawn(cmdArgs[0]!, cmdArgs.slice(1), {
    stdio: 'inherit',
    shell: false,
  });

  child.on('error', (err) => {
    console.error(`prettier 启动失败: ${err.message}`);
    process.exit(127);
  });
  child.on('close', (exit) => {
    process.exit(exit ?? 1);
  });
}
