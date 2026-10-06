/**
 * 项目里反复出现的路径常量 + posts 目录的清单函数。
 *
 * 之前多个脚本里各自声明了 POSTS_DIR、各自 readdir 一遍，容易漂移；
 * 现在统一放这里。新脚本应直接 import，而不是再写一遍。
 */

import { readdir } from 'node:fs/promises';

/** 博客文章根目录 */
export const POSTS_DIR = 'content/posts';

/** 整个 content 树（posts / changelog 等） */
export const CONTENT_DIR = 'content';

/**
 * `content/posts/` 下所有文章**文件名**（不含 `_index.md`）。
 *
 * 口径放一处：rename-posts（决定改谁）与 validate-posts（校验谁）必须一致，
 * 否则会出现「一个脚本管、另一个不管」的文章。顺序沿用 readdir 的返回顺序。
 */
export async function listPostFiles(): Promise<string[]> {
  const entries = await readdir(POSTS_DIR);
  return entries.filter((f) => f.endsWith('.md') && f !== '_index.md');
}
