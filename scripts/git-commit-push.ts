#!/usr/bin/env bun
/**
 * 自动 git add / commit / push
 *
 * 用法：
 *   bun scripts/git-commit-push.ts --message "style: auto-format markdown"
 *   bun scripts/git-commit-push.ts --message "feat: xxx" --dry-run
 */

import { parseArgs, getString, getBoolean } from './lib/args';
import { gitExec, gitHasStagedChanges, setupBotIdentity } from './lib/git';

const args = parseArgs(process.argv);
const message = getString(args, 'message') ?? getString(args, 'm');
const dryRun = getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun');

if (!message) {
  console.error('Usage: bun scripts/git-commit-push.ts --message "commit message"');
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
gitExec('push', { dryRun });
