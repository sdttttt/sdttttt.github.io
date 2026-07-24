import { describe, test, expect } from 'bun:test';
import { parseFrontMatter, extractFrontMatterBlock } from '../lib/frontmatter';

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
