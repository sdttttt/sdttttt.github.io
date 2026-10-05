#!/usr/bin/env deno
/**
 * 将 content/posts/ 下的文章批量重命名为 YYYYMMDD-{slug}-{xxx}.md
 *
 * - 日期取自 frontmatter `date` 字段
 * - slug 由 frontmatter `title` 自动 slugify（保留中文 unicode）
 * - 3 位 hash 是 body 内容的 SHA-256 前 2 字节（16 bit → base36）
 *   用于兜底去重，绝大多数情况下文件名长度 = `YYYYMMDD-slug-XXX`
 * - 因为 hash 取自正文，**任何正文改动都会让文件名（也就是 URL）变化**，所以
 *   每次改名都会把旧 URL 追加进该篇 front matter 的 `aliases`，由 Hugo 生成跳转页
 *   保住旧链接（幂等，不会重复追加）
 *
 * 用法：
 *   deno run -A scripts/rename-posts.ts --dry-run --verbose   # 预览计划
 *   deno task rename-posts                                     # 实际执行
 *
 * 注意：脚本会尝试使用 `git mv` 以保留 git 重命名历史，若不在 git 仓库则降级为 rename。
 */

import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseFrontMatter, extractFrontMatterBlock } from './lib/frontmatter.js';
import { parseArgs, getBoolean } from './lib/args.js';
import { POSTS_DIR } from './lib/paths.js';

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
 *
 * 块以 `\n---` 结尾（不含尾部换行），后面紧跟的换行是 frontmatter 与
 * 正文之间的分隔符，一并跳掉，避免正文开头出现多余的空行。
 */
export function extractBody(raw: string): string {
  const block = extractFrontMatterBlock(raw);
  if (!block) return raw;
  let body = raw.slice(block.length);
  if (body.startsWith('\n')) body = body.slice(1);
  return body;
}

/**
 * body 内容 → 3 位 base36 hash（16 bit）。
 * SHA-256 前 2 字节 → 16-bit unsigned int → base36。
 *
 * 作为 `YYYYMMDD-slug-XXX.md` 末尾的去重后缀。
 * 16 bit 在 220+ 篇文章规模下冲突概率 ~0.1%，可接受。
 */
export function computeHash3(body: string): string {
  const buf = createHash('sha256').update(body).digest();
  // 取前 2 字节作为 16-bit unsigned int（大端）
  const n = ((buf[0]! << 8) | buf[1]!) >>> 0;
  return n.toString(36).padStart(3, '0');
}

/**
 * 把 title 转成 URL/文件名安全的 slug。
 *
 * 规则：
 * - 保留中文字符（CJK unicode），Hugo 原生支持 unicode 段
 * - ASCII 部分：保留字母/数字/连字符，其余替换为 `-`
 * - 合并连续连字符
 * - 去掉首尾连字符
 * - 长度上限 80 字符（避免文件名/URL 过长）
 * - 空字符串兜底返回 `'untitled'`
 */
