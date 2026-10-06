#!/usr/bin/env deno
/**
 * 把 assets/src/ 下的原图编码成 static/ 下体积优化后的发布图。
 *
 * 用法：
 *   deno task optimize-images-dry              # 预览，不写盘、不装 sharp
 *   deno task optimize-images                  # 写入（默认 AVIF）
 *   deno task optimize-images --format webp    # 想要更好的老浏览器兼容时
 *   deno task optimize-images --force          # 忽略时间戳，全部重编码
 *
 * 依赖 npm:sharp（只在真正需要编码时才动态 import，所以 dry-run 与 CI 测试
 * 都不需要它）。首次运行需要网络拉取。
 *
 * 幂等：产物比源图新就跳过。产物路径由 scripts/lib/image-plan.ts 规划，
 * 加图只要把原图丢进 assets/src/bg/ 再跑一次。
 */

import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getBoolean, getString, parseArgs } from './lib/args.js';
import {
  AVATAR_OUTPUT,
  BG_OUTPUT_DIR,
  type ImageFormat,
  type ImagePlan,
  OUTPUT_EXTENSIONS,
  planImage,
  SOURCE_EXTENSIONS,
} from './lib/image-plan.js';

/** 源图根目录 */
export const SRC_DIR = 'assets/src';

const FORMATS: readonly string[] = ['avif', 'webp'];

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 产物相对源图的体积变化：`-42%` 是省了，`+12%` 是反而变大（旧版会打成 `-(-12)%`） */
export function formatSizeDelta(srcBytes: number, outBytes: number): string {
  const savedPct = Math.round((1 - outBytes / srcBytes) * 100);
  if (savedPct === 0) return '±0%';
  return savedPct > 0 ? `-${savedPct}%` : `+${-savedPct}%`;
}

/** 递归收集源图（仓库相对路径） */
async function collectSources(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        const dot = entry.name.lastIndexOf('.');
        const ext = dot > 0 ? entry.name.slice(dot).toLowerCase() : '';
        if (SOURCE_EXTENSIONS.includes(ext)) out.push(path);
      }
    }
  }

  await walk(root);
  return out.sort();
}

/** 把源文件列表映射成转换计划（无法识别的目录/扩展名记进 skipped） */
export function buildPlans(
  sources: string[],
  format: ImageFormat,
): { plans: ImagePlan[]; skipped: string[] } {
  const plans: ImagePlan[] = [];
  const skipped: string[] = [];

  for (const source of sources) {
    const plan = planImage(source, format);
    if (plan) plans.push(plan);
    else skipped.push(source);
  }

  return { plans, skipped };
}

/** 产物比源图新 → 认为已是最新（--force 时永远返回 false） */
async function isFresh(plan: ImagePlan, force: boolean): Promise<boolean> {
  if (force) return false;
  try {
    const [src, out] = await Promise.all([stat(plan.source), stat(plan.output)]);
    return out.mtimeMs >= src.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * 列出「受管理的发布图」：static/bg 下的 .avif/.webp + 固定路径的头像。
 *
 * 只看这两个位置 —— static/images/ 里的文章配图不归本脚本管，递归扫 static/
 * 会把它们误报成孤儿文件。头像只有一个固定路径，单独 stat 一次
 *（旧版只扫 static/bg，头像源图删了也不提醒）。
 */
export async function listPublishedImages(): Promise<string[]> {
  const out: string[] = [];

  try {
    for (const entry of await readdir(BG_OUTPUT_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const dot = entry.name.lastIndexOf('.');
      const ext = dot > 0 ? entry.name.slice(dot).toLowerCase() : '';
      if (OUTPUT_EXTENSIONS.includes(ext)) out.push(`${BG_OUTPUT_DIR}/${entry.name}`);
    }
  } catch {
    // static/bg 不存在就没事
  }

  try {
    await stat(AVATAR_OUTPUT);
    out.push(AVATAR_OUTPUT);
  } catch {
    // 头像还没生成过
  }

  return out;
}

/**
 * 动态 import sharp：dry-run 不需要它，也就不会触发 npm 下载。
 *
 * 用变量而不是字面量说明符，是为了让 Deno 的**类型检查**不要把它拉进依赖图 ——
 * 否则 CI 跑 `deno task test`（会 import 本文件的 buildPlans）时就得去下 50MB 的
 * sharp 二进制。配合 deno.json 里的 --no-lock，仓库保持零 npm 依赖。
 */
const SHARP_SPECIFIER = 'npm:sharp@0.33.5';

async function encode(plan: ImagePlan): Promise<Buffer> {
  const { default: sharp } = await import(SHARP_SPECIFIER);
  const image = sharp(plan.source).resize({
    width: plan.width,
    // 原图本来就比目标宽度小的话不要放大
    withoutEnlargement: true,
  });

  const buf = plan.format === 'avif'
    ? await image.avif({ quality: plan.quality, effort: 6 }).toBuffer()
    : await image.webp({ quality: plan.quality, effort: 6 }).toBuffer();

  return Buffer.from(buf);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const dryRun = getBoolean(args, 'dry-run');
  const force = getBoolean(args, 'force');
  const format = (getString(args, 'format') ?? 'avif') as ImageFormat;

  if (!FORMATS.includes(format)) {
    console.error(`未知格式: ${format}（可选 ${FORMATS.join(' / ')}）`);
    process.exit(2);
  }

  const sources = await collectSources(SRC_DIR);
  if (sources.length === 0) {
    console.error(`没有在 ${SRC_DIR} 下找到源图（支持 ${SOURCE_EXTENSIONS.join(' / ')}）`);
    process.exit(1);
  }

  const { plans, skipped } = buildPlans(sources, format);

  console.log(
    `源图 ${sources.length} 张 → 计划 ${plans.length} 张${format === 'avif' ? '（背景图 AVIF，头像固定 WebP）' : `（背景图 WebP，头像固定 WebP）`}${dryRun ? '｜dry-run' : ''}`,
  );

  let written = 0;
  let skippedFresh = 0;

  for (const plan of plans) {
    if (await isFresh(plan, force)) {
      skippedFresh++;
      console.log(`  · 跳过（已最新）  ${plan.output}`);
      continue;
    }

    const srcSize = (await stat(plan.source)).size;
    const label = `${plan.format} ${plan.width}px q${plan.quality}`;

    if (dryRun) {
      console.log(`  → ${plan.source} → ${plan.output}  [${label}]（源 ${kb(srcSize)}）`);
      continue;
    }

    const buf = await encode(plan);
    await mkdir(dirname(plan.output), { recursive: true });
    await writeFile(plan.output, buf);
    written++;
    const delta = formatSizeDelta(srcSize, buf.length);
    console.log(
      `  ✓ ${plan.output}  [${label}]  ${kb(srcSize)} → ${kb(buf.length)}（${delta}${
        delta.startsWith('+') ? '，比源图大' : ''
      }）`,
    );
  }

  for (const path of skipped) {
    console.warn(`  ! 跳过（未识别的源图路径）  ${path}`);
  }

  // 提示孤儿产物（换了 --format、删了源图、头像源图没了）
  const expected = new Set(plans.map((p) => p.output.replace(/\\/g, '/')));
  for (const path of await listPublishedImages()) {
    if (!expected.has(path)) {
      console.warn(`  ! ${path} 已无对应源图，可手动删除`);
    }
  }

  if (dryRun) {
    console.log('dry-run 结束，未写入任何文件');
    return;
  }

  console.log(`完成：写入 ${written} 张，跳过 ${skippedFresh} 张`);
}

if (import.meta.main) {
  await main();
}
