#!/usr/bin/env bun
/**
 * 格式化 Markdown 文件
 *
 * 依赖：需要全局安装 prettier（npm install -g prettier）
 *
 * 用法：
 *   bun scripts/format-markdown.ts          # 格式化所有 .md
 *   bun scripts/format-markdown.ts --check  # 只检查，不写入
 */

import { execSync } from 'node:child_process';
import { parseArgs, getBoolean } from './lib/args';

const args = parseArgs(process.argv);
const check = getBoolean(args, 'check');

const patterns = ['"**/*.md"'];
const cmd = ['prettier', check ? '--check' : '--write', ...patterns];

try {
  execSync(cmd.join(' '), { stdio: 'inherit', shell: true });
} catch {
  // prettier --check 发现未格式化文件时会返回非零退出码
  process.exit(1);
}
