import { describe, test } from 'node:test';
import { validate } from '../validate-posts.js';
import { expect } from './expect.js';
import { inTempDir } from './temp-dir.js';
import { mkdirSync, writeFileSync } from 'node:fs';

// 注：原先这里有一组 isValidDate 用例。日期判据已统一到 lib/frontmatter.ts 的
// toYyyymmdd（真实日历校验），用例也随之集中到 frontmatter.test.ts，
// 避免同一份判据在两个测试文件里各断言一遍。
describe('validate', () => {
  test('有效文章无问题', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/posts/hello.md', '---\ntitle: Hello\ndate: 2024-01-15\n---\n');
      const issues = await validate();
      expect(issues).toEqual([]);
    }));

  test('缺少 title', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/posts/hello.md', '---\ndate: 2024-01-15\n---\n');
      const issues = await validate();
      expect(issues.some((i) => i.message.includes('title'))).toBe(true);
    }));

  test('title 为空字符串', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/posts/hello.md', '---\ntitle: " "\ndate: 2024-01-15\n---\n');
      const issues = await validate();
      expect(issues.some((i) => i.message.includes('title'))).toBe(true);
    }));

  test('缺少 date', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/posts/hello.md', '---\ntitle: Hello\n---\n');
      const issues = await validate();
      expect(issues.some((i) => i.message.includes('date'))).toBe(true);
    }));

  test('date 格式无效', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/posts/hello.md', '---\ntitle: Hello\ndate: invalid\n---\n');
      const issues = await validate();
      expect(issues.some((i) => i.message.includes('date'))).toBe(true);
    }));

  test('日历上不存在的日期也算无效（Date.parse 会把它滚到 3/3）', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/posts/hello.md', '---\ntitle: Hello\ndate: 2026-02-31\n---\n');
      const issues = await validate();
      expect(issues.some((i) => i.message.includes('date'))).toBe(true);
    }));

  test('slug 不重复时不报错', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      // 注：旧版这个测试名叫"重复 slug"，但实际只验证了"两个不同 slug 不报错"。
      // 真正能造出"裸名相同的两个不同文件"需要 mock readdir，POSIX 下几乎做不到；
      // slug 去重的核心逻辑只有一行（`slugs.has(slug)`），集成测试覆盖成本太高，
      // 直接删掉旧断言，避免误导未来的读者以为它在测"重复"。
      writeFileSync('content/posts/hello.md', '---\ntitle: Hello\ndate: 2024-01-15\n---\n');
      writeFileSync('content/posts/world.md', '---\ntitle: World\ndate: 2024-01-16\n---\n');
      const issues = await validate();
      expect(issues.some((i) => i.message.includes('slug 重复'))).toBe(false);
    }));

  test('title 与 date 都缺时两条都报（判据来自 lib/frontmatter 的共享清单）', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/posts/hello.md', '没有 front matter 的正文');
      const issues = await validate();
      expect(issues.map((i) => i.message)).toEqual([
        '缺少 title 或 title 为空',
        '缺少 date 字段',
      ]);
    }));
});
