import { describe, test, afterEach, beforeEach } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizeDate,
  extractBody,
  computeHash3,
  slugify,
  buildReport,
  detectCollisions,
  oldUrlFromSlug,
  addAlias,
  executePlan,
  type RenamePlan,
} from '../rename-posts.js';
import { expect } from './expect.js';

// ─────────────────────────────────────────────────────────────
// 纯函数
// ─────────────────────────────────────────────────────────────

describe('normalizeDate', () => {
  test('bare YYYY-MM-DD', () => {
    expect(normalizeDate('2025-05-04')).toBe('20250504');
  });

  test('ISO datetime 取日期部分', () => {
    expect(normalizeDate('2020-05-09T13:00:00Z')).toBe('20200509');
  });

  test('非字符串返回 null', () => {
    expect(normalizeDate(null)).toBe(null);
    expect(normalizeDate(20250101)).toBe(null);
  });

  test('完全无效的字符串返回 null', () => {
    expect(normalizeDate('hello')).toBe(null);
  });

  test('月日越界返回 null', () => {
    expect(normalizeDate('2024-13-01')).toBe(null);
    expect(normalizeDate('2024-00-15')).toBe(null);
    expect(normalizeDate('2024-01-32')).toBe(null);
  });

  test('一位月日自动补零', () => {
    expect(normalizeDate('2024-1-5')).toBe('20240105');
  });
});

describe('extractBody', () => {
  test('去掉 frontmatter 块', () => {
    const raw = `---
title: x
---
hello body`;
    expect(extractBody(raw)).toBe('hello body');
  });

  test('没有 frontmatter 时返回原文', () => {
    const raw = 'just a body';
    expect(extractBody(raw)).toBe('just a body');
  });

  test('frontmatter 后面有空行也保留', () => {
    const raw = `---
title: x
---

body`;
    expect(extractBody(raw)).toBe('\nbody');
  });
});

describe('computeHash3', () => {
  test('同输入产出同输出', () => {
    expect(computeHash3('hello')).toBe(computeHash3('hello'));
  });

  test('不同输入产出不同输出', () => {
    expect(computeHash3('hello')).not.toBe(computeHash3('world'));
  });

  test('返回 3 位以内 base36', () => {
    const h = computeHash3('any content');
    expect(h).toMatch(/^[0-9a-z]{1,4}$/);
  });
});

describe('slugify', () => {
  test('纯中文标题', () => {
    expect(slugify('今天是二零二六年九月二十一日')).toBe('今天是二零二六年九月二十一日');
  });

  test('英文标题转小写并保留连字符', () => {
    expect(slugify('Hello World')).toBe('Hello-World');
  });

  test('去除非法字符', () => {
    expect(slugify('Hello, World! 2024')).toBe('Hello-World-2024');
  });

  test('合并连续连字符', () => {
    expect(slugify('a---b')).toBe('a-b');
  });

  test('去掉首尾连字符', () => {
    expect(slugify('---hello---')).toBe('hello');
  });

  test('空字符串兜底', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('   ')).toBe('untitled');
    expect(slugify('!!!')).toBe('untitled');
  });

  test('超长标题截断并去尾连字符', () => {
    const long = 'a'.repeat(100);
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('-')).toBe(false);
  });

  test('混合中日英韩', () => {
    expect(slugify('Hello 世界 こんにちは')).toBe('Hello-世界-こんにちは');
  });
});

// ─────────────────────────────────────────────────────────────
// 集成：buildReport + detectCollisions（用真实临时文件，不 mock fs）
// ─────────────────────────────────────────────────────────────

interface TempContent {
  addPost: (filename: string, content: string) => void;
  restore: () => void;
}

