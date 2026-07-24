import { describe, test, expect, mock, afterEach } from 'bun:test';
import {
  extractLinksOutsideCodeBlocks,
  shouldSkip,
  checkUrl,
  checkUrlGet,
  walkMarkdown,
} from '../check-dead-links';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  mock.restore();
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
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 200, statusText: 'OK' })));
    const result = await checkUrl('https://example.com');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  test('405 触发 GET 二次请求', async () => {
    globalThis.fetch = mock((() => {
      let call = 0;
      return () => {
        call++;
        if (call === 1) {
          return Promise.resolve(new Response(null, { status: 405 }));
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      };
    })());
    const result = await checkUrl('https://example.com');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect((globalThis.fetch as any).mock.calls.length).toBe(2);
  });

  test('404 返回失败', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 404 })));
    const result = await checkUrl('https://example.com');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  test('超时返回 timeout', async () => {
    globalThis.fetch = mock((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    const result = await checkUrl('https://example.com', 1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe('timeout');
  });

  test('网络错误返回 error 状态', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network down')));
    const result = await checkUrl('https://example.com');
    expect(result.ok).toBe(false);
    expect(result.status).toContain('network down');
  });
});

describe('checkUrlGet', () => {
  test('使用 GET 方法', async () => {
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      expect(init.method).toBe('GET');
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const result = await checkUrlGet('https://example.com');
    expect(result.ok).toBe(true);
  });
});

describe('walkMarkdown', () => {
  test('递归遍历 Markdown 文件', async () => {
    mock.module('node:fs/promises', () => ({
      readdir: mock(async (dir: string) => {
        if (dir === 'content') {
          return [
            { name: 'posts', isDirectory: () => true, isFile: () => false },
            { name: 'about.md', isDirectory: () => false, isFile: () => true },
            { name: 'logo.png', isDirectory: () => false, isFile: () => true },
          ];
        }
        if (dir === 'content/posts') {
          return [
            { name: 'a.md', isDirectory: () => false, isFile: () => true },
            { name: 'b.txt', isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      }),
    }));

    const paths: string[] = [];
    for await (const p of walkMarkdown('content')) {
      paths.push(p);
    }
    expect(paths.sort()).toEqual(['content/about.md', 'content/posts/a.md']);
  });

  test('空目录无产出', async () => {
    mock.module('node:fs/promises', () => ({
      readdir: mock(async () => []),
    }));

    const paths: string[] = [];
    for await (const p of walkMarkdown('content')) {
      paths.push(p);
    }
    expect(paths).toEqual([]);
  });
});