export function slugify(title: string): string {
  const MAX = 80;
  let s = title.trim();
  // 替换所有非保留字符为连字符
  // 保留：CJK 字符（U+4E00-U+9FFF, U+3400-U+4DBF, U+3040-U+30FF, U+AC00-U+D7AF）+ 拉丁字母数字 + 连字符
  s = s.replace(/[^\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AFa-zA-Z0-9-]+/g, '-');
  // 合并连续连字符
  s = s.replace(/-+/g, '-');
  // 去掉首尾连字符
  s = s.replace(/^-+|-+$/g, '');
  // 长度上限（按字符数而非字节数；中文每个算 1 字符）
  if (s.length > MAX) s = s.slice(0, MAX).replace(/-+$/, '');
  return s || 'untitled';
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
  hash3: string;
  title: string;
  oldUrl: string; // 例如 "/posts/2026081705hog4/" 用于写入 aliases
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

/**
 * 从 oldSlug 推导旧 URL。
 *
 * Hugo 的 URL 就是文件名去掉扩展名（再按 Hugo 默认的 disablePathToLower=false
 * 全部小写化），所以两种格式要分开处理：
 *   - 当前格式 `YYYYMMDD-slug-XXX` → 原样保留连字符 `/posts/YYYYMMDD-slug-XXX/`
 *   - 历史格式 `YYYYMMDDhash`（可能带旧版方括号 `20260805[057m5q]`）
 *     → 去掉方括号 `/posts/YYYYMMDDhash/`
 *
 * ⚠️ 早期实现无条件 `replace(/[\[\]-]/g, '')`，会把当前格式的连字符也删掉，
 * 生成一个线上并不存在的 URL（alias 形同虚设）；用 `-` 是否出现来区分两种格式。
 * 另：URL 一律小写（中文字符不受影响），别写 `20200406-MultiplexingIO-13q` 这种。
 */
export function oldUrlFromSlug(oldSlug: string): string {
  const segment = oldSlug.includes('-') ? oldSlug : oldSlug.replace(/[\[\]]/g, '');
  return `/posts/${segment.toLowerCase()}/`;
}

/** 拆开 inline 数组 `["/a/", "/b/"]` 的内容，保留各项原始引号 */
function splitInlineArray(inner: string): string[] {
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 把旧 URL 追加进 front matter 的 `aliases`，返回新的文件内容（幂等）。
 *
 * - 已有 `aliases: ["/a/"]`：追加一项（Prettier 折叠成 `aliases:` + 缩进的 `[...]`
 *   时也能识别）
 * - 已有 YAML 块式 `aliases:` + `  - /a/`：在该行后插一行
 * - 完全没有 `aliases`：在 front matter 末尾新建
 * - 该 URL 已存在 / 没有 front matter：原样返回
 */
export function addAlias(raw: string, url: string): string {
  const block = extractFrontMatterBlock(raw);
  if (!block) return raw;
  if (block.includes(url)) return raw;

  const inline = block.match(/^aliases:[ \t]*\[(.*)\][ \t]*$/m);
  if (inline) {
    const items = splitInlineArray(inline[1]!);
    const next = `aliases: [${[...items, JSON.stringify(url)].join(', ')}]`;
    return raw.replace(block, () => block.replace(inline[0]!, next));
  }

  // Prettier 会把过长的 inline 数组折成 `aliases:` + 缩进的 `["...", "..."]`
  const indented = block.match(/^(aliases:[ \t]*\n[ \t]+\[)(.*)(\][ \t]*)$/m);
  if (indented) {
    const items = splitInlineArray(indented[2]!);
    const next = `${indented[1]}${[...items, JSON.stringify(url)].join(', ')}${indented[3]}`;
    return raw.replace(block, () => block.replace(indented[0]!, next));
  }

  const anchor = block.match(/^aliases:[ \t]*(?:\n[ \t]+-[^\n]*)*/m);
  if (anchor) {
    const next = `${anchor[0]}\n  - ${JSON.stringify(url)}`;
    return raw.replace(block, () => block.replace(anchor[0]!, next));
  }

  const lines = block.split('\n');
  lines.splice(lines.length - 1, 0, `aliases: [${JSON.stringify(url)}]`);
  return raw.replace(block, () => lines.join('\n'));
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

    const title = typeof meta.title === 'string' ? meta.title : '';
    if (!title) {
      skipped.push({ file: f, reason: '缺少 title 字段' });
      continue;
    }

    const body = extractBody(raw);
    const slug = slugify(title);
    const hash3 = computeHash3(body);
    const newSlug = `${yyyymmdd}-${slug}-${hash3}`;
    const newName = `${newSlug}.md`;
    const newPath = join(POSTS_DIR, newName);

    if (newName === f) {
      skipped.push({ file: f, reason: '已是新格式' });
      continue;
    }

    const oldSlug = basename(f, '.md');

    plans.push({
      oldPath,
      newPath,
      oldSlug,
      newSlug,
      yyyymmdd,
      hash3,
      title,
      oldUrl: oldUrlFromSlug(oldSlug),
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
 * 用 child_process.spawn 数组参数形式避免 shell 转义问题。
 */
async function moveFile(oldPath: string, newPath: string): Promise<{ usedGit: boolean }> {
  const { ok } = await runGit(['mv', oldPath, newPath]);
  if (ok) return { usedGit: true };
  await rename(oldPath, newPath);
  return { usedGit: false };
}

/**
 * 跑 git 子命令，捕获退出码。不可用/失败时返回 ok=false。
 */
async function runGit(args: string[]): Promise<{ ok: boolean; exit: number }> {
  try {
    const exit = await new Promise<number>((resolve) => {
      const child = spawn('git', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.on('close', resolve);
    });
    return { ok: exit === 0, exit };
  } catch {
    return { ok: false, exit: -1 };
  }
}

export async function executePlan(plan: RenamePlan): Promise<void> {
  // 先读原文（改名前），改名后把旧 URL 写进新文件的 aliases
  const raw = await readFile(plan.oldPath, 'utf8');
  await moveFile(plan.oldPath, plan.newPath);
  const updated = addAlias(raw, plan.oldUrl);
  if (updated !== raw) {
    await writeFile(plan.newPath, updated, 'utf8');
    // 让 index 与工作区保持一致：deploy 随后直接 git commit，
    // 不 add 会留下未暂存的 front matter 改动
    await runGit(['add', plan.newPath]);
  }
}

// ─────────────────────────────────────────────────────────────
// 报告输出 / 入口
// ─────────────────────────────────────────────────────────────

function printPlan(p: RenamePlan, prefix: string): void {
  console.log(`  ${basename(p.oldPath)}`);
  console.log(`    → ${basename(p.newPath)}`);
  if (verbose) {
    console.log(`    title: ${p.title}`);
    console.log(`    hash:  ${p.hash3} (body ${p.body.length} chars)`);
    console.log(`    alias: ${p.oldUrl}`);
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
        console.error(`    - ${basename(p.oldPath)} (hash ${p.hash3})`);
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
