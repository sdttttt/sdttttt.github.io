import { execSync } from 'node:child_process';

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
