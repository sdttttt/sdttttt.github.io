import { describe, test, afterEach, beforeEach } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  normalizeDate,
  extractBody,
  computeHash6,
  computeHash3,
  slugify,
  rewriteCoverImage,
  buildReport,
  detectCollisions,
  oldUrlFromSlug,
  type RenamePlan,
} from '../rename-posts.js';
import { expect } from './expect.js';

// 模拟脚本对 raw 的处理：先用 extractBody 取 body，再算 hash
function simulateNewName(date: string, body: string): string {
  const raw = `---\ndate: ${date}\n---\n${body}`;
  return `${normalizeDate(date)}[${computeHash6(extractBody(raw))}].md`;
}

// ─────────────────────────────────────────────────────────────
// 纯函数
// ─────────────────────────────────────────────────────────────

describe('normalizeDate', () => {
  test('bare YYYY-MM-DD', () => {
    expect(normalizeDate('2025-05-04')).toBe('20250504');
  });

  test('quoted YYYY-MM-DD（已 unquote）', () => {
    expect(normalizeDate('2022-11-08')).toBe('20221108');
  });

  test('ISO 8601 with Z timezone', () => {
    expect(normalizeDate('2020-05-09T13:00:00Z')).toBe('20200509');
  });

  test('ISO 8601 with offset', () => {
    expect(normalizeDate('2020-05-09T13:00:00+08:00')).toBe('20200509');
  });

  test('单数字月日补零', () => {
    expect(normalizeDate('2022-1-9')).toBe('20220109');
  });

  test('非字符串返回 null', () => {
    expect(normalizeDate(20250504)).toBeNull();
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
  });

  test('完全无效格式返回 null', () => {
    expect(normalizeDate('hello')).toBeNull();
    expect(normalizeDate('2025/05/04')).toBeNull();
    expect(normalizeDate('')).toBeNull();
  });

  test('月份/日期越界返回 null', () => {
    expect(normalizeDate('2025-13-01')).toBeNull();
    expect(normalizeDate('2025-00-15')).toBeNull();
    expect(normalizeDate('2025-05-00')).toBeNull();
    expect(normalizeDate('2025-05-32')).toBeNull();
  });
});

describe('extractBody', () => {
  test('剥掉 frontmatter 块', () => {
    const raw = '---\ntitle: x\n---\n\nhello body';
    expect(extractBody(raw)).toBe('\n\nhello body');
  });

  test('无 frontmatter 时返回原文', () => {
    const raw = 'no front matter here';
    expect(extractBody(raw)).toBe(raw);
  });

  test('frontmatter 内部多行也正确剥离', () => {
    const raw = '---\ntitle: x\ntags:\n  - a\n  - b\ndate: 2025-01-01\n---\nbody';
    expect(extractBody(raw)).toBe('\nbody');
  });
});

describe('computeHash6', () => {
  test('输出长度固定 6', () => {
    expect(computeHash6('').length).toBe(6);
    expect(computeHash6('hello').length).toBe(6);
    expect(computeHash6('中文字符也能算').length).toBe(6);
  });

  test('输出仅含 base36 字符 (0-9a-z)', () => {
    const h = computeHash6('some body content with various chars !@#$%^&*()');
    expect(h).toMatch(/^[0-9a-z]{6}$/);
  });

  test('确定性：相同输入 → 相同 hash', () => {
    expect(computeHash6('abc')).toBe(computeHash6('abc'));
  });

  test('不同输入 → 不同 hash (高概率)', () => {
    expect(computeHash6('hello')).not.toBe(computeHash6('world'));
  });

  test('body 加末尾空白 → 不同 hash（因为我们哈希的是 body 内容）', () => {
    expect(computeHash6('abc')).not.toBe(computeHash6('abc '));
  });

  test('空字符串也是有效输入', () => {
    expect(computeHash6('')).toMatch(/^[0-9a-z]{6}$/);
  });

  test('确定性 + 已知向量（防止误改回 djb2）', () => {
    // SHA-256("hello") = 2cf24dba...
    // 前 3 字节 = 0x2c, 0xf2, 0x4d = 24-bit 0x2cf24d = 2945613 → base36 "01r4ul"
    expect(computeHash6('hello')).toBe('01r4ul');
    // SHA-256("") = e3b0c442...
    // 前 3 字节 = 0xe3, 0xb0, 0xc4 = 24-bit 0xe3b0c4 = 14921924 → base36 "08vttw"
    expect(computeHash6('')).toBe('08vttw');
  });
});

describe('computeHash3', () => {
  test('输出长度 1-4（16-bit base36 自然宽度）', () => {
    // base36: 36^3=46656, 36^4=1679616; 2^16=65536 落在 3-4 位之间
    const len = computeHash3('').length;
    expect(len >= 1 && len <= 4).toBe(true);
  });

  test('输出仅含 base36 字符', () => {
    expect(computeHash3('anything here')).toMatch(/^[0-9a-z]{1,4}$/);
  });

  test('确定性 + 已知向量', () => {
    // SHA-256("hello") 前 2 字节 = 0x2c, 0xf2 = 16-bit 0x2cf2 = 11506 → base36 "8vm"
    expect(computeHash3('hello')).toBe('8vm');
    // SHA-256("") 前 2 字节 = 0xe3, 0xb0 = 16-bit 0xe3b0 = 58288 → base36 "18z4"
    expect(computeHash3('')).toBe('18z4');
  });
});

