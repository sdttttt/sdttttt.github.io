/**
 * 集成测试：executePlan（用真实 git repo 验证 index 同步）
 *
 * 关键回归测试：writeFile 后必须 `git add` 让 index 同步，否则 git mv
 * 搬走的是 index 里的旧内容，commit 拿到「新路径 + 旧内容」。
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { executePlan, type RenamePlan } from '../rename-posts.js';
import { expect } from './expect.js';

function runShell(args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0]!, args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr!.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exit) => {
      resolve({ exit: exit ?? -1, stdout, stderr });
    });
  });
}

/**
 * 在指定工作目录、指定 PATH 下跑一个 deno 子进程。
 *
 * 为什么必须换成子进程：spawn 找不到可执行文件时是发 'error' 事件（异步），
 * 而 node:test 的 shim 会把这种 uncaught error 吞掉 —— 同进程里怎么写都测不出
 * 「进程直接崩掉」这个后果（实测：把 error 监听删掉，同进程测试照样全绿）。
 */
async function runDenoScript(
  args: string[],
  { cwd, path }: { cwd: string; path: string },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    env: { PATH: path },
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const decode = new TextDecoder();
  return { code, stdout: decode.decode(stdout), stderr: decode.decode(stderr) };
}

async function setupTempGitRepo(): Promise<{ workDir: string; restore: () => void }> {
  const originalCwd = process.cwd();
  const workDir = mkdtempSync(join(tmpdir(), 'rename-posts-test-'));
  process.chdir(workDir);

  await runShell(['git', 'init', '-q']);
  await runShell(['git', 'config', 'user.email', 'test@test']);
  await runShell(['git', 'config', 'user.name', 'test']);
  mkdirSync('content/posts', { recursive: true });

  return {
    workDir,
    restore: () => {
      process.chdir(originalCwd);
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

describe('executePlan（真实 git repo 集成）', () => {
  let state: { workDir: string; restore: () => void };

  beforeEach(async () => {
    state = await setupTempGitRepo();
  });

  afterEach(() => {
    state.restore();
  });

  test('rename + frontmatter 改写后 commit 拿到的内容是新内容（不是 index 旧内容）', async () => {
    const oldSlug = '2020-01-01-hello';
    const newSlug = '20200101-hello-zzz';
    const mdContent = `---
title: Hello
date: 2020-01-01
tags:
  - old
---
hello body content`;

    writeFileSync(`content/posts/${oldSlug}.md`, mdContent);
    await runShell(['git', 'add', '.']);
    await runShell(['git', 'commit', '-q', '-m', 'initial']);

    const plan: RenamePlan = {
      oldPath: `content/posts/${oldSlug}.md`,
      newPath: `content/posts/${newSlug}.md`,
      oldSlug,
      newSlug,
      yyyymmdd: '20200101',
      hash3: 'zzz',
      title: 'Hello',
      oldUrl: `/posts/20200101hello/`,
      body: 'hello body content',
    };

    await executePlan(plan);

    // 1) 文件系统状态：旧路径消失，新路径存在
    expect(existsSync(plan.oldPath)).toBe(false);
    expect(existsSync(plan.newPath)).toBe(true);

    // 2) Working tree 内容应保留 frontmatter
    const wtContent = readFileSync(plan.newPath, 'utf8');
    expect(wtContent).toContain('title: Hello');
    expect(wtContent).toContain('date: 2020-01-01');

    // 3) Git commit 应能成功（验证 index 已被正确更新，无需 git add）
    const commit = await runShell(['git', 'commit', '-q', '-m', 'rename']);
    expect(commit.exit).toBe(0);
    const committed = (await runShell(['git', 'show', `HEAD:content/posts/${newSlug}.md`])).stdout;
    expect(committed).toContain('title: Hello');

    // 4) Git status 应干净
    const status = (await runShell(['git', 'status', '--porcelain'])).stdout;
    expect(status.trim()).toBe('');
  });

  test('纯 rename（无 frontmatter 改动）也能正常执行', async () => {
    const oldSlug = '2020-02-02-no-fm-change';
    const newSlug = '20200202-no-fm-change-xxx';
    const mdContent = `---
title: No Change
date: 2020-02-02
---
body`;

    writeFileSync(`content/posts/${oldSlug}.md`, mdContent);
    await runShell(['git', 'add', '.']);
    await runShell(['git', 'commit', '-q', '-m', 'initial']);

    const plan: RenamePlan = {
      oldPath: `content/posts/${oldSlug}.md`,
      newPath: `content/posts/${newSlug}.md`,
      oldSlug,
      newSlug,
      yyyymmdd: '20200202',
      hash3: 'xxx',
      title: 'No Change',
      oldUrl: `/posts/20200202nofmchange/`,
      body: 'body',
    };

    await executePlan(plan);

    expect(existsSync(plan.newPath)).toBe(true);
    const commit = await runShell(['git', 'commit', '-q', '-m', 'rename']);
    expect(commit.exit).toBe(0);
    const committed = (await runShell(['git', 'show', `HEAD:content/posts/${newSlug}.md`])).stdout;
    expect(committed).toContain('title: No Change');
  });

});

/**
 * 回归：环境里没有 git 时必须降级为 fs.rename。
 *
 * 旧版 `runGit` 只监听 'close'，而 `spawn git ENOENT` 是以 'error' 事件失败的，
 * 于是它变成 uncaught error 直接终止整个进程 —— 与 moveFile 注释里声明的
 * 「失败/非 git 仓库时降级为 fs.rename」正好相反，连 `--dry-run` 都到不了。
 *
 * 这里必须整条 CLI 跑子进程，见 runDenoScript 的注释。
 */
describe('rename-posts CLI 端到端（PATH 里没有 git）', () => {
  test('降级为 fs.rename，进程不崩、aliases 照写', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'rename-posts-nogit-'));
    try {
      mkdirSync(join(workDir, 'content/posts'), { recursive: true });
      writeFileSync(
        join(workDir, 'content/posts/2020-03-03-no-git.md'),
        '---\ntitle: No Git\ndate: 2020-03-03\n---\nbody\n',
      );

      const script = fileURLToPath(new URL('../rename-posts.ts', import.meta.url));
      const result = await runDenoScript(
        ['run', '--unstable-sloppy-imports', '--no-lock', '-A', script, '--execute'],
        { cwd: workDir, path: '/nonexistent-bin' },
      );

      // 旧代码在这里会打印 `error: Uncaught Error: spawn git ENOENT` 并以 1 退出
      expect(result.stderr).not.toContain('Uncaught');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('✓ 重命名 1 篇文章成功');

      const names = readdirSync(join(workDir, 'content/posts'));
      expect(names.length).toBe(1);
      expect(names[0]).not.toBe('2020-03-03-no-git.md');
      const moved = readFileSync(join(workDir, 'content/posts', names[0]!), 'utf8');
      expect(moved).toContain('title: No Git');
      expect(moved).toContain('aliases: ["/posts/2020-03-03-no-git/"]');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
