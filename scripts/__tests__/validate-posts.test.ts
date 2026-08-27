import { describe, test } from 'node:test';
import { isValidDate, coverExists, validate } from '../validate-posts.js';
import { expect } from './expect.js';
import { inTempDir } from './temp-dir.js';
import { mkdirSync, writeFileSync } from 'node:fs';

describe('isValidDate', () => {
  test('合法 YYYY-MM-DD 通过', () => {
    expect(isValidDate('2024-01-15')).toBe(true);
  });

  test('非法日期返回 false', () => {
    expect(isValidDate('not-a-date')).toBe(false);
  });

  test('空字符串返回 false', () => {
    expect(isValidDate('')).toBe(false);
  });
});

describe('coverExists', () => {
  test('http 外链直接返回 true', async () => {
    expect(await coverExists('http://example.com/cover.svg')).toBe(true);
  });

  test('https 外链直接返回 true', async () => {
    expect(await coverExists('https://example.com/cover.svg')).toBe(true);
  });

  test('assets 下存在返回 true', () =>
    inTempDir(async () => {
      mkdirSync('assets/images/covers', { recursive: true });
      writeFileSync('assets/images/covers/cover.svg', '<svg></svg>');
      expect(await coverExists('images/covers/cover.svg')).toBe(true);
    }));

  test('static 下存在返回 true', () =>
    inTempDir(async () => {
      mkdirSync('static/images/covers', { recursive: true });
      writeFileSync('static/images/covers/cover.svg', '<svg></svg>');
      expect(await coverExists('images/covers/cover.svg')).toBe(true);
    }));

  test('缺失返回 false', () =>
    inTempDir(async () => {
      expect(await coverExists('images/covers/missing.svg')).toBe(false);
    }));

  test('带前导斜杠正确处理', () =>
    inTempDir(async () => {
      mkdirSync('assets/images/covers', { recursive: true });
      writeFileSync('assets/images/covers/cover.svg', '<svg></svg>');
      expect(await coverExists('/images/covers/cover.svg')).toBe(true);
    }));
});

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

  test('private 非布尔', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/posts/hello.md', '---\ntitle: Hello\ndate: 2024-01-15\nprivate: "yes"\n---\n');
      const issues = await validate();
      expect(issues.some((i) => i.message.includes('private'))).toBe(true);
    }));

  test('本地封面文件不存在', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync(
        'content/posts/hello.md',
        '---\ntitle: Hello\ndate: 2024-01-15\ncover:\n  image: images/covers/missing.svg\n---\n',
      );
      const issues = await validate();
      expect(issues.some((i) => i.message.includes('封面文件不存在'))).toBe(true);
    }));
});
