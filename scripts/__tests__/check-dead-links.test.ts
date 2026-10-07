import { describe, test, mock, afterEach } from 'node:test';
import {
  extractLinksOutsideCodeBlocks,
  partitionByStatus,
  shouldSkip,
  isArchived,
  isAntiCrawlHost,
  ARCHIVED_URLS,
  checkUrl,
  trimUrlTail,
  walkMarkdown,
} from '../check-dead-links.js';
import { expect } from './expect.js';
import { inTempDir } from './temp-dir.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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

describe('已归档的已知死链', () => {
  test('归档清单里的链接算已归档，普通链接不算', () => {
    expect(isArchived('https://github.com/Awesome-Windows/Awesome')).toBe(true);
    expect(isArchived('https://example.com/')).toBe(false);
  });

  // 允许清单是「不报」的特权，所以它自己得有人管：每条都必须在正文里真的出现、
  // 并且带一句说明，否则就是「悄悄放行了一条死链」。
  test('归档清单不腐：每条都在正文里出现、且带「仅作存档」说明', async () => {
    const hits = new Map<string, string[]>();
    for (const url of ARCHIVED_URLS) hits.set(url, []);

    for await (const path of walkMarkdown('content')) {
      const raw = readFileSync(path, 'utf8');
      for (const url of ARCHIVED_URLS) {
        if (raw.includes(url)) hits.get(url)!.push(raw);
      }
    }

    for (const [, files] of hits) {
      expect(files.length > 0).toBe(true);
      expect(files.some((raw) => raw.includes('仅作存档'))).toBe(true);
    }
  });
});

describe('partitionByStatus', () => {
  const references = [
    { file: 'a.md', url: 'https://gone.example/404' },
    { file: 'b.md', url: 'https://forbidden.example/' },
    { file: 'c.md', url: 'https://legal.example/' },
    { file: 'd.md', url: 'https://slow.example/' },
    { file: 'e.md', url: 'https://down.example/' },
    { file: 'f.md', url: 'https://ok.example/' },
  ];
  const statuses = new Map([
    ['https://gone.example/404', { ok: false, status: 404 }],
    ['https://forbidden.example/', { ok: false, status: 403 }],
    ['https://legal.example/', { ok: false, status: 451 }],
    ['https://slow.example/', { ok: false, status: 'timeout' }],
    ['https://down.example/', { ok: false, status: 'error: fetch failed' }],
    ['https://ok.example/', { ok: true, status: 200 }],
  ]);

  test('404 / 超时 / DNS 失败都算死链', () => {
    const { dead } = partitionByStatus(references, statuses);
    expect(dead.map((d) => d.url)).toEqual([
      'https://gone.example/404',
      'https://slow.example/',
      'https://down.example/',
    ]);
  });

  test('403 / 451 归到「被拦住」，不算死链', () => {
    const { blocked } = partitionByStatus(references, statuses);
    expect(blocked.map((d) => d.url + ' (' + d.status + ')')).toEqual([
      'https://forbidden.example/ (403)',
      'https://legal.example/ (451)',
    ]);
  });

  test('反爬域名下的 404 也算「没能验证」（百度百科时而 403 时而 404）', () => {
    const refs = [{ file: 'a.md', url: 'https://baike.baidu.com/item/UDP/571511' }];
    const st = new Map([['https://baike.baidu.com/item/UDP/571511', { ok: false, status: 404 }]]);
    const { dead, blocked } = partitionByStatus(refs, st);
    expect(dead.length).toBe(0);
    expect(blocked.map((d) => d.url + ' (' + d.status + ')')).toEqual([
      'https://baike.baidu.com/item/UDP/571511 (404)',
    ]);
    expect(isAntiCrawlHost('https://baike.baidu.com/item/x')).toBe(true);
    expect(isAntiCrawlHost('https://example.com/')).toBe(false);
    // 不是合法 URL 时不该抛异常
    expect(isAntiCrawlHost('not-a-url')).toBe(false);
  });

  test('ok 的链接两组都不进', () => {
    const { dead, blocked } = partitionByStatus(references, statuses);
    const seen = [...dead, ...blocked].map((d) => d.url);
    expect(seen).toEqual([
      'https://gone.example/404',
      'https://slow.example/',
      'https://down.example/',
      'https://forbidden.example/',
      'https://legal.example/',
    ]);
  });
});
