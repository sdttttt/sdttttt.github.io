#!/usr/bin/env bun
/**
 * 将 content/posts/ 下的文章批量重命名为 YYYY-MM-DD.md
 *
 * - 日期取自 frontmatter `date` 字段（真实日历校验，与 validate-posts 共用判据）
 * - 文件名只有日期，**不含标题与 hash**：标题在 front matter 里，URL 里本来也不可见
 * - 同一天多篇时按（时刻 → title → 内容 hash）排序：首篇占 YYYY-MM-DD.md，
 *   其余依次 YYYY-MM-DD-2.md、-3…（最多一天 16 篇也够用）；排序键全部取自内容、
 *   与当前文件名无关，保证一次改名后规则稳定、不会互换名字
 * - 改名会把旧 URL 追加进该篇 front matter 的 `aliases`，由 Hugo 生成跳转页
 *   保住旧链接（幂等，不会重复追加）
 *
 * 用法：
 *   bun run rename-posts-dry                # 预览计划
 *   bun run rename-posts-check              # 只读门禁（有待改文件即退出 1）
 *   bun run rename-posts                    # 实际执行
 *
 * 注意：脚本会尝试使用 `git mv` 以保留 git 重命名历史，若不在 git 仓库则降级为 rename。
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseFrontMatter, extractFrontMatterBlock, checkTitleAndDate, toYyyyMmDd, timePart } from './lib/frontmatter.ts';
import { parseArgs, getBoolean } from './lib/args.ts';
import { listPostFiles, POSTS_DIR } from './lib/paths.ts';

const args = parseArgs(process.argv);
const dryRun =
  getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun') || getBoolean(args, 'check');
// --check：只读门禁。不改一个文件（因此隐含 dry-run），但「有待改文件」本身就是失败
// （退出码 1），用来在 CI / pre-push 里断言「本地内容 == CI 会产出的内容」。
const check = getBoolean(args, 'check');
const verbose = getBoolean(args, 'verbose');

// ─────────────────────────────────────────────────────────────
// 计划 / 跳过 / 报告
// ─────────────────────────────────────────────────────────────

export interface RenamePlan {
  oldPath: string;
  newPath: string;
  oldSlug: string;
  newSlug: string;
  /** `YYYY-MM-DD`（同日多篇时 newSlug 带 -2/-3 后缀） */
  date: string;
  title: string;
  oldUrl: string; // 例如 "/posts/2026081705hog4/" 用于写入 aliases
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
 *   时也能识别；数组再长一点，Prettier 还会把方括号内部也拆成多行，同样能识别）
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

  // Prettier 会把过长的 inline 数组折成 `aliases:` + 缩进的 `["...", "..."]`；
  // 再长一点它会把 `[` 与 `]` 也各占一行、末项带尾逗号。两种都要认：漏到下面的
  // 块式分支会插出 `aliases:` + `- "…"` + `[ … ]` 这种非法 YAML（下次改名 = Hugo 构建失败）。
  const indented = block.match(/^(aliases:[ \t]*\n[ \t]*\[)([\s\S]*?)(\][ \t]*)$/m);
  // 追加后统一压成一行，交给 Prettier 决定要不要重新折行（两种形态都能再认回来）
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

  // 先扫一遍：合法文章收集日期/时刻/标题，非法的进 skipped
  interface ValidPost {
    file: string;
    oldPath: string;
    date: string; // YYYY-MM-DD
    time: string; // 当天时刻（可能为空）
    title: string;
    /** 内容 hash：time/title 都相同时的最终排序键，与文件名无关（见下） */
    key: string;
  }
  const valid: ValidPost[] = [];

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

    valid.push({
      file: f,
      oldPath,
      date: toYyyyMmDd(meta.date)!,
      time: timePart(meta.date),
      title: String(meta.title),
      key: createHash('sha256').update(raw).digest('hex').slice(0, 16),
    });
  }

  // 按日期分组，组内按（时刻 → title → 内容 hash → 旧文件名）排序后编号：
  // 首篇占 YYYY-MM-DD.md，其余 YYYY-MM-DD-2.md、-3…
  // 排序键全部由内容决定、与「当前文件名」无关 —— 用文件名当排序键会让
  // 后缀改变排序结果，首跑改名后规则翻转、两篇互换名字无限循环
  // （2021-01-14 两篇 Composition Api 实测踩过，findBlockingCollisions 挡住没丢数据）。
  const byDate = new Map<string, ValidPost[]>();
  for (const p of valid) {
    const list = byDate.get(p.date) ?? [];
    list.push(p);
    byDate.set(p.date, list);
  }

  for (const [date, group] of byDate) {
    group.sort(
      (a, b) =>
        (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) ||
        a.title.localeCompare(b.title, 'zh') ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
        a.file.localeCompare(b.file),
    );

    group.forEach((p, i) => {
      const newSlug = i === 0 ? date : `${date}-${i + 1}`;
      const newName = `${newSlug}.md`;
      const newPath = join(POSTS_DIR, newName);

      if (newName === p.file) {
        skipped.push({ file: p.file, reason: '已是新格式' });
        return;
      }

      const oldSlug = basename(p.file, '.md');
      plans.push({
        oldPath: p.oldPath,
        newPath,
        oldSlug,
        newSlug,
        date,
        title: p.title,
        oldUrl: oldUrlFromSlug(oldSlug),
      });
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
    console.log(`    alias: ${p.oldUrl}`);
  }
}

async function main(): Promise<void> {
  const { plans, skipped, files } = await buildReport();

  if (skipped.length > 0) {
    // 明细只给 --verbose：正常情况（本地 / CI）里 225 篇「已是新格式」会把日志淹掉
    if (verbose) {
      console.log(`跳过 ${skipped.length} 篇：`);
      for (const s of skipped) {
        console.log(`  ${s.file}: ${s.reason}`);
      }
      console.log('');
    } else {
      console.log(`跳过 ${skipped.length} 篇（已是新格式 / 缺 date 等，加 --verbose 看明细）`);
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
    console.error(`✗ 检测到 ${collisions.size} 个目标名冲突，无法继续：`);
    for (const [name, list] of collisions) {
      console.error(`  ${name}:`);
      for (const p of list) {
        console.error(`    - ${basename(p.oldPath)} (date ${p.date})`);
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
    console.error(`✗ --check：有 ${plans.length} 篇文章的文件名不符合规范（跑 bun run rename-posts 修复）`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
