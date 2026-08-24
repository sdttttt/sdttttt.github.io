#!/usr/bin/env deno
/**
 * 自动 git add / commit / push
 *
 * 用法：
 *   deno run -A scripts/git-commit-push.ts --message "style: auto-format markdown"
 *   deno run -A scripts/git-commit-push.ts --message "feat: xxx" --dry-run
 *
 * 自动 commit message 分类（仅当 staged 内容来自 deploy.yml 的 auto-fix 流水线时生效）：
 *   - 全部是 rename → chore(rename): sync post slug
 *   - 全部是新增/删除 posts → chore(posts): add/remove
 *   - 全部是新增/删除 cover → chore(covers): add/remove
 *   - 全部是 markdown 格式化（无文件增减、仅内容微调）→ chore(format): prettier
 *   - 全部是 frontmatter 字段新增/删除（仅 YAML 块变化）→ chore(fm): inject frontmatter
 *   - 混合或无法识别 → 回退到 --message-fallback 或 --message
 */

import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs, getString, getBoolean } from './lib/args.js';
import { gitExec, gitExecArgs, gitHasStagedChanges, setupBotIdentity } from './lib/git.js';

/**
 * 仅当作为 CLI 直接运行时执行顶层逻辑，被 import 时只暴露分类函数给测试用。
 */
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const args = parseArgs(process.argv);
  const message = getString(args, 'message') ?? getString(args, 'm');
  const fallback = getString(args, 'message-fallback') ?? getString(args, 'messageFallback') ?? message;
  const dryRun = getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun');

  if (!message) {
    console.error(
      'Usage: deno run -A scripts/git-commit-push.ts --message "commit message" [--message-fallback "..."] [--dry-run]',
    );
    process.exit(1);
  }

  setupBotIdentity({ dryRun });
  gitExec('add -A', { dryRun });

  if (!gitHasStagedChanges()) {
    console.log('No changes to commit');
    process.exit(0);
  }

  const classified = classifyStagedChanges();
  const finalMessage = classified ?? fallback ?? message;

  if (classified) {
    console.log(`[auto-classify] ${classified}`);
  } else {
    console.log(`[fallback] ${finalMessage}`);
  }

  // 用 spawn 数组参数提交 commit，避开 shell 解释（commit message 含
  // 用户输入，不能用 gitExec 拼字符串）。dry-run 也走同一条路径仅打印。
  await gitExecArgs(['commit', '-m', finalMessage], { dryRun });
  // 兜底：吸收运行期间出现的远端新提交，避免 push 被拒
  gitExec('pull --rebase', { dryRun });
  gitExec('push', { dryRun });
}

// ---------- 分类逻辑 ----------

interface DiffEntry {
  /** R / A / D / M —— git diff --name-status 的第一个字符 */
  kind: 'R' | 'A' | 'D' | 'M';
  /** 旧路径（rename 时有值） */
  oldPath?: string;
  /** 新路径 */
  newPath: string;
}

/**
 * 读取 staged 变更列表。使用 -M20% 让 git 在小改动下也能识别 rename，
 * 符合 rename-posts.js 的实际场景（只改文件名后缀，body 微调）。
 */
function readStagedEntries(): DiffEntry[] {
  let raw: string;
  try {
    raw = execSync('git diff --cached --name-status -z -M20%', { encoding: 'utf8' });
  } catch {
    return [];
  }
  if (!raw) return [];

  // -z 输出用 \0 分隔记录，rename 是 "R<score>\0OLD\0NEW" 三段，普通是 "K\0PATH" 两段
  const parts = raw.split('\0').filter(Boolean);
  const entries: DiffEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const header = parts[i]!;
    if (header.startsWith('R')) {
      const oldPath = parts[i + 1]!;
      const newPath = parts[i + 2]!;
      entries.push({ kind: 'R', oldPath, newPath });
      i += 2;
    } else {
      const path = parts[i + 1]!;
      entries.push({ kind: header[0] as DiffEntry['kind'], newPath: path });
      i += 1;
    }
  }
  return entries;
}

/**
 * 判断一个 M 修改是不是只动了 frontmatter（YAML 块）。
 * 思路：拿 staged 版本和 HEAD 版本做 diff，如果 diff 完全落在 frontmatter 范围内，
 *       就认为是 frontmatter-only 修改（gen-covers inject-fm 的典型场景）。
 */
