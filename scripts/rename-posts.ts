#!/usr/bin/env deno
/**
 * 将 content/posts/ 下的文章批量重命名为 YYYYMMDD-{slug}-{xxx}.md
 *
 * - 日期取自 frontmatter `date` 字段
 * - slug 由 frontmatter `title` 自动 slugify（保留中文 unicode）
 * - hash 是 body 内容的 SHA-256 前 2 字节（16 bit → base36，3–4 位）
 *   用于兜底去重，绝大多数情况下文件名长度 = `YYYYMMDD-slug-XXX`
 * - 因为 hash 取自正文，**任何正文改动都会让文件名（也就是 URL）变化**，所以
 *   每次改名都会把旧 URL 追加进该篇 front matter 的 `aliases`，由 Hugo 生成跳转页
 *   保住旧链接（幂等，不会重复追加）
 *
 * 用法：
 *   deno run -A scripts/rename-posts.ts --dry-run --verbose   # 预览计划
 *   deno run -A scripts/rename-posts.ts --check               # 只读门禁（有待改文件即退出 1）
 *   deno task rename-posts                                     # 实际执行
 *
 * 注意：脚本会尝试使用 `git mv` 以保留 git 重命名历史，若不在 git 仓库则降级为 rename。
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseFrontMatter, extractFrontMatterBlock, checkTitleAndDate, toYyyymmdd } from './lib/frontmatter.js';
import { parseArgs, getBoolean } from './lib/args.js';
import { listPostFiles, POSTS_DIR } from './lib/paths.js';

const args = parseArgs(process.argv);
const dryRun =
  getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun') || getBoolean(args, 'check');
// --check：只读门禁。不改一个文件（因此隐含 dry-run），但「有待改文件」本身就是失败
// （退出码 1），用来在 CI / pre-push 里断言「本地内容 == CI 会产出的内容」。
const check = getBoolean(args, 'check');
const verbose = getBoolean(args, 'verbose');

// ─────────────────────────────────────────────────────────────
// 纯函数
// ─────────────────────────────────────────────────────────────

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
 * body 内容 → base36 hash（16 bit）。
 * SHA-256 前 2 字节 → 16-bit unsigned int → base36，`padStart(3)` 保证至少 3 位；
 * 46656 以上会到 4 位，所以文件名后缀是 **3 或 4 位**（实测 169 篇 3 位、56 篇 4 位）。
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
  /** content/posts 下现存的全部文章文件名（含不会改名的），执行前用它查覆盖 */
  files: string[];
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
  const files = await listPostFiles();

  const plans: RenamePlan[] = [];
  const skipped: SkipEntry[] = [];

  for (const f of files) {
    const oldPath = join(POSTS_DIR, f);
    const raw = await readFile(oldPath, 'utf8');
    const meta = parseFrontMatter(raw);

    // 判据与措辞与 validate-posts 共用一份（checkTitleAndDate），避免两边漂移
    const problems = checkTitleAndDate(meta);
    if (problems.length > 0) {
      for (const reason of problems) skipped.push({ file: f, reason });
      continue;
    }

    const yyyymmdd = toYyyymmdd(meta.date)!;
    const title = String(meta.title);
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

  return { plans, skipped, files };
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
 *
 * ⚠️ 环境里没装 git 时 `spawn` 是以 **'error' 事件**失败的，不是在 await 上抛出：
 * 旧版只监听 'close'，于是 `spawn git ENOENT` 变成 uncaught error 直接终止整个进程，
 * 外层 try/catch 完全拦不住 —— 与 moveFile 声明的「没 git 就降级 fs.rename」正好相反。
 */
async function runGit(args: string[]): Promise<{ ok: boolean; exit: number }> {
  const exit = await new Promise<number>((resolve) => {
    const child = spawn('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', () => resolve(-1));
    child.on('close', resolve);
    // 两个管道必须消费：不读的话 git 输出一多就会把子进程堵在写缓冲上
    child.stdout?.resume();
    child.stderr?.resume();
  });
  return { ok: exit === 0, exit };
}

/**
 * 找出「照 plan 直接改名会覆盖现存文件」的目标名。
 *
 * `detectCollisions()` 只比对 plans 之间的 newName，漏掉两种会真丢数据的形态：
 * ① 某篇的 newName 撞上一个**本次不挪走**的现存文件（例如它已被跳过、留在原地）；
 * ② 两篇互换名字（A: foo→bar、B: bar→foo）或成链（A→B 的旧名、B→C…）。
 * 这两种情况下执行顺序决定成败：先执行的那个 `git mv` 会因「目标已存在」失败，
 * 随后降级到 `fs.rename`（覆盖式）就把另一篇**静默吃掉**。
 *
 * 这里一律保守地报错，交给人工处理（当前仓库里不会出现这种局面）。
 *
 * @param plans         本次改名计划
 * @param existingFiles content/posts 下现存的全部文件名
 * @returns newName → 会撞上的旧文件名列表（空 Map 表示安全）
 */
export function findBlockingCollisions(
  plans: RenamePlan[],
  existingFiles: readonly string[],
): Map<string, string[]> {
  const existing = new Set(existingFiles);
  const blockers = new Map<string, string[]>();

  for (const p of plans) {
    const name = basename(p.newPath);
    const oldName = basename(p.oldPath);
    if (name === oldName || !existing.has(name)) continue;
    const list = blockers.get(name) ?? [];
    list.push(oldName);
    blockers.set(name, list);
  }

  return blockers;
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

function printPlan(p: RenamePlan): void {
  console.log(`  ${basename(p.oldPath)}`);
  console.log(`    → ${basename(p.newPath)}`);
  if (verbose) {
    console.log(`    title: ${p.title}`);
    console.log(`    hash:  ${p.hash3} (body ${p.body.length} chars)`);
    console.log(`    alias: ${p.oldUrl}`);
  }
}

async function main(): Promise<void> {
  const { plans, skipped, files } = await buildReport();

  if (skipped.length > 0) {
    // --check 是门禁模式（pre-push hook / CI），不值得为「已是新格式」刷 200 行日志
    if (check && !verbose) {
      console.log(`跳过 ${skipped.length} 篇（已是新格式 / 缺 date 等，加 --verbose 看明细）`);
    } else {
      console.log(`跳过 ${skipped.length} 篇：`);
      for (const s of skipped) {
        console.log(`  ${s.file}: ${s.reason}`);
      }
      console.log('');
    }
  }

  if (plans.length === 0) {
    console.log('✓ 0 篇文章需要重命名');
    return;
  }

  // 覆盖检查：目标名已被现存文件占用（执行顺序一旦不利就会静默覆盖那篇）
  const blocking = findBlockingCollisions(plans, files);
  if (blocking.size > 0) {
    console.error(`✗ 有 ${blocking.size} 个目标文件名已被现存文件占用，直接改会覆盖它们：`);
    for (const [name, olds] of blocking) {
      console.error(`  ${name}  ← ${olds.join(', ')}`);
    }
    console.error('请先手工处理这些文件（改名或删除）再重跑。');
    process.exit(1);
  }

  // 碰撞检测（plans 之间同名）
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

  const tag = check ? '--check：需要' : dryRun ? '[dry-run] 计划' : '完成';
  console.log(`${tag}重命名 ${plans.length} 篇文章${dryRun ? '：' : ''}`);
  if (!dryRun) {
    for (const p of plans) {
      if (verbose) {
        console.log(`  ${basename(p.oldPath)} → ${basename(p.newPath)}`);
      }
      await executePlan(p);
    }
    console.log(`✓ 重命名 ${plans.length} 篇文章成功`);
    return;
  }

  for (const p of plans) {
    printPlan(p);
  }

  if (check) {
    console.error(`✗ --check：有 ${plans.length} 篇文章的文件名不符合规范（跑 deno task rename-posts 修复）`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
