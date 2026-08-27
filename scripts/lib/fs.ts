/**
 * 通用的目录遍历工具。
 *
 * `walkMarkdown` 之前只在 check-dead-links.ts 里手写，但 validate-posts /
 * sync-covers / gen-covers 都按各自习惯遍历 content/posts/，容易重复。
 * 统一在这里，未来加 .mdignore / 按 frontmatter 过滤等特性只需改一处。
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 递归遍历指定目录下所有 `.md` 文件的绝对路径。
 * 对目录项继续递归，遇到 `.md` 文件则 yield 完整路径。
 *
 * 不会过滤 _index.md，调用方按需判断。
 */
export async function* walkMarkdown(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdown(path);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield path;
    }
  }
}

/**
 * 同步版遍历目录，返回所有文件路径。
 * optimize-images.ts 用（处理图片时不需要 yield 风格）。
 */
export async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}