function isFrontmatterOnlyChange(path: string): boolean {
  let staged: string;
  let head: string;
  try {
    staged = execSync(`git show ":${path}"`, { encoding: 'utf8' });
    head = execSync(`git show "HEAD:${path}"`, { encoding: 'utf8' });
  } catch {
    return false;
  }
  if (staged === head) return false;

  // 找出 frontmatter 边界（首个 --- 行到第二个 --- 行）
  function fmEnd(content: string): number {
    // 第二个 --- 行的起始位置
    const m = content.match(/^---\n[\s\S]*?\n---(\n|$)/m);
    return m ? m.index! + m[0].length : -1;
  }

  const stagedFmEnd = fmEnd(staged);
  const headFmEnd = fmEnd(head);
  if (stagedFmEnd < 0 || headFmEnd < 0) return false;

  // body 部分必须完全一致
  if (staged.slice(stagedFmEnd) !== head.slice(headFmEnd)) return false;

  // frontmatter 部分必须有变化
  if (staged.slice(0, stagedFmEnd) === head.slice(0, headFmEnd)) return false;

  return true;
}

function isPost(p: string): boolean {
  return p.startsWith('content/posts/');
}
function isCover(p: string): boolean {
  return p.startsWith('static/images/covers/');
}
function isMarkdown(p: string): boolean {
  return p.endsWith('.md');
}
function isSvg(p: string): boolean {
  return p.endsWith('.svg');
}

/**
 * 尝试根据 staged 内容自动产出 commit message。
 * 返回 null 表示无法分类，调用方应使用 fallback。
 */
export function classifyStagedChanges(): string | null {
  const entries = readStagedEntries();
  if (entries.length === 0) return null;

  const total = entries.length;
  const renames = entries.filter((e) => e.kind === 'R');
  const adds = entries.filter((e) => e.kind === 'A');
  const dels = entries.filter((e) => e.kind === 'D');
  const mods = entries.filter((e) => e.kind === 'M');

  // 1) 全部是 rename（典型场景：rename-posts.js 跑完后的 hash 漂移）
  if (renames.length === total) {
    const allPosts = renames.every((r) => isPost(r.oldPath!) && isPost(r.newPath));
    if (allPosts) return `chore(rename): sync post slugs (${renames.length} files)`;
    return `chore(rename): rename ${renames.length} files`;
  }

  // 2) 只改 markdown（M）+ 没有 A/D/R —— 可能是 prettier 格式化
  //    先按"纯 frontmatter 修改"精确判断（gen-covers inject-fm 的典型场景），
  //    不满足则退回 "prettier" 文案。
  if (mods.length === total && mods.every((m) => isMarkdown(m.newPath))) {
    let allFmOnly = mods.every((m) => isFrontmatterOnlyChange(m.newPath));
    if (allFmOnly) {
      return `chore(fm): inject frontmatter (${total} files)`;
    }
    return `chore(format): prettier markdown (${total} files)`;
  }

  // 3) 只新增/删除 cover svg（同步孤儿封面清理）
  const onlyCoverIO =
    adds.length + dels.length === total &&
    adds.every((a) => isCover(a.newPath) && isSvg(a.newPath)) &&
    dels.every((d) => isCover(d.newPath) && isSvg(d.newPath));
  if (onlyCoverIO) {
    const parts: string[] = [];
    if (adds.length) parts.push(`+${adds.length}`);
    if (dels.length) parts.push(`-${dels.length}`);
    return `chore(covers): ${parts.join('/')} cover image${total > 1 ? 's' : ''}`;
  }

  // 4) 只新增/删除 posts（极少发生，AI 创建/删除文章时）
  const onlyPostIO =
    adds.length + dels.length === total &&
    adds.every((a) => isPost(a.newPath) && isMarkdown(a.newPath)) &&
    dels.every((d) => isPost(d.newPath) && isMarkdown(d.newPath));
  if (onlyPostIO) {
    const parts: string[] = [];
    if (adds.length) parts.push(`+${adds.length}`);
    if (dels.length) parts.push(`-${dels.length}`);
    return `chore(posts): ${parts.join('/')} post${total > 1 ? 's' : ''}`;
  }

  // 兜底：返回 null 让调用方用 fallback
  return null;
}
