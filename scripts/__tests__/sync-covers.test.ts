import { describe, test } from 'node:test';
import { collectUsedCovers } from '../sync-covers.js';
import { expect } from './expect.js';
import { inTempDir } from './temp-dir.js';
import { mkdirSync, writeFileSync } from 'node:fs';

describe('collectUsedCovers', () => {
  test('只收集 images/covers/ 下的封面', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync(
        'content/posts/a.md',
        '---\ncover:\n  image: images/covers/a.svg\n---\n',
      );
      writeFileSync(
        'content/posts/b.md',
        '---\ncover:\n  image: images/covers/b.svg\n---\n',
      );
      const used = await collectUsedCovers();
      expect([...used].sort()).toEqual(['a.svg', 'b.svg']);
    }));

  test('忽略外部 URL 封面', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync(
        'content/posts/a.md',
        '---\ncover:\n  image: https://example.com/cover.svg\n---\n',
      );
      const used = await collectUsedCovers();
      expect(used.size).toBe(0);
    }));

  test('忽略无 cover 文章', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/posts/a.md', '---\ntitle: Hello\n---\n');
      const used = await collectUsedCovers();
      expect(used.size).toBe(0);
    }));

  test('同一封面去重', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync(
        'content/posts/a.md',
        '---\ncover:\n  image: images/covers/same.svg\n---\n',
      );
      writeFileSync(
        'content/posts/b.md',
        '---\ncover:\n  image: images/covers/same.svg\n---\n',
      );
      const used = await collectUsedCovers();
      expect([...used]).toEqual(['same.svg']);
    }));
});
