/**
 * 项目里反复出现的路径常量 + 基础 fs 工具。
 *
 * 之前在 4 个脚本里各自声明了 POSTS_DIR / COVERS_DIR / exists()，容易漂移；
 * 现在统一放这里。新脚本应直接 import，而不是再写一遍。
 */

import { stat } from 'node:fs/promises';

/** 博客文章根目录 */
export const POSTS_DIR = 'content/posts';

/** 自动生成 / 用户自定义的封面 SVG 目录（位于 static/） */
export const COVERS_DIR = 'static/images/covers';

/** 整个 content 树（claudelog / posts 等） */
export const CONTENT_DIR = 'content';

/** 子模块名（用于 keep-out lint 或文档引用） */
export const THEME_DIR = 'themes/PaperMod';

/** 文件是否存在 */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}