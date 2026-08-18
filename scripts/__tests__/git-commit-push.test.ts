import { describe, test } from 'node:test';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { classifyStagedChanges } from '../git-commit-push.js';
import { inTempDir } from './temp-dir.js';
import { expect } from './expect.js';

/**
 * 在临时目录里创建一个最小 git 仓库，便于测试 classifyStagedChanges。
 * 函数体内 `process.cwd()` 已经在 inTempDir 切到 workDir。
 */
function initRepo(): void {
  execSync('git init -q', { stdio: 'pipe' });
  execSync('git config user.email test@test', { stdio: 'pipe' });
  execSync('git config user.name test', { stdio: 'pipe' });
  // 让 git 在 --name-status 下输出 rename 检测（默认就是 50%，这里显式开启）
  execSync('git config diff.renames true', { stdio: 'pipe' });
}

/**
 * 写一篇"像样"的 post（有 frontmatter + 多行 body），让 git rename 检测能识别。
 * body 至少 30 行，覆盖足够多的内容，让 -M20% 在 body 微调后仍识别为 rename。
 */
function writePost(path: string, opts: { fm?: string; body?: string } = {}): void {
  const fm = opts.fm ?? 'title: foo\ndate: 2024-01-15';
  const lines: string[] = ['# 标题'];
  for (let i = 0; i < 40; i++) {
    lines.push('');
    lines.push(`第 ${i + 1} 段：这里堆一些内容，让文件足够长，便于 git rename 检测在 body 微调后仍然成立。`);
  }
  const body = opts.body ?? lines.join('\n');
  const content = `---\n${fm}\n---\n\n${body}\n`;
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(path, content);
}

function gitAdd(): void {
  execSync('git add -A', { stdio: 'pipe' });
}

function gitCommit(msg: string): void {
  execSync(`git commit -q -m "${msg}"`, { stdio: 'pipe' });
}

/**
 * 改 body 的微调：在文件尾部追加一行，模拟 prettier 格式化引入的小改动。
 */
function tweakBody(path: string): void {
  execSync(`printf '\\n末尾追加一行。\\n' >> ${path}`, { stdio: 'pipe' });
}

