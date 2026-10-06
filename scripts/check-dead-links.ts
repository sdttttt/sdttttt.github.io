#!/usr/bin/env deno
/**
 * 检查 Markdown 中的死链
 *
 * 扫描 content/ 下的 .md 文件，提取 http/https 外链，通过 HEAD 请求检查可用性。
 *
 * 用法：
 *   deno task check-dead-links
 *   deno run -A scripts/check-dead-links.ts --timeout 10000
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, getNumber, getBoolean } from './lib/args.js';
import { CONTENT_DIR } from './lib/paths.js';

const LINK_REGEX = /https?:\/\/[^\s\)\]\>\"\'\`]+/g;
const FENCE_REGEX = /^(`{3,}|~{3,})/;

/** 中日韩字符 + 全角标点（`，。；：（）` 等都在 \uFF00-\uFFEF 与 \u3000-\u303F 里） */
const CJK_REGEX = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

/** URL 末尾的标点（半角 + 全角 + 省略号） */
const TAIL_PUNCT_REGEX = /[.,;:!?、，。；：！？…"'）】》」』]+$/;

/** URL 末尾没配对的左括号 */
const TAIL_OPEN_BRACKET_REGEX = /[（(【《「『]+$/;

/**
 * 递归遍历目录下所有 `.md` 文件的路径。
 * 对目录项继续递归，遇到 `.md` 文件则 yield；不过滤 _index.md，调用方按需判断。
 *
 * 只有本脚本用得到（validate-posts / rename-posts 各自 readdir 就够了），
 * 所以留在文件内、不单开 lib/fs.ts。
 */
export async function* walkMarkdown(dir: string): AsyncGenerator<string> {
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

const args = parseArgs(process.argv);
const timeout = getNumber(args, 'timeout') ?? 10000;
const dryRun = getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun');

/** 并发探测数：44 个链接串行要 26–29s（全超时最坏 440s），并发后 ≈ 最慢的那一次请求 */
const CONCURRENCY = 6;

/** 单个链接的探测结果：`status` 是 HTTP 码，或 `'timeout'` / `'error: ...'` */
type LinkStatus = { ok: boolean; status: number | string };

interface DeadLink {
  file: string;
  url: string;
  status: LinkStatus['status'];
}

/**
 * 带超时的请求。HEAD 与 GET 只差一个 method（原来两个函数逐行重复），
 * 405 重试放在 checkUrl 里。
 */
async function fetchStatus(url: string, method: 'HEAD' | 'GET', ms: number): Promise<LinkStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; blog-link-checker)',
      },
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, status: 'timeout' };
    }
    return { ok: false, status: `error: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkUrl(url: string, ms: number = timeout): Promise<LinkStatus> {
  const head = await fetchStatus(url, 'HEAD', ms);
  // 405 Method Not Allowed 时换 GET 再试一次
  return head.status === 405 ? await fetchStatus(url, 'GET', ms) : head;
}

/**
 * 从末尾剥掉明显不属于 URL 的字符。
 *
 * ① 正文里的**裸链接**后面常常直接跟中文（`目前用了 https://…/immortalwrt的固件，不…`），
 *    正则会把这串中文一起吞进 URL，于是每次检查都报一条假的死链。判据是「中文段的
 *    前一个字符」：跟在 `/`、`-` 或另一个中文后面才是合法 slug 段
 *    （站内链接有 `…/posts/20260817-文章的变化-…/`），紧跟 ASCII 字母的则是正文。
 * ② 末尾残留的标点（`…/gfwlist就可以…需求.`）与没配对的左括号（`…-1e69/(后缀`）一并剥掉。
 *
 * 只处理末尾/首个粘连点，不做「遇到中文即截断」—— 那会把含中文 slug 的合法 URL 截成 404。
 */
export function trimUrlTail(url: string): string {
  let out = url;

  for (let i = 0; i < out.length; i++) {
    const char = out[i]!;
    if (!CJK_REGEX.test(char)) continue;
    const prev = out[i - 1];
    if (prev !== undefined && prev !== '/' && prev !== '-' && !CJK_REGEX.test(prev)) {
      out = out.slice(0, i);
      break;
    }
  }

  for (;;) {
    const next = out.replace(TAIL_PUNCT_REGEX, '').replace(TAIL_OPEN_BRACKET_REGEX, '');
    if (next === out) return out;
    out = next;
  }
}

export function shouldSkip(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return true;
  }
}

/**
 * 提取 Markdown 文本中位于围栏代码块之外的链接。
 *
 * 支持 ` ``` ` 与 `~~~` 形式的围栏代码块，只处理代码块外的文本。
 * 抽出来的链接再过一道 trimUrlTail，剥掉被正则一起吞进来的正文。
 */
export function extractLinksOutsideCodeBlocks(raw: string): string[] {
  const lines = raw.split('\n');
  const outside: string[] = [];
  let inCodeBlock = false;
  let fenceChar = '';

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(FENCE_REGEX);
    if (fenceMatch) {
      const fence = fenceMatch[1]!;
      if (!inCodeBlock) {
        inCodeBlock = true;
        fenceChar = fence[0]!;
      } else if (fence[0] === fenceChar) {
        inCodeBlock = false;
        fenceChar = '';
      }
      continue;
    }

    if (!inCodeBlock) {
      outside.push(line);
    }
  }

  // 抽尾：正文里的裸链接后面常直接跟中文，正则会连中文一起匹配进来
  return (outside.join('\n').match(LINK_REGEX) ?? []).map(trimUrlTail);
}

/**
 * 并发探测各链接（默认 6 路），结果写进 `statuses`。
 * 每个链接只跑一次；同一个 URL 出现在多篇文章里也只探测一次。
 */
async function checkAll(urls: string[], statuses: Map<string, LinkStatus>): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < urls.length) {
      const url = urls[cursor++]!;
      statuses.set(url, await checkUrl(url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
}

async function main(): Promise<void> {
  // 先把「文件 → 链接」收齐再并发探测：死链清单最后一次性打印
  //（旧版边扫边打 `✗ …`、末尾又整列一遍，同一条日志出现两次）
  const references: { file: string; url: string }[] = [];
  const urls = new Set<string>();

  for await (const path of walkMarkdown(CONTENT_DIR)) {
    const raw = await readFile(path, 'utf8');
    for (const url of new Set(extractLinksOutsideCodeBlocks(raw))) {
      if (shouldSkip(url)) continue;
      references.push({ file: path, url });
      urls.add(url);
    }
  }

  if (dryRun) {
    for (const url of urls) {
      console.log(`[dry-run] 将检查: ${url}`);
    }
    console.log(`[dry-run] 共 ${urls.size} 个唯一外链，未发起请求`);
    return;
  }

  const statuses = new Map<string, LinkStatus>();
  console.log(`检查 ${urls.size} 个唯一外链（并发 ${CONCURRENCY}）…`);
  await checkAll([...urls], statuses);

  const dead: DeadLink[] = references
    .filter(({ url }) => !statuses.get(url)!.ok)
    .map(({ file, url }) => ({ file, url, status: statuses.get(url)!.status }));

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

if (import.meta.main) {
  await main();
}
