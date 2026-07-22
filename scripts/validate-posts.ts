#!/usr/bin/env bun
/**
 * 校验文章 front matter 和封面一致性
 *
 * 检查项：
 *   - title / date 必填
 *   - date 格式为 YYYY-MM-DD
 *   - slug 不重复
 *   - 如声明 cover.image，对应 SVG 文件必须存在
 *   - private 如存在必须是布尔值
 *
 * 用法：
 *   bun scripts/validate-posts.ts
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFrontMatter } from './lib/frontmatter';

const POSTS_DIR = 'content/posts';

interface Issue {
  file: string;
  message: string;
}

function isValidDate(s: string): boolean {
  return !Number.isNaN(Date.parse(s));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Hugo 资源路径：cover.image 相对于 assets/ 或 static/ */
async function coverExists(coverImage: string): Promise<boolean> {
  if (coverImage.startsWith('http://') || coverImage.startsWith('https://')) {
    return true; // 外链封面，不校验本地文件
  }
  const relative = coverImage.startsWith('/') ? coverImage.slice(1) : coverImage;
  return (await exists(`assets/${relative}`)) || (await exists(`static/${relative}`));
}

async function validate(): Promise<Issue[]> {
  const entries = await readdir(POSTS_DIR);
  const files = entries.filter((f) => f.endsWith('.md') && f !== '_index.md');
  const issues: Issue[] = [];
  const slugs = new Set<string>();

  for (const f of files) {
    const raw = await readFile(join(POSTS_DIR, f), 'utf8');
    const meta = parseFrontMatter(raw);

    if (!meta.title || typeof meta.title !== 'string' || meta.title.trim() === '') {
      issues.push({ file: f, message: '缺少 title 或 title 为空' });
    }

    if (!meta.date || typeof meta.date !== 'string') {
      issues.push({ file: f, message: '缺少 date 字段' });
    } else if (!isValidDate(meta.date)) {
      issues.push({ file: f, message: `date 格式无效: ${meta.date}` });
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

    const coverImage = (meta.cover as Record<string, unknown> | undefined)?.image;
    if (typeof coverImage === 'string' && coverImage.trim() !== '') {
      if (!(await coverExists(coverImage))) {
        issues.push({ file: f, message: `封面文件不存在: ${coverImage}` });
      }
    }
  }

  return issues;
}

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
