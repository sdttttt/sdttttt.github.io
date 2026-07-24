import { describe, test, expect, mock, afterEach } from 'bun:test';
import {
  hash,
  pick,
  escapeXml,
  slugFromFilename,
  genSvg,
  patternCircleGrid,
  patternDiagonal,
  patternConcentric,
  patternTriangles,
  patternWave,
  patternRectangles,
  patternGrid,
  patternDots,
  parseArgs as parseGenCoversArgs,
  listPosts,
  readPost,
  ensureDir,
  injectCoverField,
  generateFor,
} from '../gen-covers';

afterEach(() => {
  mock.restore();
});

const SAMPLE_PALETTE = {
  name: 'amber',
  bg1: '#1F1F1F',
  bg2: '#0A0A0A',
  accent: '#D97757',
  soft: '#E89271',
};

describe('hash', () => {
  test('同一输入结果一致', () => {
    expect(hash('hello')).toBe(hash('hello'));
  });

  test('不同输入通常不同', () => {
    expect(hash('hello')).not.toBe(hash('world'));
  });

  test('返回值为非负整数', () => {
    const h = hash('anything');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
  });
});

describe('pick', () => {
  test('按 n % length 取值', () => {
    expect(pick(['a', 'b', 'c'], 0)).toBe('a');
    expect(pick(['a', 'b', 'c'], 3)).toBe('a');
    expect(pick(['a', 'b', 'c'], 5)).toBe('c');
  });

  test('负数输入正常归一化', () => {
    expect(pick(['a', 'b', 'c'], -1)).toBe('c');
  });
});

describe('escapeXml', () => {
  test('转义所有特殊字符', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });
});

describe('slugFromFilename', () => {
  test('去除扩展名', () => {
    expect(slugFromFilename('2024-01-01-hello.md')).toBe('2024-01-01-hello');
  });
});

describe('pattern functions', () => {
  const patterns = [
    patternCircleGrid,
    patternDiagonal,
    patternConcentric,
    patternTriangles,
    patternWave,
    patternRectangles,
    patternGrid,
    patternDots,
  ];

  test.each(patterns)('%# returns non-empty SVG string', (fn) => {
    const out = fn(SAMPLE_PALETTE);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  test('同一输入结果确定', () => {
    expect(patternCircleGrid(SAMPLE_PALETTE)).toBe(patternCircleGrid(SAMPLE_PALETTE));
  });
});

describe('genSvg', () => {
  test('输出包含 svg 基本元素', () => {
    const svg = genSvg('Hello', 'default');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<defs');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<text');
    expect(svg).toContain('<circle');
  });

  test('相同 seed 输出相同', () => {
    expect(genSvg('seed', 'default')).toBe(genSvg('seed', 'default'));
  });

  test('不同 seed 输出不同', () => {
    expect(genSvg('seed-a', 'default')).not.toBe(genSvg('seed-b', 'default'));
  });

  test('提取 4 位年份', () => {
    const svg = genSvg('2024-hello-world', 'default');
    expect(svg).toContain('2024');
  });
});

describe('parseGenCoversArgs', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  test('--all 模式', () => {
    process.argv = ['bun', 'script', '--all'];
    expect(parseGenCoversArgs()).toEqual({ mode: 'all', force: false, inject: false });
  });

  test('无参数为 dry-run 模式', () => {
    process.argv = ['bun', 'script'];
    expect(parseGenCoversArgs()).toEqual({ mode: 'dry-run', force: false, inject: false });
  });

  test('传入文件名为 files 模式', () => {
    process.argv = ['bun', 'script', 'a.md', 'b.md'];
    expect(parseGenCoversArgs()).toEqual({ mode: 'files', files: ['a.md', 'b.md'], force: false, inject: false });
  });

  test('--force 和 --inject-fm 被解析', () => {
    process.argv = ['bun', 'script', '--all', '--force', '--inject-fm'];
    expect(parseGenCoversArgs()).toEqual({ mode: 'all', force: true, inject: true });
  });
});

describe('listPosts', () => {
  test('返回排序后的 Markdown 文件，排除 _index.md', async () => {
    mock.module('node:fs/promises', () => ({
      readdir: mock(async () => ['b.md', '_index.md', 'a.md', 'c.txt']),
    }));
    expect(await listPosts()).toEqual(['a.md', 'b.md']);
  });
});

describe('readPost', () => {
  test('解析 front matter 并返回 slug', async () => {
    mock.module('node:fs/promises', () => ({
      readFile: mock(async () => '---\ntitle: Hello\n---\n'),
    }));
    const post = await readPost('2024-01-01-hello.md');
    expect(post.meta).toEqual({ title: 'Hello' });
    expect(post.slug).toBe('2024-01-01-hello');
  });
});

describe('ensureDir', () => {
  test('调用 mkdir recursive', async () => {
    const mkdir = mock(async () => undefined);
    mock.module('node:fs/promises', () => ({
      mkdir,
    }));
    await ensureDir('assets/images/covers');
    expect(mkdir).toHaveBeenCalledWith('assets/images/covers', { recursive: true });
  });
});

describe('injectCoverField', () => {
  const originalWriteFile = process.env.__mock_writeFile;

  test('无 cover 的文章追加 cover 块', async () => {
    const writeFile = mock(async () => undefined);
    mock.module('node:fs/promises', () => ({
      readFile: mock(async () => '---\ntitle: Hello\n---\n'),
      writeFile,
    }));

    await injectCoverField(['hello.md'], { dryRun: false });
    expect(writeFile).toHaveBeenCalled();
    const written = writeFile.mock.calls[0][1] as string;
    expect(written).toContain('cover:');
    expect(written).toContain('images/covers/hello.svg');
  });

  test('dry-run 不写入', async () => {
    const writeFile = mock(async () => undefined);
    mock.module('node:fs/promises', () => ({
      readFile: mock(async () => '---\ntitle: Hello\n---\n'),
      writeFile,
    }));

    await injectCoverField(['hello.md'], { dryRun: true });
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('generateFor', () => {
  test('无 cover 生成 SVG', async () => {
    const writeFile = mock(async () => undefined);
    mock.module('node:fs/promises', () => ({
      readFile: mock(async () => '---\ntitle: Hello\n---\n'),
      writeFile,
      mkdir: mock(async () => undefined),
    }));

    await generateFor(['hello.md'], { force: false, dryRun: false });
    expect(writeFile).toHaveBeenCalled();
    const written = writeFile.mock.calls[0][1] as string;
    expect(written).toContain('<svg');
  });

  test('dry-run 不写入', async () => {
    const writeFile = mock(async () => undefined);
    mock.module('node:fs/promises', () => ({
      readFile: mock(async () => '---\ntitle: Hello\n---\n'),
      writeFile,
      mkdir: mock(async () => undefined),
    }));

    await generateFor(['hello.md'], { force: false, dryRun: true });
    expect(writeFile).not.toHaveBeenCalled();
  });
});
