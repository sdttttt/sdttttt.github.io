#!/usr/bin/env bun
/**
 * 将 content/posts/ 下的文章批量重命名为 YYYYMMDD[xxxxxx].md
 *
 * - 日期取自 frontmatter `date` 字段
 * - 6 位 hash 是 body 内容的 SHA-256 前 3 字节（24 bit → base36）
 * - 文件名中方括号 `[]` 是字面字符
 * - 配套封面 static/images/covers/{oldSlug}.svg 同步重命名
 * - frontmatter 中 cover.image 引用同步更新
 *
 * 用法：
 *   bun scripts/rename-posts.ts --dry-run --verbose   # 预览计划
 *   bun scripts/rename-posts.ts                       # 实际执行
 *
 * 注意：脚本会尝试使用 `git mv` 以保留 git 重命名历史，若不在 git 仓库则降级为 rename。
 */

import { readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { parseFrontMatter, extractFrontMatterBlock } from './lib/frontmatter';
import { parseArgs, getBoolean } from './lib/args';

const POSTS_DIR = 'content/posts';
const COVERS_DIR = 'static/images/covers';

const args = parseArgs(process.argv);
const dryRun = getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun');
const verbose = getBoolean(args, 'verbose') || getBoolean(args, 'v');

// ─────────────────────────────────────────────────────────────
// 纯函数
// ─────────────────────────────────────────────────────────────

/**
 * 把 frontmatter 中的 date 字段归一为 YYYYMMDD。
 * 支持 `2025-05-04`、`"2022-11-08"`（已 unquote）、`2020-05-09T13:00:00Z` 等。
 * 解析失败返回 null。
 */
export function normalizeDate(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const yyyy = m[1]!;
  const mm = m[2]!.padStart(2, '0');
  const dd = m[3]!.padStart(2, '0');
  // 简单健全性检查
  if (Number(mm) < 1 || Number(mm) > 12) return null;
  if (Number(dd) < 1 || Number(dd) > 31) return null;
  return `${yyyy}${mm}${dd}`;
}

/**
 * 去掉开头的 frontmatter 块，返回剩余正文。
 * 没有 frontmatter 时返回原文。
 */
export function extractBody(raw: string): string {
  const block = extractFrontMatterBlock(raw);
  if (!block) return raw;
  return raw.slice(block.length);
}

/**
 * body 内容 → 6 位 base36 hash（24 bit）。
 * 使用 node:crypto 的 SHA-256，取前 3 字节。
 * 选 SHA-256 是因为它是行业标准、对任意输入分布均匀、便于审计。
 */
export function computeHash6(body: string): string {
  const buf = createHash('sha256').update(body).digest();
  // 取前 3 字节作为 24-bit unsigned int（大端）
  const n = ((buf[0]! << 16) | (buf[1]! << 8) | buf[2]!) >>> 0;
  return n.toString(36).padStart(6, '0');
}

/**
 * 精确改写 frontmatter 中 `cover.image` 那一行。
 * 仅在调用方已确认 raw 中包含精确路径时使用。
 */
export function rewriteCoverImage(raw: string, oldSlug: string, newSlug: string): string {
  const oldPath = `images/covers/${oldSlug}.svg`;
  const newPath = `images/covers/${newSlug}.svg`;
  return raw.replace(oldPath, newPath);
}

/** 文件是否存在 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface CoverUpdate {
  oldCoverPath: string; // 物理路径
  newCoverPath: string;
  newImageField: string; // 写入 frontmatter 的值（不含引号包裹）
}

/**
 * 决策是否要重命名配套封面。
 * 仅在 cover.image 形如 `images/covers/{oldSlug}.svg` 且物理文件存在时返回。
 * 其他情况（用户自定义封面路径、外链、封面缺失）一律返回 null。
 */
export async function computeCoverUpdate(
  meta: ReturnType<typeof parseFrontMatter>,
  oldSlug: string,
  newSlug: string,
): Promise<CoverUpdate | null> {
  const cover = meta.cover as Record<string, unknown> | undefined;
  const image = cover?.image;
  if (typeof image !== 'string') return null;

  const expected = `images/covers/${oldSlug}.svg`;
  if (image !== expected) return null; // 用户自定义了别的封面路径，不动

  const oldCoverPath = join(COVERS_DIR, `${oldSlug}.svg`);
  if (!(await exists(oldCoverPath))) return null;

  return {
    oldCoverPath,
    newCoverPath: join(COVERS_DIR, `${newSlug}.svg`),
    newImageField: `images/covers/${newSlug}.svg`,
  };
}

// ─────────────────────────────────────────────────────────────
// 计划 / 跳过 / 报告
// ─────────────────────────────────────────────────────────────

export interface RenamePlan {
  oldPath: string;
  newPath: string;
  oldSlug: string;
  newSlug: string;
  yyyymmdd: string;
  hash6: string;
  cover: CoverUpdate | null;
  body: string; // 用于 verbose 输出
}

export interface SkipEntry {
  file: string;
  reason: string;
}

export interface Report {
  plans: RenamePlan[];
  skipped: SkipEntry[];
}

export async function buildReport(): Promise<Report> {
  const entries = await readdir(POSTS_DIR);
  const files = entries.filter((f) => f.endsWith('.md') && f !== '_index.md');

  const plans: RenamePlan[] = [];
  const skipped: SkipEntry[] = [];

  for (const f of files) {
    const oldPath = join(POSTS_DIR, f);
    const raw = await readFile(oldPath, 'utf8');
    const meta = parseFrontMatter(raw);

    const yyyymmdd = normalizeDate(meta.date);
    if (!yyyymmdd) {
      skipped.push({
        file: f,
        reason: !meta.date ? '缺少 date 字段' : `date 格式无效: ${String(meta.date)}`,
      });
      continue;
    }

    const body = extractBody(raw);
    const hash6 = computeHash6(body);
    const newName = `${yyyymmdd}[${hash6}].md`;
    const newPath = join(POSTS_DIR, newName);

    if (newName === f) {
      skipped.push({ file: f, reason: '已是新格式' });
      continue;
    }

    const oldSlug = basename(f, '.md');
    const newSlug = basename(newName, '.md');
    const cover = await computeCoverUpdate(meta, oldSlug, newSlug);

    plans.push({
      oldPath,
      newPath,
      oldSlug,
      newSlug,
      yyyymmdd,
      hash6,
      cover,
      body,
    });
  }

  return { plans, skipped };
}

/** 碰撞检测：plans 中 newName 不应重复 */
export function detectCollisions(plans: RenamePlan[]): Map<string, RenamePlan[]> {
  const map = new Map<string, RenamePlan[]>();
  for (const p of plans) {
    const name = basename(p.newPath);
    const list = map.get(name) ?? [];
    list.push(p);
    map.set(name, list);
  }
  const collisions = new Map<string, RenamePlan[]>();
  for (const [name, list] of map) {
    if (list.length > 1) collisions.set(name, list);
  }
  return collisions;
}

// ─────────────────────────────────────────────────────────────
// 执行层
// ─────────────────────────────────────────────────────────────

/**
 * 执行 rename。优先 `git mv` 以保留历史；失败/非 git 仓库时降级为 fs.rename。
 * 用 Bun.spawn 数组参数形式避免 shell 转义问题。
 */
async function moveFile(oldPath: string, newPath: string): Promise<{ usedGit: boolean }> {
  const { ok } = await runGit(['mv', oldPath, newPath]);
  if (ok) return { usedGit: true };
  await rename(oldPath, newPath);
  return { usedGit: false };
}

/**
 * 同步 index 与 working tree。
 *
 * 关键：tracked 文件 `writeFile` 只会改 working tree，**index 不会自动更新**。
 * 如果不 `git add`，下一步 `git mv` 会把 index 里的**旧内容**搬到新路径，
 * commit 时拿到的就是「新路径 + 旧内容」（历史上的 bug）。
 *
 * 不可用时静默返回 false，由调用方自行决定是否降级。
 */
async function gitAdd(path: string): Promise<boolean> {
  const { ok } = await runGit(['add', path]);
  return ok;
}

/**
 * 跑 git 子命令，捕获退出码。不可用/失败时返回 ok=false。
 */
async function runGit(args: string[]): Promise<{ ok: boolean; exit: number }> {
  try {
    const proc = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
    const exit = await proc.exited;
    return { ok: exit === 0, exit };
  } catch {
    return { ok: false, exit: -1 };
  }
}

export async function executePlan(plan: RenamePlan): Promise<void> {
  // 1) 改写 frontmatter（如果 cover 需要更新）
  if (plan.cover) {
    const raw = await readFile(plan.oldPath, 'utf8');
    const updated = rewriteCoverImage(raw, plan.oldSlug, plan.newSlug);
    await writeFile(plan.oldPath, updated);
    // 关键：让 index 知道 OLD 路径有新内容，下一步 git mv 才会搬新内容
    await gitAdd(plan.oldPath);
  }
  // 2) mv .md
  await moveFile(plan.oldPath, plan.newPath);
  // 3) mv cover SVG（独立路径，不存在 index 同步问题）
  if (plan.cover) {
    await moveFile(plan.cover.oldCoverPath, plan.cover.newCoverPath);
  }
}

// ─────────────────────────────────────────────────────────────
// 报告输出 / 入口
// ─────────────────────────────────────────────────────────────

function printPlan(p: RenamePlan, prefix: string): void {
  console.log(`  ${basename(p.oldPath)}`);
  console.log(`    → ${basename(p.newPath)}`);
  if (verbose) {
    console.log(`    hash: ${p.hash6} (body ${p.body.length} chars)`);
  }
  if (p.cover) {
    console.log(
      `    封面: ${basename(p.cover.oldCoverPath)} → ${basename(p.cover.newCoverPath)}`,
    );
  }
}

async function main(): Promise<void> {
  const { plans, skipped } = await buildReport();

  if (skipped.length > 0) {
    console.log(`跳过 ${skipped.length} 篇：`);
    for (const s of skipped) {
      console.log(`  ${s.file}: ${s.reason}`);
    }
    console.log('');
  }

  if (plans.length === 0) {
    console.log('✓ 0 篇文章需要重命名');
    return;
  }

  // 碰撞检测
  const collisions = detectCollisions(plans);
  if (collisions.size > 0) {
    console.error(`✗ 检测到 ${collisions.size} 个哈希冲突，无法继续：`);
    for (const [name, list] of collisions) {
      console.error(`  ${name}:`);
      for (const p of list) {
        console.error(`    - ${basename(p.oldPath)} (hash ${p.hash6})`);
      }
    }
    process.exit(1);
  }

  const tag = dryRun ? '[dry-run] 计划' : '完成';
  console.log(`${tag}重命名 ${plans.length} 篇文章${dryRun ? '：' : ''}`);
  if (dryRun) {
    for (const p of plans) {
      printPlan(p, '  ');
    }
  } else {
    for (const p of plans) {
      if (verbose) {
        console.log(`  ${basename(p.oldPath)} → ${basename(p.newPath)}`);
      }
      await executePlan(p);
    }
    console.log(`✓ 重命名 ${plans.length} 篇文章成功`);
  }
}

if (import.meta.main) {
  await main();
}
