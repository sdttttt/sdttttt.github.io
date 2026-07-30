#!/usr/bin/env node
/**
 * 自动 git add / commit / push
 *
 * 用法：
 *   node scripts/dist/git-commit-push.js --message "style: auto-format markdown"
 *   node scripts/dist/git-commit-push.js --message "feat: xxx" --dry-run
 */

import { parseArgs, getString, getBoolean } from './lib/args.js';
import { gitExec, gitHasStagedChanges, setupBotIdentity } from './lib/git.js';

const args = parseArgs(process.argv);
const message = getString(args, 'message') ?? getString(args, 'm');
const dryRun = getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun');

if (!message) {
  console.error('Usage: node scripts/dist/git-commit-push.js --message "commit message"');
  process.exit(1);
}

setupBotIdentity({ dryRun });
gitExec('add -A', { dryRun });

if (!gitHasStagedChanges()) {
  console.log('No changes to commit');
  process.exit(0);
}

const escapedMessage = message.replace(/"/g, '\\"');
gitExec(`commit -m "${escapedMessage}"`, { dryRun });
// 兜底：吸收运行期间出现的远端新提交，避免 push 被拒
gitExec('pull --rebase', { dryRun });
gitExec('push', { dryRun });
