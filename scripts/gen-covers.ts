#!/usr/bin/env deno
/**
 * 批量生成文章封面 SVG
 *
 * 零依赖：仅用 node:fs / node:path / 字符串处理
 *
 * 用法：
 *   deno run -A scripts/gen-covers.ts --dry-run          # 选 5 篇代表性文章，仅打印不写文件
 *   deno run -A scripts/gen-covers.ts --all              # 给所有无 cover 字段的文章生成
 *   deno run -A scripts/gen-covers.ts --all --force      # 强制覆盖已有 cover
 *   deno run -A scripts/gen-covers.ts --files a.md b.md  # 给指定文件生成
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { parseFrontMatter } from './lib/frontmatter.js';
import { parseArgs, getBoolean, getStrings } from './lib/args.js';
import { POSTS_DIR, COVERS_DIR } from './lib/paths.js';

// ─────────────────────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────────────────────

const W = 1200;
const H = 630;

const PALETTES = [
  { name: 'amber',  bg1: '#1F1F1F', bg2: '#0A0A0A', accent: '#D97757', soft: '#E89271' },
  { name: 'sakura', bg1: '#1E3A8A', bg2: '#0A1840', accent: '#FFB7C5', soft: '#FFD1DC' },
  { name: 'purple', bg1: '#1A0B2E', bg2: '#0A0512', accent: '#A78BFA', soft: '#C4B5FD' },
  { name: 'teal',   bg1: '#0F2A2D', bg2: '#061418', accent: '#5EEAD4', soft: '#99F6E4' },
  { name: 'gold',   bg1: '#2D1B0F', bg2: '#1A0F08', accent: '#F59E0B', soft: '#FBBF24' },
];

const PATTERN_FNS = [
  patternCircleGrid,
  patternDiagonal,
  patternConcentric,
  patternTriangles,
  patternWave,
  patternDots,
] as const;

// ─────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────

/** djb2 hash → 32-bit unsigned int */
export function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function pick<T>(arr: readonly T[], n: number): T {
  const len = arr.length;
  const idx = ((n % len) + len) % len;
  return arr[idx]!;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function slugFromFilename(filename: string): string {
  return basename(filename, extname(filename));
}

// ─────────────────────────────────────────────────────────────
// 图案函数
// ─────────────────────────────────────────────────────────────

export function patternCircleGrid(p: typeof PALETTES[number]): string {
  const cells = 9;
  const cellSize = 80;
  const startX = (W - cellSize * cells) / 2;
  const startY = (H - cellSize * cells) / 2;
  let s = '';
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const cx = startX + c * cellSize + cellSize / 2;
      const cy = startY + r * cellSize + cellSize / 2;
      const dist = Math.hypot(cx - W / 2, cy - H / 2);
      const maxDist = Math.hypot(W / 2, H / 2);
      const radius = 4 + (1 - dist / maxDist) * 22;
      const opacity = 0.15 + (1 - dist / maxDist) * 0.4;
      s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" fill="${p.accent}" opacity="${opacity.toFixed(2)}"/>`;
    }
  }
  return s;
}

export function patternDiagonal(p: typeof PALETTES[number]): string {
  let s = '';
  const step = 24;
  for (let i = -H; i < W + H; i += step) {
    const isAccent = (Math.floor(i / step)) % 5 === 0;
    const color = isAccent ? p.accent : p.soft;
    const opacity = isAccent ? 0.35 : 0.12;
    const width = isAccent ? 3 : 1;
    s += `<line x1="${i}" y1="0" x2="${i + H}" y2="${H}" stroke="${color}" stroke-width="${width}" opacity="${opacity}"/>`;
  }
  return s;
}

export function patternConcentric(p: typeof PALETTES[number]): string {
  let s = '';
  const cx = W / 2;
  const cy = H / 2;
  for (let r = 30; r < 700; r += 35) {
    const opacity = 0.08 + (r / 700) * 0.5;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.accent}" stroke-width="2" opacity="${opacity.toFixed(2)}"/>`;
  }
  return s;
}