describe('slugify', () => {
  test('纯中文标题保留', () => {
    expect(slugify('文章的变化')).toBe('文章的变化');
  });

  test('中文+标点:标点替换为连字符并合并', () => {
    expect(slugify('Hello, World!')).toBe('Hello-World');
  });

  test('首尾空白/连字符裁剪', () => {
    expect(slugify('  --foo--  ')).toBe('foo');
  });

  test('纯标点 → untitled 兜底', () => {
    expect(slugify('!!!')).toBe('untitled');
  });

  test('日文/韩文保留', () => {
    expect(slugify('こんにちは')).toBe('こんにちは');
    expect(slugify('안녕하세요')).toBe('안녕하세요');
  });

  test('过长标题截断到 80 字符且不残留末尾连字符', () => {
    const long = '啊'.repeat(100);
    const out = slugify(long);
    expect(out.length).toBe(80);
    expect(out.endsWith('-')).toBe(false);
  });

  test('emoji 替换为连字符', () => {
    expect(slugify('a 🎉 b')).toBe('a-b');
  });
});

describe('oldUrlFromSlug', () => {
  test('YYYYMMDD[hash] 格式 → 去除方括号', () => {
    expect(oldUrlFromSlug('20260817[05hog4]')).toBe('/posts/2026081705hog4/');
  });

  test('YYYY-MM-DD-slug 格式 → 去除连字符', () => {
    expect(oldUrlFromSlug('2024-01-15-hello')).toBe('/posts/20240115hello/');
  });

  test('纯 hash 格式保留', () => {
    expect(oldUrlFromSlug('2026081705hog4')).toBe('/posts/2026081705hog4/');
  });
});

describe('rewriteCoverImage', () => {
  test('改写 cover.image 路径', () => {
    const raw = `---
title: x
cover:
  image: "images/covers/oldslug.svg"
  alt: ""
  hidden: false
---
body`;
    const out = rewriteCoverImage(raw, 'oldslug', 'newslug');
    expect(out).toContain('images/covers/newslug.svg');
    expect(out).not.toContain('images/covers/oldslug.svg');
  });

  test('保留其他字段不变', () => {
    const raw = `---
title: "Hello"
date: 2025-01-01
cover:
  image: images/covers/oldslug.svg
  alt: alt text
  hidden: true
tags:
  - a
---
body`;
    const out = rewriteCoverImage(raw, 'oldslug', 'newslug');
    expect(out).toContain('title: "Hello"');
    expect(out).toContain('date: 2025-01-01');
    expect(out).toContain('alt text');
    expect(out).toContain('hidden: true');
    expect(out).toContain('tags:');
  });
});

// ─────────────────────────────────────────────────────────────
// 集成：buildReport + detectCollisions（用真实临时文件，不 mock fs）
// ─────────────────────────────────────────────────────────────

interface TempContent {
  /** 添加一个 .md 到 content/posts/，可选添加对应的 cover svg */
  addPost: (filename: string, content: string, opts?: { coverSlug?: string }) => void;
  /** 在 static/images/covers/ 放一个 SVG（即使没有对应 .md） */
  addCover: (slug: string) => void;
  restore: () => void;
}

function setupTempContent(): TempContent {
  const originalCwd = process.cwd();
  const workDir = mkdtempSync(join(tmpdir(), 'rename-posts-build-test-'));
  process.chdir(workDir);
  mkdirSync('content/posts', { recursive: true });
  mkdirSync('static/images/covers', { recursive: true });
  return {
    addPost: (filename, content, opts) => {
      writeFileSync(join('content/posts', filename), content);
      if (opts?.coverSlug) {
        writeFileSync(join('static/images/covers', `${opts.coverSlug}.svg`), '<svg></svg>');
      }
    },
    addCover: (slug) => {
      writeFileSync(join('static/images/covers', `${slug}.svg`), '<svg></svg>');
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
cover:
  image: "images/covers/2024-01-15-hello.svg"
  alt: ""
  hidden: false
---
hello body content`;
    env.addPost('2024-01-15-hello.md', content, { coverSlug: '2024-01-15-hello' });
    env.addPost('_index.md', '---\ntitle: Posts\n---');
    const { plans, skipped } = await buildReport();
    expect(skipped).toEqual([]);
    expect(plans.length).toBe(1);
    expect(plans[0]!.yyyymmdd).toBe('20240115');
    expect(plans[0]!.hash3).toMatch(/^[0-9a-z]{1,4}$/);
    expect(plans[0]!.oldSlug).toBe('2024-01-15-hello');
    // 新格式: YYYYMMDD-{slug}-{hash3}
    expect(plans[0]!.newSlug).toMatch(/^20240115-.+-[a-z0-9]{1,4}$/);
    expect(plans[0]!.cover).not.toBeNull();
    expect(plans[0]!.cover!.newImageField).toBe(`images/covers/${plans[0]!.newSlug}.svg`);
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
    // 模拟脚本的处理：date + slugify(title) + hash3(extractBody(raw))
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

  test('不匹配的 cover 路径不进入 coverUpdate', async () => {
    const content = `---
title: x
date: 2024-01-15
cover:
  image: "images/covers/custom.svg"
---
body`;
    env.addPost('2024-01-15-x.md', content);
    env.addCover('custom');
    const { plans } = await buildReport();
    expect(plans.length).toBe(1);
    expect(plans[0]!.cover).toBeNull();
  });

  test('cover 路径匹配但物理文件不存在时，cover 为 null（不报错）', async () => {
    const content = `---
title: x
date: 2024-01-15
cover:
  image: "images/covers/2024-01-15-x.svg"
---
body`;
    env.addPost('2024-01-15-x.md', content);
    // 不 addCover
    const { plans } = await buildReport();
    expect(plans.length).toBe(1);
    expect(plans[0]!.cover).toBeNull();
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
      cover: null,
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
