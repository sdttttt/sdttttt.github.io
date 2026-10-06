#!/usr/bin/env deno
/**
 * 校验文章 front matter
 *
 * 检查项：
 *   - title / date 必填，date 为 `YYYY-MM-DD`（真实日历校验），见 lib/frontmatter
 *     的 `checkTitleAndDate` / `toYyyymmdd`
 *   - slug（文件名）不重复
 *   - private 如存在必须是布尔值
 *
 * 用法：
 *   deno task validate-posts
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkTitleAndDate, parseFrontMatter } from './lib/frontmatter.js';
import { listPostFiles, POSTS_DIR } from './lib/paths.js';

interface Issue {
  file: string;
  message: string;
}

export async function validate(): Promise<Issue[]> {
  const files = await listPostFiles();
  const issues: Issue[] = [];
  const slugs = new Set<string>();

  for (const f of files) {
    const raw = await readFile(join(POSTS_DIR, f), 'utf8');
    const meta = parseFrontMatter(raw);

    // title / date 的判据与措辞统一在 lib/frontmatter 的 checkTitleAndDate 里
    //（rename-posts 跳过文章时用的是同一份清单）
    for (const message of checkTitleAndDate(meta)) {
      issues.push({ file: f, message });
    }

    const slug = f.replace(/\.md$/, '');
    if (slugs.has(slug)) {
      issues.push({ file: f, message: `slug 重复: ${slug}` });
    } else {
      slugs.add(slug);
    }

    if (meta.private !== undefined && typeof meta.private !== 'boolean') {
      issues.push({ file: f, message: 'private 必须是布尔值' });
    }
  }

  return issues;
}

async function main(): Promise<void> {
  const issues = await validate();

  if (issues.length === 0) {
    console.log('✓ 所有文章校验通过');
    process.exit(0);
  }

  console.error(`发现 ${issues.length} 个问题:\n`);
  for (const { file, message } of issues) {
    console.error(`  ${file}: ${message}`);
  }
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
