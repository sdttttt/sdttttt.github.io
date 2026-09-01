import { execSync } from 'node:child_process';
export function gitExec(cmd, opts = {}) {
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
export function gitHasStagedChanges() {
    try {
        execSync('git diff --cached --quiet');
        return false;
    }
    catch {
        return true;
    }
}
/** 检测工作区是否有任何变更（包括未跟踪文件） */
export function gitHasChanges() {
    const out = execSync('git status --porcelain', { encoding: 'utf8' });
    return out.trim().length > 0;
}
/** 配置 github-actions[bot] 提交者身份 */
export function setupBotIdentity(opts) {
    gitExec('config user.name "github-actions[bot]"', opts);
    gitExec('config user.email "github-actions[bot]@users.noreply.github.com"', opts);
}