function setupTempContent(): TempContent {
  const originalCwd = process.cwd();
  const workDir = mkdtempSync(join(tmpdir(), 'rename-posts-build-test-'));
  process.chdir(workDir);
  mkdirSync('content/posts', { recursive: true });
  return {
    addPost: (filename, content) => {
      writeFileSync(join('content/posts', filename), content);
    },
    restore: () => {
      process.chdir(originalCwd);
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

describe('buildReport', () => {
  let env: TempContent;

  beforeEach(() => {
    env = setupTempContent();
  });

  afterEach(() => {
    env.restore();
  });

  test('有效文章进入 plans', async () => {
    const content = `---
title: Hello
date: 2024-01-15
---
hello body content`;
    env.addPost('2024-01-15-hello.md', content);
    env.addPost('_index.md', '---\ntitle: Posts\n---');
    const { plans, skipped } = await buildReport();
    expect(skipped).toEqual([]);
    expect(plans.length).toBe(1);
    expect(plans[0]!.yyyymmdd).toBe('20240115');
    expect(plans[0]!.hash3).toMatch(/^[0-9a-z]{1,4}$/);
    expect(plans[0]!.oldSlug).toBe('2024-01-15-hello');
    expect(plans[0]!.newSlug).toMatch(/^20240115-.+-[a-z0-9]{1,4}$/);
  });

  test('缺少 date 归入 skipped', async () => {
    env.addPost('no-date.md', '---\ntitle: x\n---\nbody');
    const { plans, skipped } = await buildReport();
    expect(plans.length).toBe(0);
    expect(skipped.length).toBe(1);
    expect(skipped[0]!.reason).toContain('缺少 date');
  });

  test('无效 date 归入 skipped', async () => {
    env.addPost('bad-date.md', '---\ntitle: x\ndate: not-a-date\n---\nbody');
    const { plans, skipped } = await buildReport();
    expect(plans.length).toBe(0);
    expect(skipped.length).toBe(1);
    expect(skipped[0]!.reason).toContain('date 格式无效');
  });

  test('已是新格式归入 skipped', async () => {
    const date = '2024-01-15';
    const body = 'unique body for idempotency test';
    const raw = `---
title: x
date: ${date}
---
${body}`;
    const yyyymmdd = normalizeDate(date)!;
    const slug = slugify('x');
    const hash3 = computeHash3(extractBody(raw));
    const newName = `${yyyymmdd}-${slug}-${hash3}.md`;
    env.addPost(newName, raw);
    const { plans, skipped } = await buildReport();
    expect(plans.length).toBe(0);
    expect(skipped.length).toBe(1);
    expect(skipped[0]!.reason).toBe('已是新格式');
  });

  test('忽略 _index.md', async () => {
    env.addPost('_index.md', '---\ntitle: Posts\n---\n');
    const { plans, skipped } = await buildReport();
    expect(plans.length).toBe(0);
    expect(skipped.length).toBe(0);
  });
});

describe('detectCollisions', () => {
  function plan(newName: string, hash3: string): RenamePlan {
    return {
      oldPath: `content/posts/old-${hash3}.md`,
      newPath: `content/posts/${newName}`,
      oldSlug: `old-${hash3}`,
      newSlug: newName.replace(/\.md$/, ''),
      yyyymmdd: newName.slice(0, 8),
      hash3,
      title: 't',
      oldUrl: `/posts/old-${hash3}/`,
      body: '',
    };
  }

  test('无碰撞返回空 Map', () => {
    const collisions = detectCollisions([
      plan('20240115-aaa-aaa.md', 'aaa'),
      plan('20240115-bbb-bbb.md', 'bbb'),
    ]);
    expect(collisions.size).toBe(0);
  });

  test('同 newName 触发碰撞', () => {
    const collisions = detectCollisions([
      plan('20240115-aaa-aaa.md', 'aaa'),
      plan('20240115-aaa-aaa.md', 'aaa'),
    ]);
    expect(collisions.size).toBe(1);
    expect(collisions.get('20240115-aaa-aaa.md')!.length).toBe(2);
  });

  test('3 个同 newName 仍算 1 个碰撞', () => {
    const collisions = detectCollisions([
      plan('20240115-aaa-aaa.md', 'aaa'),
      plan('20240115-aaa-aaa.md', 'aaa'),
      plan('20240115-aaa-aaa.md', 'aaa'),
    ]);
    expect(collisions.size).toBe(1);
    expect(collisions.get('20240115-aaa-aaa.md')!.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────
// 旧 URL → aliases（保住改名前的链接）
// ─────────────────────────────────────────────────────────────

describe('oldUrlFromSlug', () => {
  test('当前格式保留连字符（Hugo 的 URL 就是文件名）', () => {
    expect(oldUrlFromSlug('20200403-领域逻辑的组织模式-3qj')).toBe(
      '/posts/20200403-领域逻辑的组织模式-3qj/',
    );
  });

  test('ASCII 当前格式，URL 小写化（Hugo 默认 disablePathToLower=false）', () => {
    expect(oldUrlFromSlug('20200406-MultiplexingIO-13q')).toBe(
      '/posts/20200406-multiplexingio-13q/',
    );
  });

  test('历史格式 YYYYMMDDhash 原样保留', () => {
    expect(oldUrlFromSlug('2026081705hog4')).toBe('/posts/2026081705hog4/');
  });

  test('历史格式带方括号时去掉方括号', () => {
    expect(oldUrlFromSlug('20260805[057m5q]')).toBe('/posts/20260805057m5q/');
  });
});

describe('addAlias', () => {
  const fm = (lines: string, body = '正文') => `---\n${lines}\n---\n${body}`;

  test('已有 inline 数组时追加', () => {
    const raw = fm('title: x\ndate: 2020-04-03\naliases: ["/posts/20200403037p8f/"]');
    const out = addAlias(raw, '/posts/20200403-领域逻辑的组织模式-3qj/');
    expect(out).toContain('aliases: ["/posts/20200403037p8f/", "/posts/20200403-领域逻辑的组织模式-3qj/"]');
    expect(out).toContain('正文');
  });

  test('幂等：已存在同一 URL 时原样返回', () => {
    const raw = fm('aliases: ["/posts/a/"]');
    expect(addAlias(raw, '/posts/a/')).toBe(raw);
  });

  test('aliases 为空数组时写入', () => {
    const raw = fm('title: x\naliases: []');
    expect(addAlias(raw, '/posts/a/')).toContain('aliases: ["/posts/a/"]');
  });

  test('没有 aliases 键时新建，且插在 front matter 末尾', () => {
    const raw = fm('title: x\ndate: 2020-04-03');
    const out = addAlias(raw, '/posts/a/');
    expect(out).toContain('date: 2020-04-03\naliases: ["/posts/a/"]\n---');
  });

  test('YAML 块式 aliases 时追加一行', () => {
    const raw = fm('title: x\naliases:\n  - "/posts/a/"');
    const out = addAlias(raw, '/posts/b/');
    expect(out).toContain('aliases:\n  - "/posts/a/"\n  - "/posts/b/"');
  });

  test('Prettier 折叠成的「aliases:」+ 缩进数组也能追加', () => {
    const raw = fm('title: x\naliases:\n  ["/posts/a/", "/posts/b/"]');
    const out = addAlias(raw, '/posts/c/');
    expect(out).toContain('aliases:\n  ["/posts/a/", "/posts/b/", "/posts/c/"]');
  });

  test('没有 front matter 时原样返回', () => {
    const raw = 'just a body';
    expect(addAlias(raw, '/posts/a/')).toBe(raw);
  });
});

describe('executePlan', () => {
  let env: TempContent;

  beforeEach(() => {
    env = setupTempContent();
  });

  afterEach(() => {
    env.restore();
  });

  test('改名后把旧 URL 写进 aliases，并保留正文', async () => {
    const raw = `---\ntitle: Hello\ndate: 2024-01-15\naliases: ["/posts/legacy/"]\n---\nhello body content`;
    env.addPost('2024-01-15-hello.md', raw);
    const { plans } = await buildReport();
    await executePlan(plans[0]!);

    expect(existsSync(plans[0]!.oldPath)).toBe(false);
    const updated = readFileSync(plans[0]!.newPath, 'utf8');
    expect(updated).toContain('aliases: ["/posts/legacy/", "/posts/2024-01-15-hello/"]');
    expect(updated).toContain('hello body content');
  });

  test('重复执行同一计划不会重复追加 alias', async () => {
    const raw = `---\ntitle: Hello\ndate: 2024-01-15\n---\nhello body content`;
    env.addPost('2024-01-15-hello.md', raw);
    const { plans } = await buildReport();
    await executePlan(plans[0]!);
    const first = readFileSync(plans[0]!.newPath, 'utf8');
    const second = addAlias(first, plans[0]!.oldUrl);
    expect(second).toBe(first);
  });
});