export function patternTriangles(p: typeof PALETTES[number]): string {
  let s = '';
  const size = 70;
  for (let y = 0; y < H + size; y += size) {
    const offset = (Math.floor(y / size) % 2) * size / 2;
    for (let x = -size; x < W + size; x += size) {
      const cx = x + offset;
      const cy = y;
      const dir = ((x + y) / size) % 2 === 0 ? 1 : -1;
      const p1 = `${cx},${cy - size / 2 * 0.866}`;
      const p2 = `${cx - size / 2},${cy + size / 2 * 0.866}`;
      const p3 = `${cx + size / 2},${cy + size / 2 * 0.866}`;
      const opacity = 0.15;
      s += `<polygon points="${p1} ${p2} ${p3}" fill="none" stroke="${p.accent}" stroke-width="1.5" opacity="${opacity}" transform="rotate(${dir * 30} ${cx} ${cy})"/>`;
    }
  }
  return s;
}

export function patternWave(p: typeof PALETTES[number]): string {
  let s = '';
  const lines = 8;
  for (let i = 0; i < lines; i++) {
    const y = (H / (lines - 1)) * i;
    const amplitude = 30 + i * 4;
    const path: string[] = [];
    for (let x = 0; x <= W; x += 20) {
      const dy = Math.sin((x / W) * Math.PI * 3 + i * 0.5) * amplitude;
      path.push(`${x},${y + dy}`);
    }
    const opacity = 0.12 + i * 0.04;
    s += `<polyline points="${path.join(' ')}" fill="none" stroke="${p.accent}" stroke-width="2" opacity="${opacity.toFixed(2)}"/>`;
  }
  return s;
}

