import { describe, test, afterEach, beforeEach, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildReport,
  detectCollisions,
  findBlockingCollisions,
  oldUrlFromSlug,
  addAlias,
  executePlan,
  type RenamePlan,
} from '../rename-posts.ts';
import { parseFrontMatter } from '../lib/frontmatter.ts';

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

const fm = (title: string, date: string, body = 'body') => `---
title: ${title}
date: ${date}
---
${body}`;

describe('buildReport', () => {
  let env: TempContent;

  beforeEach(() => {
    env = setupTempContent();
  });

  afterEach(() => {
    env.restore();
  });

  test('有效文章进入 plans，新名为纯日期', async () => {
    env.addPost('2024-01-15-hello.md', fm('Hello', '2024-01-15'));
    env.addPost('_index.md', '---\ntitle: Posts\n---');
    const { plans, skipped } = await buildReport();
    expect(skipped).toEqual([]);
    expect(plans.length).toBe(1);
    expect(plans[0]!.date).toBe('2024-01-15');
    expect(plans[0]!.newSlug).toBe('2024-01-15');
    expect(plans[0]!.oldSlug).toBe('2024-01-15-hello');
    expect(plans[0]!.newPath).toBe(join('content/posts', '2024-01-15.md'));
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

  test('已是新格式（纯日期文件名）归入 skipped', async () => {
    env.addPost('2024-01-15.md', fm('x', '2024-01-15'));
    const { plans, skipped } = await buildReport();
    expect(plans.length).toBe(0);
    expect(skipped.length).toBe(1);
    expect(skipped[0]!.reason).toBe('已是新格式');
  });

  test('同日多篇：首篇占裸名，其余 -2/-3，按 title 排序', async () => {
    env.addPost('old-b.md', fm('Beta', '2024-01-15'));
    env.addPost('old-a.md', fm('Alpha', '2024-01-15'));
    env.addPost('old-c.md', fm('Gamma', '2024-01-15'));
    const { plans } = await buildReport();
    expect(plans.length).toBe(3);
    const byNew = new Map(plans.map((p) => [p.newSlug, p]));
    expect(byNew.get('2024-01-15')!.title).toBe('Alpha');
    expect(byNew.get('2024-01-15-2')!.title).toBe('Beta');
    expect(byNew.get('2024-01-15-3')!.title).toBe('Gamma');
  });

  test('同日排序优先看时刻，再看 title', async () => {
    env.addPost('old-1.md', fm('Zulu', '2024-01-15T09:00:00Z'));
    env.addPost('old-2.md', fm('Alpha', '2024-01-15T13:00:00Z'));
    env.addPost('old-3.md', fm('Mike', '2024-01-15'));
    const { plans } = await buildReport();
    const byNew = new Map(plans.map((p) => [p.newSlug, p]));
    // 无时刻的排最前，然后 09:00 < 13:00
    expect(byNew.get('2024-01-15')!.title).toBe('Mike');
    expect(byNew.get('2024-01-15-2')!.title).toBe('Zulu');
    expect(byNew.get('2024-01-15-3')!.title).toBe('Alpha');
  });

  test('同日同 title 按内容 hash 定序（与文件名无关，改名后规则仍稳定）', async () => {
    // 两篇 title/date 全同，只有正文不同：排序由内容 hash 决定，与旧文件名无关。
    // （旧实现用旧文件名当排序键：首跑改名后 -2 后缀会翻转排序结果，两篇互换名字死循环）
    env.addPost('zz-old.md', fm('Same', '2024-01-15', 'body-zz'));
    env.addPost('aa-old.md', fm('Same', '2024-01-15', 'body-aa'));
    const { plans } = await buildReport();
    const byOld = new Map(plans.map((p) => [p.oldSlug, p.newSlug]));
    // body-aa 的内容 hash 一定小于 body-zz（不同内容 hash 几乎必不同；此处只断言
    // 「排序与文件名无关」：aa-old / zz-old 拿到的命名与按文件名排序的结果无关，
    // 且两次 buildReport 结果一致）
    const again = await buildReport();
    expect(again.plans.map((p) => [p.oldSlug, p.newSlug])).toEqual(
      plans.map((p) => [p.oldSlug, p.newSlug]),
    );
    const slugs = [...byOld.values()].sort();
    expect(slugs).toEqual(['2024-01-15', '2024-01-15-2']);
  });

  test('不同日期的文章互不影响', async () => {
    env.addPost('a.md', fm('One', '2024-01-15'));
    env.addPost('b.md', fm('Two', '2024-01-16'));
    const { plans } = await buildReport();
    expect(plans.map((p) => p.newSlug).sort()).toEqual(['2024-01-15', '2024-01-16']);
  });

  test('忽略 _index.md', async () => {
    env.addPost('_index.md', '---\ntitle: Posts\n---\n');
    const { plans, skipped } = await buildReport();
    expect(plans.length).toBe(0);
    expect(skipped.length).toBe(0);
  });
});

describe('detectCollisions', () => {
  function plan(newName: string, oldName: string): RenamePlan {
    return {
      oldPath: `content/posts/${oldName}`,
      newPath: `content/posts/${newName}`,
      oldSlug: oldName.replace(/\.md$/, ''),
      newSlug: newName.replace(/\.md$/, ''),
      date: newName.slice(0, 10),
      title: 't',
      oldUrl: `/posts/${oldName.replace(/\.md$/, '')}/`,
    };
  }

  test('无碰撞返回空 Map', () => {
    const collisions = detectCollisions([plan('2024-01-15.md', 'a.md'), plan('2024-01-16.md', 'b.md')]);
    expect(collisions.size).toBe(0);
  });

  test('同 newName 触发碰撞', () => {
    const collisions = detectCollisions([plan('2024-01-15.md', 'a.md'), plan('2024-01-15.md', 'b.md')]);
    expect(collisions.size).toBe(1);
    expect(collisions.get('2024-01-15.md')!.length).toBe(2);
  });

  test('3 个同 newName 仍算 1 个碰撞', () => {
    const collisions = detectCollisions([
      plan('2024-01-15.md', 'a.md'),
      plan('2024-01-15.md', 'b.md'),
      plan('2024-01-15.md', 'c.md'),
    ]);
    expect(collisions.size).toBe(1);
    expect(collisions.get('2024-01-15.md')!.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────
// 旧 URL → aliases（保住改名前的链接）
// ─────────────────────────────────────────────────────────────

describe('oldUrlFromSlug', () => {
  test('旧格式 YYYYMMDD-slug-hash 保留连字符（Hugo 的 URL 就是文件名）', () => {
    expect(oldUrlFromSlug('20200403-领域逻辑的组织模式-3qj')).toBe(
      '/posts/20200403-领域逻辑的组织模式-3qj/',
    );
  });

  test('ASCII 旧格式，URL 小写化（Hugo 默认 disablePathToLower=false）', () => {
    expect(oldUrlFromSlug('20200406-MultiplexingIO-13q')).toBe('/posts/20200406-multiplexingio-13q/');
  });

  test('新格式 YYYY-MM-DD（含 -2 后缀）本身就是合法 URL', () => {
    expect(oldUrlFromSlug('2024-01-15')).toBe('/posts/2024-01-15/');
    expect(oldUrlFromSlug('2024-01-15-2')).toBe('/posts/2024-01-15-2/');
  });

  test('历史格式 YYYYMMDDhash 原样保留', () => {
    expect(oldUrlFromSlug('2026081705hog4')).toBe('/posts/2026081705hog4/');
  });

  test('历史格式带方括号时去掉方括号', () => {
    expect(oldUrlFromSlug('20260805[057m5q]')).toBe('/posts/20260805057m5q/');
  });
});

describe('addAlias', () => {
  const fmBlock = (lines: string, body = '正文') => `---\n${lines}\n---\n${body}`;

  test('已有 inline 数组时追加', () => {
    const raw = fmBlock('title: x\ndate: 2020-04-03\naliases: ["/posts/20200403037p8f/"]');
    const out = addAlias(raw, '/posts/20200403-领域逻辑的组织模式-3qj/');
    expect(out).toContain(
      'aliases: ["/posts/20200403037p8f/", "/posts/20200403-领域逻辑的组织模式-3qj/"]',
    );
    expect(out).toContain('正文');
  });

  test('幂等：已存在同一 URL 时原样返回', () => {
    const raw = fmBlock('aliases: ["/posts/a/"]');
    expect(addAlias(raw, '/posts/a/')).toBe(raw);
  });

  test('aliases 为空数组时写入', () => {
    const raw = fmBlock('title: x\naliases: []');
    expect(addAlias(raw, '/posts/a/')).toContain('aliases: ["/posts/a/"]');
  });

  test('没有 aliases 键时新建，且插在 front matter 末尾', () => {
    const raw = fmBlock('title: x\ndate: 2020-04-03');
    const out = addAlias(raw, '/posts/a/');
    expect(out).toContain('date: 2020-04-03\naliases: ["/posts/a/"]\n---');
  });

  test('YAML 块式 aliases 时追加一行', () => {
    const raw = fmBlock('title: x\naliases:\n  - "/posts/a/"');
    const out = addAlias(raw, '/posts/b/');
    expect(out).toContain('aliases:\n  - "/posts/a/"\n  - "/posts/b/"');
  });

  test('Prettier 折叠成的「aliases:」+ 缩进数组也能追加', () => {
    const raw = fmBlock('title: x\naliases:\n  ["/posts/a/", "/posts/b/"]');
    const out = addAlias(raw, '/posts/c/');
    expect(out).toContain('aliases:\n  ["/posts/a/", "/posts/b/", "/posts/c/"]');
  });

  test('Prettier 把数组折成多行（`[` 与 `]` 各占一行）也能追加，且不产出非法 YAML', () => {
    const raw = fmBlock('title: x\naliases:\n  [\n    "/posts/a/",\n    "/posts/b/",\n  ]');
    const out = addAlias(raw, '/posts/c/');
    expect(out).toContain('aliases:\n  ["/posts/a/", "/posts/b/", "/posts/c/"]');
    // 折行式曾经漏到块式分支，插出 `aliases:` + `- "…"` + `[ … ]` 这种非法 YAML
    expect(out).not.toContain('  - "/posts/c/"');
    expect(parseFrontMatter(out).aliases).toEqual(['/posts/a/', '/posts/b/', '/posts/c/']);
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

// ─────────────────────────────────────────────────────────────
// 覆盖检查：目标名已被现存文件占用（detectCollisions 看不到这一类）
// ─────────────────────────────────────────────────────────────

describe('findBlockingCollisions', () => {
  function plan(newName: string, oldName: string): RenamePlan {
    return {
      oldPath: `content/posts/${oldName}`,
      newPath: `content/posts/${newName}`,
      oldSlug: oldName.replace(/\.md$/, ''),
      newSlug: newName.replace(/\.md$/, ''),
      date: newName.slice(0, 10),
      title: 't',
      oldUrl: `/posts/${oldName.replace(/\.md$/, '')}/`,
    };
  }

  test('目标名没被现存文件占用时返回空 Map', () => {
    const blockers = findBlockingCollisions([plan('2024-01-15.md', 'old-a.md')], ['old-a.md']);
    expect(blockers.size).toBe(0);
  });

  test('撞上不计入 plans 的现存文件（它不会被挪走，会被覆盖）', () => {
    const blockers = findBlockingCollisions([plan('2024-01-15.md', 'old-a.md')], [
      'old-a.md',
      '2024-01-15.md',
    ]);
    expect(blockers.size).toBe(1);
    expect(blockers.get('2024-01-15.md')).toEqual(['old-a.md']);
  });

  test('两篇互换名字也报错（执行顺序不利时就是相互覆盖）', () => {
    const blockers = findBlockingCollisions([plan('b.md', 'a.md'), plan('a.md', 'b.md')], [
      'a.md',
      'b.md',
    ]);
    expect(blockers.size).toBe(2);
    expect(blockers.get('b.md')).toEqual(['a.md']);
    expect(blockers.get('a.md')).toEqual(['b.md']);
  });

  test('目标名就是自己的旧名时不算阻塞（不会自撞）', () => {
    const blockers = findBlockingCollisions([plan('a.md', 'a.md')], ['a.md']);
    expect(blockers.size).toBe(0);
  });
});
