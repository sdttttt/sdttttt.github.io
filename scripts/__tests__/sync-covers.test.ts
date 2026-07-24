import { describe, test, expect, mock, afterEach } from 'bun:test';
import { collectUsedCovers } from '../sync-covers';

afterEach(() => {
  mock.restore();
});

describe('collectUsedCovers', () => {
  function mockPosts(posts: Record<string, string>) {
    mock.module('node:fs/promises', () => ({
      readdir: mock(async () => Object.keys(posts).map((name) => name)),
      readFile: mock(async (path: string) => {
        const name = path.split('/').pop()!;
        return posts[name] ?? '';
      }),
    }));
  }

  test('只收集 images/covers/ 下的封面', async () => {
    mockPosts({
      'a.md': '---\ncover:\n  image: images/covers/a.svg\n---\n',
      'b.md': '---\ncover:\n  image: images/covers/b.svg\n---\n',
    });
    const used = await collectUsedCovers();
    expect([...used].sort()).toEqual(['a.svg', 'b.svg']);
  });

  test('忽略外部 URL 封面', async () => {
    mockPosts({
      'a.md': '---\ncover:\n  image: https://example.com/cover.svg\n---\n',
    });
    const used = await collectUsedCovers();
    expect(used.size).toBe(0);
  });

  test('忽略无 cover 文章', async () => {
    mockPosts({
      'a.md': '---\ntitle: Hello\n---\n',
    });
    const used = await collectUsedCovers();
    expect(used.size).toBe(0);
  });

  test('同一封面去重', async () => {
    mockPosts({
      'a.md': '---\ncover:\n  image: images/covers/same.svg\n---\n',
      'b.md': '---\ncover:\n  image: images/covers/same.svg\n---\n',
    });
    const used = await collectUsedCovers();
    expect([...used]).toEqual(['same.svg']);
  });
});
