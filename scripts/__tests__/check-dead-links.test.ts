import { describe, test, mock, afterEach } from 'node:test';
import {
  extractLinksOutsideCodeBlocks,
  shouldSkip,
  checkUrl,
  trimUrlTail,
  walkMarkdown,
} from '../check-dead-links.js';
import { expect } from './expect.js';
import { inTempDir } from './temp-dir.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  mock.restoreAll();
});

describe('extractLinksOutsideCodeBlocks', () => {
  test('提取普通文本中的链接', () => {
    const raw = 'See https://example.com for details.';
    expect(extractLinksOutsideCodeBlocks(raw)).toEqual(['https://example.com']);
  });

  test('跳过反引号围栏代码块内的链接', () => {
    const raw = `正文 https://example.com/normal

\`\`\`bash
curl https://example.com/in-block
\`\`\`

Another https://example.com/another`;
    expect(extractLinksOutsideCodeBlocks(raw)).toEqual([
      'https://example.com/normal',
      'https://example.com/another',
    ]);
  });

  test('跳过波浪号围栏代码块内的链接', () => {
    const raw = `正文 https://example.com/normal

~~~python
print("https://example.com/in-block")
~~~

Another https://example.com/another`;
    expect(extractLinksOutsideCodeBlocks(raw)).toEqual([
      'https://example.com/normal',
      'https://example.com/another',
    ]);
  });

  test('无链接返回空数组', () => {
    expect(extractLinksOutsideCodeBlocks('no links here')).toEqual([]);
  });

  test('代码块未闭合时跳过后续内容', () => {
    const raw = '```bash\nhttps://example.com/unclosed\n\nhttps://example.com/after';
    expect(extractLinksOutsideCodeBlocks(raw)).toEqual([]);
  });

  test('抽尾：裸链接后面直接跟中文时只取链接本身', () => {
    const raw = '目前用了https://github.com/XiaoBinin/Actions-immortalwrt的固件，不打算换。';
    expect(extractLinksOutsideCodeBlocks(raw)).toEqual([
      'https://github.com/XiaoBinin/Actions-immortalwrt',
    ]);
  });
});

describe('shouldSkip', () => {
  test('跳过 localhost', () => {
    expect(shouldSkip('http://localhost:3000/foo')).toBe(true);
  });

  test('跳过 127.0.0.1', () => {
    expect(shouldSkip('http://127.0.0.1:8080/foo')).toBe(true);
  });

  test('不跳过普通域名', () => {
    expect(shouldSkip('https://example.com')).toBe(false);
  });

  test('非法 URL 跳过', () => {
    expect(shouldSkip('not a url')).toBe(true);
  });
});

describe('checkUrl', () => {
  test('200 返回 ok', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve(new Response(null, { status: 200, statusText: 'OK' }))) as unknown as typeof fetch;
    const result = await checkUrl('https://example.com');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  test('405 触发 GET 二次请求', async () => {
    globalThis.fetch = mock.fn((() => {
      let call = 0;
      return () => {
        call++;
        if (call === 1) {
          return Promise.resolve(new Response(null, { status: 405 }));
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      };
    })()) as unknown as typeof fetch;
    const result = await checkUrl('https://example.com');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2);
  });

  test('404 返回失败', async () => {
    globalThis.fetch = mock.fn(() => Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof fetch;
    const result = await checkUrl('https://example.com');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  test('超时返回 timeout', async () => {
    globalThis.fetch = mock.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }) as unknown as typeof fetch;
    const result = await checkUrl('https://example.com', 1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('timeout');
  });

  test('网络错误返回 error 状态', async () => {
    globalThis.fetch = mock.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
    const result = await checkUrl('https://example.com');
    expect(result.ok).toBe(false);
    expect(result.status).toContain('network down');
  });
});

describe('trimUrlTail', () => {
  test('剥掉紧跟 URL 的中文正文与尾随句点', () => {
    expect(trimUrlTail('https://github.com/gfwlist/gfwlist就可以基本覆盖大部分的需求.')).toBe(
      'https://github.com/gfwlist/gfwlist',
    );
  });

  test('正文里夹着 ASCII 词也能剥干净', () => {
    const url =
      'https://github.com/XiaoBinin/Actions-immortalwrt的固件，不使用Lean的主要原因是大概2-3小时会断网一次.';
    expect(trimUrlTail(url)).toBe('https://github.com/XiaoBinin/Actions-immortalwrt');
  });

  test('保留 URL 里含中文的 slug 段（站内链接不能被截成 404）', () => {
    expect(trimUrlTail('https://sdttttt.online/posts/20260817-文章的变化-jtc/')).toBe(
      'https://sdttttt.online/posts/20260817-文章的变化-jtc/',
    );
  });

  test('剥掉尾巴上没配对的左括号与其后的中文', () => {
    expect(trimUrlTail('https://sdttttt.online/posts/20260817-文章的变化-1e69/(后缀')).toBe(
      'https://sdttttt.online/posts/20260817-文章的变化-1e69/',
    );
  });

  test('普通链接原样返回', () => {
    expect(trimUrlTail('https://example.com/a-b_c?q=1#x')).toBe('https://example.com/a-b_c?q=1#x');
  });
});

describe('walkMarkdown', () => {
  test('递归遍历 Markdown 文件', () =>
    inTempDir(async () => {
      mkdirSync('content/posts', { recursive: true });
      writeFileSync('content/about.md', '');
      writeFileSync('content/logo.png', '');
      writeFileSync('content/posts/a.md', '');
      writeFileSync('content/posts/b.txt', '');

      const paths: string[] = [];
      for await (const p of walkMarkdown('content')) {
        paths.push(p);
      }
      expect(paths.sort()).toEqual(['content/about.md', 'content/posts/a.md']);
    }));

  test('空目录无产出', () =>
    inTempDir(async () => {
      mkdirSync('content', { recursive: true });
      const paths: string[] = [];
      for await (const p of walkMarkdown('content')) {
        paths.push(p);
      }
      expect(paths).toEqual([]);
    }));
});
