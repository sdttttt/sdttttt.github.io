#!/usr/bin/env deno
/**
 * 格式化 Markdown 文件
 *
 * 依赖：需要全局安装 prettier（npm install -g prettier）
 *
 * 用法：
 *   deno task format-markdown          # 格式化所有 .md
 *   deno task format-markdown-check    # 只检查，不写入
 */

import { execSync } from 'node:child_process';
import { parseArgs, getBoolean } from './lib/args.js';

const args = parseArgs(process.argv);
const check = getBoolean(args, 'check');

const patterns = ['"**/*.md"'];
const cmd = ['prettier', check ? '--check' : '--write', ...patterns];
const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';

try {
  execSync(cmd.join(' '), { stdio: 'inherit', shell });
} catch {
  // prettier --check 发现未格式化文件时会返回非零退出码
  process.exit(1);
}
