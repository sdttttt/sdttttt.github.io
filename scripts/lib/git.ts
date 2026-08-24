import { execSync, spawn } from 'node:child_process';

export interface ExecOptions {
  /** 只打印命令，不真正执行 */
  dryRun?: boolean;
  /** 不打印命令输出 */
  silent?: boolean;
}

export function gitExec(cmd: string, opts: ExecOptions = {}): string {
  if (opts.dryRun) {
    console.log(`[dry-run] git ${cmd}`);
    return '';
  }

  const out = execSync(`git ${cmd}`, { encoding: 'utf8' });
  const trimmed = out.trimEnd();
  if (trimmed && !opts.silent) {
    console.log(trimmed);
  }
  return out;
}

/**
 * 用 spawn 数组参数形式执行 git 命令，避免 shell 解释用户输入。
 *
 * 适用于包含用户可控字符串（如 commit message）的场景。
 * 不走 /bin/sh，所以 `$(...)` / 反引号 / 引号都不会被解释。
 *
 * 返回 exit code；stdout/stderr 在 opts.silent=false 时打印。
 */
export async function gitExecArgs(
  args: string[],
  opts: ExecOptions = {},
): Promise<{ ok: boolean; exit: number; stdout: string; stderr: string }> {
  if (opts.dryRun) {
    console.log(`[dry-run] git ${args.join(' ')}`);
    return { ok: true, exit: 0, stdout: '', stderr: '' };
  }
  return await new Promise((resolve) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      stdout += s;
      if (!opts.silent) process.stdout.write(s);
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      stderr += s;
      if (!opts.silent) process.stderr.write(s);
    });
    child.on('error', () => {
      resolve({ ok: false, exit: -1, stdout, stderr });
    });
    child.on('close', (exit) => {
      const code = exit ?? -1;
      resolve({ ok: code === 0, exit: code, stdout, stderr });
    });
  });
}

/** 检测暂存区是否有变更 */
export function gitHasStagedChanges(): boolean {
  try {
    execSync('git diff --cached --quiet');
    return false;
  } catch {
    return true;
  }
}

/** 检测工作区是否有任何变更（包括未跟踪文件） */
export function gitHasChanges(): boolean {
  const out = execSync('git status --porcelain', { encoding: 'utf8' });
  return out.trim().length > 0;
}

/** 配置 github-actions[bot] 提交者身份 */
export function setupBotIdentity(opts?: ExecOptions): void {
  gitExec('config user.name "github-actions[bot]"', opts);
  gitExec('config user.email "github-actions[bot]@users.noreply.github.com"', opts);
}
