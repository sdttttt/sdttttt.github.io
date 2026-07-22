#!/usr/bin/env bun
/**
 * 检查 Markdown 中的死链
 *
 * 扫描 content/ 下的 .md 文件，提取 http/https 外链，通过 HEAD 请求检查可用性。
 *
 * 用法：
 *   bun scripts/check-dead-links.ts
 *   bun scripts/check-dead-links.ts --timeout 10000
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, getNumber, getBoolean } from './lib/args';

const CONTENT_DIR = 'content';
const LINK_REGEX = /https?:\/\/[^\s\)\]\>\"\'\`]+/g;

const args = parseArgs(process.argv);
const timeout = getNumber(args, 'timeout') ?? 10000;
const dryRun = getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun');

interface DeadLink {
  file: string;
  url: string;
  status: number | string;
}

async function* walkMarkdown(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdown(path);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield path;
    }
  }
}

async function checkUrl(url: string): Promise<{ ok: boolean; status: number | string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; blog-link-checker)',
      },
    });
    clearTimeout(timer);
    // 405 Method Not Allowed 时换 GET 再试一次
    if (res.status === 405) {
      return await checkUrlGet(url);
    }
    return { ok: res.ok, status: res.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, status: 'timeout' };
    }
    return { ok: false, status: `error: ${(err as Error).message}` };
  }
}

async function checkUrlGet(url: string): Promise<{ ok: boolean; status: number | string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; blog-link-checker)',
      },
    });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, status: 'timeout' };
    }
    return { ok: false, status: `error: ${(err as Error).message}` };
  }
}

function shouldSkip(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  const dead: DeadLink[] = [];
  const checked = new Map<string, { ok: boolean; status: number | string }>();

  for await (const path of walkMarkdown(CONTENT_DIR)) {
    const raw = await readFile(path, 'utf8');
    const matches = raw.match(LINK_REGEX) ?? [];
    const unique = [...new Set(matches)];

    for (const url of unique) {
      if (shouldSkip(url)) continue;

      if (!checked.has(url)) {
        if (dryRun) {
          console.log(`[dry-run] 将检查: ${url}`);
          checked.set(url, { ok: true, status: 'skipped' });
          continue;
        }
        const result = await checkUrl(url);
        checked.set(url, result);
        if (!result.ok) {
          console.log(`✗ ${url} → ${result.status}`);
        }
      }

      const result = checked.get(url)!;
      if (!result.ok) {
        dead.push({ file: path, url, status: result.status });
      }
    }
  }

  if (dead.length === 0) {
    console.log('✓ 未发现死链');
    process.exit(0);
  }

  console.error(`\n发现 ${dead.length} 个死链:\n`);
  for (const { file, url, status } of dead) {
    console.error(`  ${file}: ${url} (${status})`);
  }
  process.exit(1);
}

await main();