export function patternDots(p: typeof PALETTES[number]): string {
  let s = '';
  const count = 120;
  let seed = hash(p.name) >>> 0;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < count; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 2 + rng() * 6;
    const opacity = 0.2 + rng() * 0.5;
    const useAccent = rng() > 0.5;
    const color = useAccent ? p.accent : p.soft;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" opacity="${opacity.toFixed(2)}"/>`;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────
// SVG 生成
// ─────────────────────────────────────────────────────────────

export function genSvg(seed: string, paletteName: string): string {
  const h = hash(seed);
  const palette = pick(PALETTES, hash(paletteName + seed));
  const patternFn = pick(PATTERN_FNS, hash(seed + 'pattern'));
  const year = (seed.match(/\d{4}/)?.[0]) ?? '----';
  const symbol = pick(['○', '△', '☆', '∞', '◐', '✦'], h);

  const body = patternFn(palette);
  const gradientId = `bg-${palette.name}-${h}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.bg1}"/>
      <stop offset="100%" stop-color="${palette.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#${gradientId})"/>
  ${body}
  <text x="60" y="80" font-family="Georgia, 'Times New Roman', serif" font-size="32" fill="${palette.accent}" opacity="0.9">${symbol}</text>
  <text x="${W - 60}" y="${H - 40}" text-anchor="end" font-family="Georgia, 'Times New Roman', serif" font-size="20" fill="${palette.soft}" opacity="0.5" letter-spacing="2">${year}</text>
  <circle cx="${W - 60}" cy="80" r="6" fill="${palette.accent}" opacity="0.6"/>
</svg>
`;
}

// ─────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────

export async function listPosts(): Promise<string[]> {
  const entries = await readdir(POSTS_DIR);
  return entries.filter((f) => f.endsWith('.md') && f !== '_index.md').sort();
}

export async function readPost(filename: string): Promise<{ meta: Record<string, unknown>; slug: string }> {
  const raw = await readFile(join(POSTS_DIR, filename), 'utf8');
  return { meta: parseFrontMatter(raw), slug: slugFromFilename(filename) };
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/**
 * 在 front matter 文本中查找已有的 cover 块。
 *
 * 支持三种写法（都来自真实文章）：
 *   1. 多行（2 空格缩进）：
 *        cover:
 *          image: "..."
 *          alt: ""
 *          hidden: false
 *   2. 单行内联：
 *        cover: { image: "...", alt: "", hidden: false }
 *   3. 单行 flow：
 *        cover: [image: "...", alt: "", hidden: false]
 *
 * 返回 `{ match, body, start, end }`：
 *   - match: 整个 cover 块（含 `cover:` 起始行）
 *   - body:  cover 块内除 `cover:` 起始行外的剩余内容（缩进后的子字段）
 *   - start/end: 在原始 fm 字符串中的 [start, end) 切片索引（用于替换）
 *
 * 找不到时返回 null。
 */
export function findExistingCoverBlock(fm: string): {
  match: string;
  body: string;
  start: number;
  end: number;
} | null {
  // 1) 多行块：`cover:` 后跟若干缩进行（任意缩进宽度，1-N 个空格或制表符）
  const multi = fm.match(/^cover:[ \t]*\n((?:[ \t]+.+(?:\n|$))+)/m);
  if (multi && multi.index !== undefined) {
    const start = multi.index;
    const end = start + multi[0].length;
    return { match: multi[0], body: multi[1]!, start, end };
  }

  // 2) 单行内联（花括号 / 方括号都允许）
  const inline = fm.match(/^cover:[ \t]*[{[].+[}\]]\s*$/m);
  if (inline && inline.index !== undefined) {
    const start = inline.index;
    const end = start + inline[0].length;
    return { match: inline[0], body: inline[0].slice('cover:'.length), start, end };
  }

  return null;
}

/** 从 cover body 中提取 image 字段的值（去掉引号） */
export function extractCoverImageValue(body: string): string | null {
  const m = body.match(/^\s*image:\s*(.+)$/m);
  if (!m) return null;
  return m[1]!.trim().replace(/^["']|["']$/g, '');
}

/** 是否属于占位封面（不应该跳过） */
export function isPlaceholderCover(imageVal: string): boolean {
  return (
    imageVal === 'images/cover-default.svg' ||
    imageVal.startsWith('images/covers/')
  );
}

/**
 * 给文章 front matter 注入 cover 字段（指向生成的 SVG）
 * 已有 cover 字段且 image 非 cover-default.svg 的跳过（保留真实封面）
 */
export async function injectCoverField(files: string[], { dryRun }: { dryRun: boolean }): Promise<void> {
  let injected = 0;
  let skipped = 0;
  for (const f of files) {
    const raw = await readFile(join(POSTS_DIR, f), 'utf8');
    const slug = slugFromFilename(f);

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) { skipped++; continue; }

    const fm = fmMatch[1]!;

    // 已有 cover 块：识别后判断 image 是否占位/已生成，是则替换，否则跳过
    const existing = findExistingCoverBlock(fm);
    if (existing) {
      const imageVal = extractCoverImageValue(existing.body);
      if (imageVal && !isPlaceholderCover(imageVal)) {
        // 真实封面（外链 / 自定义路径 / 已生成的 covers/*.svg） → 跳过
        skipped++;
        continue;
      }
    }

    const newCover = `cover:\n  image: "images/covers/${slug}.svg"\n  alt: ""\n  hidden: false`;
    let newFm: string;
    if (existing) {
      // 替换已有 cover 块（占位 → 新封面）
      newFm = fm.slice(0, existing.start) + newCover + '\n' + fm.slice(existing.end);
    } else {
      // 追加 cover 块（在 front matter 末尾）
      newFm = fm.trimEnd() + '\n' + newCover;
    }

    // 确保 newFm 以换行结尾，避免与闭合 --- 之间缺少分隔符
    if (!newFm.endsWith('\n')) newFm += '\n';

    const newRaw = raw.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}---`);
    if (dryRun) {
      console.log(`[inject-dry] ${f} → cover.image = images/covers/${slug}.svg`);
    } else {
      await writeFile(join(POSTS_DIR, f), newRaw, 'utf8');
      console.log(`✓ inject ${f}`);
    }
    injected++;
  }
  console.log(`\n共 ${injected} 个 front matter 注入${dryRun ? '（dry-run）' : ''}, 跳过 ${skipped} 个已有真实封面`);
}

export async function generateFor(files: string[], { force, dryRun }: { force: boolean; dryRun: boolean }) {
  await ensureDir(COVERS_DIR);
  let generated = 0;
  let skipped = 0;

  for (const f of files) {
    const { meta, slug } = await readPost(f);
    const coverImage = (meta.cover as Record<string, unknown> | undefined)?.image;
    if (!force && coverImage && coverImage !== 'images/cover-default.svg') {
      skipped++;
      continue;
    }
    const seed = (meta.title as string | undefined) ?? slug;
    const paletteSeed = Array.isArray(meta.tags)
      ? meta.tags.join(',')
      : typeof meta.tags === 'string'
        ? meta.tags
        : 'default';
    const palette = pick(PALETTES, hash(paletteSeed + seed));
    const patternFn = pick(PATTERN_FNS, hash(seed + 'pattern'));
    const svg = genSvg(seed, paletteSeed);
    const outPath = join(COVERS_DIR, `${slug}.svg`);
    if (dryRun) {
      console.log(`[dry-run] ${f} → ${outPath} (palette=${palette.name}, pattern=${patternFn.name})`);
    } else {
      await writeFile(outPath, svg, 'utf8');
      console.log(`✓ ${f} → ${outPath} (${palette.name} / ${patternFn.name})`);
    }
    generated++;
  }
  console.log(`\n共 ${generated} 个生成${dryRun ? '（dry-run）' : ''}, 跳过 ${skipped} 个已有 cover`);
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

export interface ParsedArgs {
  mode: 'sample' | 'all' | 'files';
  files?: string[];
  force: boolean;
  inject: boolean;
  dryRun: boolean;
}

/**
 * 解析 CLI 参数（统一用 lib/args.ts 的 parseArgs，便于 --dry-run 一致性）。
 *
 * 行为：
 *   --all                   → 全部生成
 *   --files a.md b.md       → 给指定文件生成
 *   --force                 → 覆盖已有 cover
 *   --inject-fm             → 给 front matter 注入 cover 字段
 *   --dry-run               → 只打印，不写文件
 *   无参数                  → 取 5 篇有代表性的样本生成（相当于默认 dry-run）
 */
export function parseCli(argv: string[]): ParsedArgs {
  const args = parseArgs(argv);
  const positional = getStrings(args, '_');
  const force = getBoolean(args, 'force');
  const inject = getBoolean(args, 'inject-fm');
  const dryRun = getBoolean(args, 'dry-run') || getBoolean(args, 'dryRun');

  if (getBoolean(args, 'all')) {
    return { mode: 'all', force, inject, dryRun };
  }
  if (positional.length > 0) {
    return { mode: 'files', files: positional, force, inject, dryRun };
  }
  return { mode: 'sample', force, inject, dryRun: true /* sample 始终 dry-run */ };
}

async function main() {
  const { mode, files, force, inject, dryRun } = parseCli(process.argv);

  if (mode === 'sample') {
    // 选 5 篇有代表性的：最新 + 老文章 + 不同长度
    const all = await listPosts();
    const picks = [
      all[all.length - 1]!,        // 最新
      all[Math.floor(all.length / 4)]!,
      all[Math.floor(all.length / 2)]!,
      all[Math.floor(all.length * 3 / 4)]!,
      all[0]!,                    // 最老
    ];
    console.log('生成 5 张样本：\n');
    await generateFor(picks, { force, dryRun: true });
    return;
  }

  if (mode === 'files') {
    await generateFor(files!, { force, dryRun });
    if (inject) await injectCoverField(files!, { dryRun });
    return;
  }

  // mode === 'all'
  const all = await listPosts();
  console.log(`批量生成 ${all.length} 个封面...${dryRun ? '（dry-run）' : ''}\n`);
  await generateFor(all, { force, dryRun });
  if (inject) {
    console.log(`\n注入 front matter...${dryRun ? '（dry-run）' : ''}\n`);
    await injectCoverField(all, { dryRun });
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}