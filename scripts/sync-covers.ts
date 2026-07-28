#!/usr/bin/env bun
/**
 * 清理未使用的封面 SVG
 *
 * 扫描所有文章的 cover.image，删除 static/images/covers 中未被引用的 SVG。
 *
 * 用法：
 *   bun scripts/sync-covers.ts          # 直接删除孤儿封面
 *   bun scripts/sync-covers.ts --dry-run # 只打印，不删除
 */

import { readdir, readFile, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { parseFrontMatter } from './lib/frontmatter';
import { parseArgs, getBoolean } from './lib/args';

const POSTS_DIR = 'content/posts';
const COVERS_DIR = 'static/images/covers';

const args = parseArgs(process.argv);
const dryRun = getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun');

export async function collectUsedCovers(): Promise<Set<string>> {
  const entries = await readdir(POSTS_DIR);
  const files = entries.filter((f) => f.endsWith('.md') && f !== '_index.md');
  const used = new Set<string>();

  for (const f of files) {
    const raw = await readFile(join(POSTS_DIR, f), 'utf8');
    const meta = parseFrontMatter(raw);
    const coverImage = (meta.cover as Record<string, unknown> | undefined)?.image;
    if (typeof coverImage === 'string' && coverImage.startsWith('images/covers/')) {
      used.add(basename(coverImage));
    }
  }

  return used;
}

async function main(): Promise<void> {
  const used = await collectUsedCovers();
  const entries = await readdir(COVERS_DIR);
  const orphans = entries.filter((f) => f.endsWith('.svg') && !used.has(f));

  if (orphans.length === 0) {
    console.log('✓ 没有孤儿封面');
    return;
  }

  for (const f of orphans) {
    const path = join(COVERS_DIR, f);
    if (dryRun) {
      console.log(`[dry-run] 将删除: ${path}`);
    } else {
      await unlink(path);
      console.log(`✓ 删除: ${path}`);
    }
  }

  console.log(`\n共 ${orphans.length} 个孤儿封面${dryRun ? '（dry-run）' : ''}`);
}

if (import.meta.main) {
  await main();
}
