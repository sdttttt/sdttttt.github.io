import { describe, test, afterEach, beforeEach } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizeDate,
  extractBody,
  computeHash3,
  slugify,
  buildReport,
  detectCollisions,
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
