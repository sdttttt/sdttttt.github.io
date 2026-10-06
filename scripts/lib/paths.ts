/**
 * 项目里反复出现的路径常量。
 *
 * 之前多个脚本里各自声明了 POSTS_DIR，容易漂移；现在统一放这里。
 * 新脚本应直接 import，而不是再写一遍。
 */

/** 博客文章根目录 */
export const POSTS_DIR = 'content/posts';

/** 整个 content 树（posts / changelog 等） */
export const CONTENT_DIR = 'content';