describe('classifyStagedChanges', () => {
  test('空 staged（无变更）→ null', async () => {
    await inTempDir(() => {
      initRepo();
      expect(classifyStagedChanges()).toBeNull();
    });
  });

  test('纯 rename posts（rename-posts 漂移场景）→ chore(rename)', async () => {
    await inTempDir(() => {
      initRepo();
      writePost('content/posts/20240115-foo-bar-aaa.md');
      gitAdd();
      gitCommit('init');

      // 模拟 rename-posts.js：先 git mv 改文件名，再 append 一行让 hash 漂移
      execSync('git mv content/posts/20240115-foo-bar-aaa.md content/posts/20240115-foo-bar-bbb.md', { stdio: 'pipe' });
      tweakBody('content/posts/20240115-foo-bar-bbb.md');
      gitAdd();
      expect(classifyStagedChanges()).toBe('chore(rename): sync post slugs (1 files)');
    });
  });

  test('多个 rename posts → 文件数正确', async () => {
    await inTempDir(() => {
      initRepo();
      writePost('content/posts/20240115-aaa-x.md');
      writePost('content/posts/20240116-bbb-y.md');
      gitAdd();
      gitCommit('init');

      execSync('git mv content/posts/20240115-aaa-x.md content/posts/20240115-aaa-z.md', { stdio: 'pipe' });
      execSync('git mv content/posts/20240116-bbb-y.md content/posts/20240116-bbb-w.md', { stdio: 'pipe' });
      tweakBody('content/posts/20240115-aaa-z.md');
      tweakBody('content/posts/20240116-bbb-w.md');
      gitAdd();
      expect(classifyStagedChanges()).toBe('chore(rename): sync post slugs (2 files)');
    });
  });

  test('纯 frontmatter 修改 → chore(fm)', async () => {
    await inTempDir(() => {
      initRepo();
      writePost('content/posts/20240115-foo-bar-aaa.md');
      gitAdd();
      gitCommit('init');

      // 仅改 frontmatter 的 cover.image 字段
      writePost('content/posts/20240115-foo-bar-aaa.md', {
        fm: 'title: foo\ndate: 2024-01-15\ncover:\n  image: new/path.svg',
      });
      gitAdd();
      expect(classifyStagedChanges()).toBe('chore(fm): inject frontmatter (1 files)');
    });
  });

  test('body 实质修改 → chore(format)', async () => {
    await inTempDir(() => {
      initRepo();
      writePost('content/posts/20240115-foo-bar-aaa.md');
      gitAdd();
      gitCommit('init');

      // 改 frontmatter + body 都改
      writePost('content/posts/20240115-foo-bar-aaa.md', {
        fm: 'title: foo\ndate: 2024-01-15\ncover:\n  image: x.svg',
        body: '# 标题\n\n完全不一样的段落。',
      });
      gitAdd();
      expect(classifyStagedChanges()).toBe('chore(format): prettier markdown (1 files)');
    });
  });

  test('只新增 cover svg → chore(covers) +N', async () => {
    await inTempDir(() => {
      initRepo();
      // 需要先有 commit，否则第一个 commit 就被当成 A
      writeFileSync('README.md', '# readme');
      gitAdd();
      gitCommit('init');

      mkdirSync('static/images/covers', { recursive: true });
      writeFileSync('static/images/covers/20240115-foo-bar-aaa.svg', '<svg/>');
      gitAdd();
      expect(classifyStagedChanges()).toBe('chore(covers): +1 cover image');
    });
  });

  test('只删除 cover svg → chore(covers) -N', async () => {
    await inTempDir(() => {
      initRepo();
      mkdirSync('static/images/covers', { recursive: true });
      writeFileSync('static/images/covers/old.svg', '<svg/>');
      gitAdd();
      gitCommit('init');

      execSync('git rm -q static/images/covers/old.svg', { stdio: 'pipe' });
      expect(classifyStagedChanges()).toBe('chore(covers): -1 cover image');
    });
  });

  test('混合 rename + fm 修改 → null（无法精确分类）', async () => {
    await inTempDir(() => {
      initRepo();
      writePost('content/posts/20240115-foo-bar-aaa.md');
      writePost('content/posts/20240116-baz-bar-ccc.md');
      gitAdd();
      gitCommit('init');

      // 一个 rename + 一个纯 fm 修改
      writePost('content/posts/20240115-foo-bar-ddd.md');
      writePost('content/posts/20240116-baz-bar-ccc.md', {
        fm: 'title: foo\ndate: 2024-01-16\ncover:\n  image: y.svg',
      });
      gitAdd();
      expect(classifyStagedChanges()).toBeNull();
    });
  });

  test('混合 markdown 修改 + 非 markdown 修改 → null', async () => {
    await inTempDir(() => {
      initRepo();
      writePost('content/posts/20240115-foo-bar-aaa.md');
      mkdirSync('static/images/covers', { recursive: true });
      writeFileSync('static/images/covers/old.svg', '<svg/>');
      // 预占位：避免 git rm 删除文件后清理空目录导致后续 writeFileSync 失败
      writeFileSync('static/images/covers/.gitkeep', '');
      gitAdd();
      gitCommit('init');

      writePost('content/posts/20240115-foo-bar-aaa.md', {
        fm: 'title: foo\ndate: 2024-01-15\ncover:\n  image: z.svg',
      });
      execSync('git rm -q static/images/covers/old.svg', { stdio: 'pipe' });
      writeFileSync('static/images/covers/new.svg', '<svg/>');
      gitAdd();
      expect(classifyStagedChanges()).toBeNull();
    });
  });

  test('新增 posts → chore(posts) +N', async () => {
    await inTempDir(() => {
      initRepo();
      writeFileSync('README.md', '# readme');
      gitAdd();
      gitCommit('init');

      writePost('content/posts/20240115-foo-bar-aaa.md');
      gitAdd();
      expect(classifyStagedChanges()).toBe('chore(posts): +1 post');
    });
  });

  test('多个 markdown format 修改 → 文件数正确', async () => {
    await inTempDir(() => {
      initRepo();
      writePost('content/posts/a.md');
      writePost('content/posts/b.md');
      gitAdd();
      gitCommit('init');

      writePost('content/posts/a.md', { body: '# 标题\n\n内容变更。' });
      writePost('content/posts/b.md', { body: '# 标题2\n\n内容2变更。' });
      gitAdd();
      expect(classifyStagedChanges()).toBe('chore(format): prettier markdown (2 files)');
    });
  });

  test('rename + new file → null', async () => {
    await inTempDir(() => {
      initRepo();
      writePost('content/posts/20240115-foo-bar-aaa.md');
      gitAdd();
      gitCommit('init');

      execSync('git mv content/posts/20240115-foo-bar-aaa.md content/posts/20240115-foo-bar-bbb.md', { stdio: 'pipe' });
      tweakBody('content/posts/20240115-foo-bar-bbb.md');
      writePost('content/posts/20240116-new-post-xxx.md');
      gitAdd();
      expect(classifyStagedChanges()).toBeNull();
    });
  });

  test('未在 git 仓库中 → null（不抛错）', async () => {
    await inTempDir(() => {
      // 注意：这里故意不 initRepo
      expect(classifyStagedChanges()).toBeNull();
    });
  });
});
