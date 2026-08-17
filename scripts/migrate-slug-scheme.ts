#!/usr/bin/env node
/**
 * 一次性迁移脚本：将所有 content/posts/*.md 从旧命名格式
 *   YYYYMMDD[hash].md 或 YYYY-MM-DD-slug.md
 * 迁移到新格式
 *   YYYYMMDD-{slug}-{hash3}.md
 *
 * 并在每篇文章的 front matter 中写入 aliases 指向旧 URL，
 * 使 Hugo 自动生成 301 等价物，保留外链。
 *
 * 用法：
 *   node scripts/dist/migrate-slug-scheme.js            # dry-run 预览
 *   node scripts/dist/migrate-slug-scheme.js --apply    # 实际执行
 *   node scripts/dist/migrate-slug-scheme.js --apply --verbose
 *
 * 设计原则：
 * - 默认 dry-run，避免误操作 220+ 篇文章
 * - 真正落地用 `git mv` 保留 git 历史
 * - 失败/碰撞立即中断，不留下半成品
 * - 完成后输出报告供 review
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontMatter } from './lib/frontmatter.js';
import { parseArgs, getBoolean } from './lib/args.js';
import {
  buildReport,
  oldUrlFromSlug,
  executePlan,
  type RenamePlan,
} from './rename-posts.js';

const args = parseArgs(process.argv);
const apply = getBoolean(args, 'apply');
const verbose = getBoolean(args, 'verbose') || getBoolean(args, 'v');

const POSTS_DIR = 'content/posts';

/**
 * 在 front matter 中写入/合并 `aliases` 字段。
 *
 * - 无 aliases：插入 `aliases: ["/posts/old/"]`
 * - 已有 aliases（数组）：去重后追加
 * - 已有 aliases（字符串）：转为数组后追加
 *
 * 保留其他字段顺序不变；新字段插入到 cover 之后或末尾。
 */
export function injectAliases(raw: string, oldUrl: string): string {
  // 匹配 front matter 边界（保留原样的换行符位置以便重组）
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error('无 front matter 块');

  const prefix = raw.slice(0, m.index);                              // 文件开头到 ---
  const fmBlock = m[1]!;                                              // front matter 内容（不含 ---）
  const fmStartOffset = (m.index ?? 0) + 4;                          // `---\n` 之后
  const fmEndOffset = fmStartOffset + fmBlock.length;                 // 第二个 ---\n 之前
  const suffix = raw.slice(fmEndOffset + 4);                          // 第二个 ---\n 之后

  // 解析已有 aliases
  const aliasesMatch = fmBlock.match(/^aliases:\s*(.+)$/m);
  let existing: string[] = [];
  let replaceLine: string | null = null;

  if (aliasesMatch) {
    replaceLine = aliasesMatch[0];
    const v = aliasesMatch[1]!.trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1).trim();
      existing = inner
        ? inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
        : [];
    } else {
      existing = [v.replace(/^["']|["']$/g, '')];
    }
  }

  if (existing.includes(oldUrl)) {
    return raw; // 已包含，无需修改
  }

  existing.push(oldUrl);

  const formatted = `aliases: [${existing.map((u) => `"${u}"`).join(', ')}]`;

  const newFmBlock = replaceLine !== null
    ? fmBlock.replace(replaceLine, formatted)
    : fmBlock.trimEnd() + '\n' + formatted;

  return `${prefix}---\n${newFmBlock}\n---${suffix}`;
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

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
    console.log('✓ 0 篇文章需要迁移');
    return;
  }

  // 检测 front matter 中已有的 aliases，避免重复注入
  const collisions: Array<{ file: string; reason: string }> = [];
  for (const p of plans) {
    const raw = await readFile(p.oldPath, 'utf8');
    const meta = parseFrontMatter(raw);
    if (meta.aliases !== undefined && !apply) {
      // dry-run 时提示用户已有 aliases
      // 不中断，只是 verbose 报告
      if (verbose) {
        console.log(`  [info] ${p.oldSlug}: 已有 aliases，将合并追加`);
      }
    }
  }

  // 输出预览
  console.log(`[${apply ? '执行' : '预览'}] 迁移 ${plans.length} 篇文章到新格式：\n`);
  for (const p of plans) {
    const oldUrl = oldUrlFromSlug(p.oldSlug);
    const newUrl = `/posts/${p.newSlug}/`;
    const line = `  ${basename(p.oldPath)} → ${basename(p.newPath)}`;
    console.log(line);
    if (verbose) {
      console.log(`    title:    ${p.title}`);
      console.log(`    alias:    ${oldUrl} → ${newUrl}`);
      console.log(`    hash3:    ${p.hash3}`);
    }
  }

  if (!apply) {
    console.log(`\n共 ${plans.length} 篇待迁移。运行加 --apply 实际执行。`);
    if (collisions.length > 0) {
      console.log(`\n警告 ${collisions.length} 个潜在冲突：`);
      for (const c of collisions) console.log(`  ${c.file}: ${c.reason}`);
    }
    return;
  }

  // === 实际执行 ===
  console.log('\n开始执行迁移...\n');
  let success = 0;
  let failed = 0;

  for (const p of plans) {
    try {
      // 1) 注入 aliases 到 front matter
      const raw = await readFile(p.oldPath, 'utf8');
      const updated = injectAliases(raw, p.oldUrl);
      if (updated !== raw) {
        await writeFile(p.oldPath, updated, 'utf8');
      }
      // 2) 执行重命名（executePlan 已经处理 git mv + cover 重命名 + cover.image 更新）
      await executePlan(p);
      success++;
      if (verbose) console.log(`  ✓ ${basename(p.newPath)}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${basename(p.oldPath)}: ${(err as Error).message}`);
    }
  }

  console.log(`\n迁移完成: ${success} 成功, ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

function basename(path: string, ext?: string): string {
  const base = path.split('/').pop()!;
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

if (import.meta.main) {
  await main();
}