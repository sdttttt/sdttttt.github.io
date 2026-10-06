/**
 * 目录遍历工具（目前只有 check-dead-links.ts 在用）。
 *
 * 未来加 .mdignore / 按 frontmatter 过滤等特性时只改这一处。
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
