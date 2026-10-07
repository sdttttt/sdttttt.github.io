#!/usr/bin/env deno
/**
 * 检查 Markdown 中的死链
 *
 * 扫描 content/ 下的 .md 文件，提取 http/https 外链，通过 HEAD 请求检查可用性。
 *
 * 用法：
 *   deno task check-dead-links
 *   deno run -A scripts/check-dead-links.ts --timeout 10000
 *
 * 退出码：0 = 没有死链（被服务器拦下的不算，见 BLOCKED_STATUSES）；1 = 有死链。
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
 * 「服务器答了、但明确拒绝我们」的状态码：401/403/429 是反爬与频率限制，
 * 451 是法律原因下架。这些链接在浏览器里往往是好的 —— 百度百科和 GitHub 的
 * user-attachments 对 CI 的 IP 一律回 403，而正文里的链接是给人点的。
 *
 * 把它们算成死链只会淹掉真问题：2026-10-07 那次 20 条告警里有 16 条属于这一类，
 * 真死链只有 3 条。所以单独归到「没能验证」一栏，不计入死链、也不改退出码。
 */
const BLOCKED_STATUSES = new Set([401, 403, 429, 451]);

/**
 * 反爬严重的域名：它们对自动检查会给出互相矛盾的码（同一链接时而 403、时而 404），
 * 所以从这些域名拿到的**任何**结论都不可信，一律归入「没能验证」。
 *
 * 触发这条的现场：`content/posts/20231209-Unix平台和Windows的文件分享问题-lzc.md`
 * 里 13 条百度百科链接，并发 6 个请求打过去时偶发返回 404，于是每次跑出来的
 * 「真死链」数量都不一样（3 条 / 2 条）。curl 与 deno 单独打都稳定 403。
 */
const ANTI_CRAWL_HOSTS = new Set(['baike.baidu.com']);

/** 服务器把我们挡在门外 —— 链接本身未必坏，但也确实没验证过 */
export function isBlockedStatus(status: LinkStatus['status']): boolean {
  return typeof status === 'number' && BLOCKED_STATUSES.has(status);
}

/** 这个链接所在域名会不会对自动检查乱报（见 ANTI_CRAWL_HOSTS） */
export function isAntiCrawlHost(url: string): boolean {
  try {
    return ANTI_CRAWL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * 已知失效、但**故意留着**的链接（正文里已经注明原因）。
 *
 * 典型是 `content/posts/20230912-关于查找自己想要的软件的问题-pyx.md` 里那个
 * 已经 404 下线的 Awesome Windows 仓库：正文里保留了它 + 一句「仅作存档」——
 * 存档记录本身有价值，但每天再报一次只会淹掉真问题（所以连请求都不发）。
 *
 * 新增条目时必须同时确认：正文里能找到这个 URL、且带了说明。
 */
export const ARCHIVED_URLS = new Set(['https://github.com/Awesome-Windows/Awesome']);

/** 该链接是不是「已归档的已知死链」 */
export function isArchived(url: string): boolean {
  return ARCHIVED_URLS.has(url);
}

/**
 * 按「真的坏了 / 没能验证」把探测结果分成两组。
 * 同一 URL 出现在多篇文件里会出现多条（保留原有的逐文件上报行为）。
 */
export function partitionByStatus(
  references: { file: string; url: string }[],
  statuses: Map<string, LinkStatus>,
): { dead: DeadLink[]; blocked: DeadLink[] } {
  const dead: DeadLink[] = [];
  const blocked: DeadLink[] = [];

  for (const { file, url } of references) {
    const entry = statuses.get(url)!;
    if (entry.ok) continue; // 能打开的链接两组都不进
    const unverifiable = isBlockedStatus(entry.status) || isAntiCrawlHost(url);
    (unverifiable ? blocked : dead).push({ file, url, status: entry.status });
  }

  return { dead, blocked };
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
  const archived: { file: string; url: string }[] = [];
  const urls = new Set<string>();

  for await (const path of walkMarkdown(CONTENT_DIR)) {
    const raw = await readFile(path, 'utf8');
    for (const url of new Set(extractLinksOutsideCodeBlocks(raw))) {
      if (shouldSkip(url)) continue;
      if (isArchived(url)) {
        archived.push({ file: path, url });
        continue;
      }
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

  const { dead, blocked } = partitionByStatus(references, statuses);

  if (dead.length > 0) {
    console.error(`\n发现 ${dead.length} 个死链:\n`);
    for (const { file, url, status } of dead) {
      console.error(`  ${file}: ${url} (${status})`);
    }
  } else {
    console.log('✓ 未发现死链');
  }

  // 被拦住的单独列出（不算死链）：不列的话，「✓ 未发现死链」会被误读成
  // 「全都验证过了」，而这批链接其实一次都没验证成功。
  if (blocked.length > 0) {
    console.log(`\n${blocked.length} 个链接没能验证（服务器拦住 / 反爬域名乱报，不算死链）:\n`);
    for (const { file, url, status } of blocked) {
      console.log(`  ${file}: ${url} (${status})`);
    }
  }

  if (archived.length > 0) {
    console.log(`\n${archived.length} 个链接已归档（正文里注明已失效、故意保留，不做探测）:\n`);
    for (const { file, url } of archived) {
      console.log(`  ${file}: ${url}`);
    }
  }

  process.exit(dead.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
