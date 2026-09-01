/**
 * 集成测试：executePlan（用真实 git repo 验证 index 同步）
 *
 * 关键回归测试：writeFile 后必须 `git add` 让 index 同步，否则 git mv
 * 搬走的是 index 里的旧内容，commit 拿到「新路径 + 旧内容」。
 */
import { describe, test, beforeEach, afterEach } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { executePlan } from '../rename-posts.js';
import { expect } from './expect.js';
async function runShell(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (exit) => {
            resolve({ exit: exit ?? -1, stdout, stderr });
        });
    });
}
async function setupTempGitRepo() {
    const originalCwd = process.cwd();
    const workDir = mkdtempSync(join(tmpdir(), 'rename-posts-test-'));
    process.chdir(workDir);
    await runShell(['git', 'init', '-q']);
    await runShell(['git', 'config', 'user.email', 'test@test']);
    await runShell(['git', 'config', 'user.name', 'test']);
    mkdirSync('content/posts', { recursive: true });
    mkdirSync('assets/images/covers', { recursive: true });
    return {
        workDir,
        restore: () => {
            process.chdir(originalCwd);
            rmSync(workDir, { recursive: true, force: true });
        },
    };
}
describe('executePlan（真实 git repo 集成）', () => {
    let state;
    beforeEach(async () => {
        state = await setupTempGitRepo();
    });
    afterEach(() => {
        state.restore();
    });
    test('rename + cover 重写后 commit 拿到的内容是新内容（不是 index 旧内容）', async () => {
        const oldSlug = '2020-01-01-hello';
        const oldCover = `assets/images/covers/${oldSlug}.svg`;
        const newSlug = '20200101[abcdef]';
        const newCover = `assets/images/covers/${newSlug}.svg`;
        const mdContent = `---
title: Hello
date: 2020-01-01
cover:
  image: "images/covers/${oldSlug}.svg"
  alt: ""
  hidden: false
---
hello body content`;
        writeFileSync(`content/posts/${oldSlug}.md`, mdContent);
        writeFileSync(oldCover, '<svg></svg>');
        await runShell(['git', 'add', '.']);
        await runShell(['git', 'commit', '-q', '-m', 'initial']);
        const plan = {
            oldPath: `content/posts/${oldSlug}.md`,
            newPath: `content/posts/${newSlug}.md`,
            oldSlug,
            newSlug,
            yyyymmdd: '20200101',
            hash6: 'abcdef',
            cover: {
                oldCoverPath: oldCover,
                newCoverPath: newCover,
                newImageField: `images/covers/${newSlug}.svg`,
            },
            body: 'hello body content',
        };
        await executePlan(plan);
        // 1) 文件系统状态：旧路径消失，新路径存在
        expect(existsSync(plan.oldPath)).toBe(false);
        expect(existsSync(plan.newPath)).toBe(true);
        expect(existsSync(oldCover)).toBe(false);
        expect(existsSync(newCover)).toBe(true);
        // 2) Working tree 内容是新 cover 路径
        const wtContent = readFileSync(plan.newPath, 'utf8');
        expect(wtContent).toContain(`images/covers/${newSlug}.svg`);
        expect(wtContent).not.toContain(`images/covers/${oldSlug}.svg`);
        // 3) Git index 也应该是新内容（关键回归测试）：
        //    直接 commit 验证 index 已经被正确更新（无需 git add）
        const commit = await runShell(['git', 'commit', '-q', '-m', 'rename']);
        expect(commit.exit).toBe(0);
        const committed = (await runShell(['git', 'show', `HEAD:content/posts/${newSlug}.md`])).stdout;
        expect(committed).toContain(`images/covers/${newSlug}.svg`);
        expect(committed).not.toContain(`images/covers/${oldSlug}.svg`);
        // 4) Git status 应干净
        const status = (await runShell(['git', 'status', '--porcelain'])).stdout;
        expect(status.trim()).toBe('');
    });
    test('没有 cover 时也能正常 rename', async () => {
        const oldSlug = '2020-02-02-no-cover';
        const newSlug = '20200202[123456]';
        const mdContent = `---
title: No Cover
date: 2020-02-02
---
body`;
        writeFileSync(`content/posts/${oldSlug}.md`, mdContent);
        await runShell(['git', 'add', '.']);
        await runShell(['git', 'commit', '-q', '-m', 'initial']);
        const plan = {
            oldPath: `content/posts/${oldSlug}.md`,
            newPath: `content/posts/${newSlug}.md`,
            oldSlug,
            newSlug,
            yyyymmdd: '20200202',
            hash6: '123456',
            cover: null,
            body: 'body',
        };
        await executePlan(plan);
        expect(existsSync(plan.newPath)).toBe(true);
        const commit = await runShell(['git', 'commit', '-q', '-m', 'rename']);
        expect(commit.exit).toBe(0);
        const committed = (await runShell(['git', 'show', `HEAD:content/posts/${newSlug}.md`])).stdout;
        expect(committed).toContain('title: No Cover');
    });
});
