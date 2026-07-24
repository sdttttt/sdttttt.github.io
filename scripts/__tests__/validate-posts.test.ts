import { describe, test, expect, mock, afterEach } from 'bun:test';
import { isValidDate, coverExists, validate } from '../validate-posts';

afterEach(() => {
  mock.restore();
});

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

  test('assets 下存在返回 true', async () => {
    mock.module('node:fs/promises', () => ({
      stat: mock(async (path: string) => {
        if (path === 'assets/images/covers/cover.svg') return {};
        throw new Error('not found');
      }),
    }));
    expect(await coverExists('images/covers/cover.svg')).toBe(true);
  });

  test('static 下存在返回 true', async () => {
    mock.module('node:fs/promises', () => ({
      stat: mock(async (path: string) => {
        if (path === 'static/images/covers/cover.svg') return {};
        throw new Error('not found');
      }),
    }));
    expect(await coverExists('images/covers/cover.svg')).toBe(true);
  });

  test('缺失返回 false', async () => {
    mock.module('node:fs/promises', () => ({
      stat: mock(async () => {
        throw new Error('not found');
      }),
    }));
    expect(await coverExists('images/covers/missing.svg')).toBe(false);
  });

  test('带前导斜杠正确处理', async () => {
    mock.module('node:fs/promises', () => ({
      stat: mock(async (path: string) => {
        if (path === 'assets/images/covers/cover.svg') return {};
        throw new Error('not found');
      }),
    }));
    expect(await coverExists('/images/covers/cover.svg')).toBe(true);
  });
});

describe('validate', () => {
  function mockFs(files: Record<string, string>) {
    mock.module('node:fs/promises', () => ({
      readdir: mock(async () => Object.keys(files).map((name) => name)),
      readFile: mock(async (path: string) => {
        const name = path.split('/').pop()!;
        return files[name] ?? '';
      }),
    }));
  }

  test('有效文章无问题', async () => {
    mockFs({
      'hello.md': '---\ntitle: Hello\ndate: 2024-01-15\n---\n',
    });
    const issues = await validate();
    expect(issues).toEqual([]);
  });

  test('缺少 title', async () => {
    mockFs({
      'hello.md': '---\ndate: 2024-01-15\n---\n',
    });
    const issues = await validate();
    expect(issues.some((i) => i.message.includes('title'))).toBe(true);
  });

  test('title 为空字符串', async () => {
    mockFs({
      'hello.md': '---\ntitle: " "\ndate: 2024-01-15\n---\n',
    });
    const issues = await validate();
    expect(issues.some((i) => i.message.includes('title'))).toBe(true);
  });

  test('缺少 date', async () => {
    mockFs({
      'hello.md': '---\ntitle: Hello\n---\n',
    });
    const issues = await validate();
    expect(issues.some((i) => i.message.includes('date'))).toBe(true);
  });

  test('date 格式无效', async () => {
    mockFs({
      'hello.md': '---\ntitle: Hello\ndate: invalid\n---\n',
    });
    const issues = await validate();
    expect(issues.some((i) => i.message.includes('date'))).toBe(true);
  });

  test('重复 slug', async () => {
    mockFs({
      'hello.md': '---\ntitle: Hello\ndate: 2024-01-15\n---\n',
      'hello-copy.md': '---\ntitle: Hello 2\ndate: 2024-01-16\n---\n',
    });
    const issues = await validate();
    expect(issues.some((i) => i.message.includes('slug'))).toBe(false);
  });

  test('private 非布尔', async () => {
    mockFs({
      'hello.md': '---\ntitle: Hello\ndate: 2024-01-15\nprivate: "yes"\n---\n',
    });
    const issues = await validate();
    expect(issues.some((i) => i.message.includes('private'))).toBe(true);
  });

  test('本地封面文件不存在', async () => {
    mock.module('node:fs/promises', () => ({
      readdir: mock(async () => ['hello.md']),
      readFile: mock(async () => '---\ntitle: Hello\ndate: 2024-01-15\ncover:\n  image: images/covers/missing.svg\n---\n'),
      stat: mock(async () => {
        throw new Error('not found');
      }),
    }));
    const issues = await validate();
    expect(issues.some((i) => i.message.includes('封面文件不存在'))).toBe(true);
  });
});
