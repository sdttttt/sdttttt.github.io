import { describe, test } from 'node:test';
import { parseFrontMatter, extractFrontMatterBlock, checkTitleAndDate, toYyyymmdd } from '../lib/frontmatter.js';
import { expect } from './expect.js';

describe('parseFrontMatter', () => {
  test('空字符串返回空对象', () => {
    expect(parseFrontMatter('')).toEqual({});
  });

  test('没有 front matter 返回空对象', () => {
    expect(parseFrontMatter('# Hello\n\ncontent')).toEqual({});
  });

  test('解析普通字符串值', () => {
    const raw = '---\ntitle: Hello\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ title: 'Hello' });
  });

  test('解析数字', () => {
    const raw = '---\ncount: 42\npi: 3.14\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ count: 42, pi: 3.14 });
  });

  test('解析布尔值', () => {
    const raw = '---\npublished: true\nhidden: false\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ published: true, hidden: false });
  });

  test('解析 null 和 ~', () => {
    const raw = '---\na: null\nb: ~\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ a: null, b: null });
  });

  test('解析简单数组', () => {
    const raw = '---\ntags: [a, b, c]\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ tags: ['a', 'b', 'c'] });
  });

  test('解析一级嵌套对象', () => {
    const raw = '---\ncover:\n  image: cover.svg\n  alt: Cover\n  hidden: false\n---\n';
    expect(parseFrontMatter(raw)).toEqual({
      cover: { image: 'cover.svg', alt: 'Cover', hidden: false },
    });
  });

  test('忽略 YAML 注释', () => {
    const raw = '---\n# comment\ntitle: Hello\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ title: 'Hello' });
  });

  test('忽略空行', () => {
    const raw = '---\n\ntitle: Hello\n\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ title: 'Hello' });
  });

  test('去除单双引号', () => {
    const raw = '---\na: "quoted"\nb: \'single\'\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ a: 'quoted', b: 'single' });
  });

  test('front matter 后的正文不影响解析', () => {
    const raw = '---\ntitle: Hello\n---\n\n# Body\n\ncontent';
    expect(parseFrontMatter(raw)).toEqual({ title: 'Hello' });
  });

  test('非法行被忽略', () => {
    const raw = '---\ntitle: Hello\nnot a key value\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ title: 'Hello' });
  });
});

describe('extractFrontMatterBlock', () => {
  test('返回完整 front matter 块', () => {
    const raw = '---\ntitle: Hello\n---\n# Body';
    expect(extractFrontMatterBlock(raw)).toBe('---\ntitle: Hello\n---');
  });

  test('缺失返回 null', () => {
    expect(extractFrontMatterBlock('# Hello')).toBeNull();
  });
});

describe('parseFrontMatter：块式数组', () => {
  test('aliases 用的是块式数组（addAlias 写出来的形式）', () => {
    const raw = '---\ntitle: x\naliases:\n  - "/posts/a/"\n  - "/posts/b/"\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ title: 'x', aliases: ['/posts/a/', '/posts/b/'] });
  });

  test('块式数组与嵌套对象不会互相污染', () => {
    const raw = '---\ncover:\n  image: cover.svg\naliases:\n  - /a/\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ cover: { image: 'cover.svg' }, aliases: ['/a/'] });
  });

  test('Prettier 折行的 inline 数组（`[` 与 `]` 各占一行）也算数组', () => {
    const raw = '---\ntitle: x\naliases:\n  [\n    "/posts/a/",\n    "/posts/b/",\n  ]\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ title: 'x', aliases: ['/posts/a/', '/posts/b/'] });
  });

  test('空的缩进块仍是对象（历史行为）', () => {
    const raw = '---\ncover:\n---\n';
    expect(parseFrontMatter(raw)).toEqual({ cover: {} });
  });
});

describe('toYyyymmdd', () => {
  test('裸 YYYY-MM-DD', () => {
    expect(toYyyymmdd('2025-05-04')).toBe('20250504');
  });

  test('ISO datetime 取日期部分', () => {
    expect(toYyyymmdd('2020-05-09T13:00:00Z')).toBe('20200509');
  });

  test('一位月日自动补零', () => {
    expect(toYyyymmdd('2024-1-5')).toBe('20240105');
  });

  test('非字符串返回 null', () => {
    expect(toYyyymmdd(null)).toBe(null);
    expect(toYyyymmdd(20250101)).toBe(null);
    expect(toYyyymmdd(undefined)).toBe(null);
  });

  test('完全无效的字符串返回 null', () => {
    expect(toYyyymmdd('hello')).toBe(null);
    expect(toYyyymmdd('')).toBe(null);
  });

  test('斜杠分隔不被接受（Date.parse 会接受它）', () => {
    expect(toYyyymmdd('2026/01/01')).toBe(null);
  });

  test('月日越界返回 null', () => {
    expect(toYyyymmdd('2024-13-01')).toBe(null);
    expect(toYyyymmdd('2024-00-15')).toBe(null);
    expect(toYyyymmdd('2024-01-32')).toBe(null);
  });

  test('日历上不存在的日期返回 null（Date.parse 会滚到 3/3）', () => {
    expect(toYyyymmdd('2026-02-31')).toBe(null);
    expect(toYyyymmdd('2025-02-29')).toBe(null);
  });

  test('闰年 2 月 29 日有效', () => {
    expect(toYyyymmdd('2024-02-29')).toBe('20240229');
  });
});

describe('checkTitleAndDate', () => {
  // validate-posts 与 rename-posts 共用这一份清单（含措辞）
  test('都齐全时没问题', () => {
    expect(checkTitleAndDate({ title: 'Hello', date: '2024-01-15' })).toEqual([]);
  });

  test('缺 title 与 title 为空', () => {
    expect(checkTitleAndDate({ date: '2024-01-15' })).toEqual(['缺少 title 或 title 为空']);
    expect(checkTitleAndDate({ title: '   ', date: '2024-01-15' })).toEqual([
      '缺少 title 或 title 为空',
    ]);
  });

  test('缺 date 与 date 非法分开报', () => {
    expect(checkTitleAndDate({ title: 'Hello' })).toEqual(['缺少 date 字段']);
    expect(checkTitleAndDate({ title: 'Hello', date: 'invalid' })).toEqual([
      'date 格式无效: invalid',
    ]);
  });

  test('日历上不存在的日期算非法', () => {
    expect(checkTitleAndDate({ title: 'Hello', date: '2026-02-31' })).toEqual([
      'date 格式无效: 2026-02-31',
    ]);
  });

  test('两个问题都报（顺序 title → date）', () => {
    expect(checkTitleAndDate({})).toEqual(['缺少 title 或 title 为空', '缺少 date 字段']);
  });
});

