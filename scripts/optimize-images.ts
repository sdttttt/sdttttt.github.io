#!/usr/bin/env node
/**
 * 图片压缩 / 转 WebP 脚本
 *
 * 依赖：sharp（已加入 package.json devDependencies，首次使用前先执行 npm install）
 *
 * 用法：
 *   node scripts/dist/optimize-images.js                     # 默认处理 assets/images/
 *   node scripts/dist/optimize-images.js --dir static/images # 指定目录
 *   node scripts/dist/optimize-images.js --quality 85        # 调整 JPEG/WebP/AVIF 质量
 *   node scripts/dist/optimize-images.js --width 1200        # 宽度过大时等比缩放
 *   node scripts/dist/optimize-images.js --webp              # 额外生成 .webp 变体（保留原图）
 *   node scripts/dist/optimize-images.js --variants-only     # 只生成 .webp 变体，不覆盖原图（适合 CI）
 *   node scripts/dist/optimize-images.js --dry-run           # 只打印，不写入
 *   node scripts/dist/optimize-images.js --force             # 即使体积变大也强制写入
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import sharp from 'sharp';
import { parseArgs, getString, getNumber, getBoolean } from './lib/args.js';

const SUPPORTED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.tiff']);

interface Options {
  dir: string;
  quality: number;
  width?: number;
  webp: boolean;
  variantsOnly: boolean;
  dryRun: boolean;
  force: boolean;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function ratio(original: number, optimized: number): string {
  const saved = original - optimized;
  const percent = (saved / original) * 100;
  return saved >= 0
    ? `-${formatBytes(saved)} (${percent.toFixed(1)}%)`
    : `+${formatBytes(-saved)} (${percent.toFixed(1)}%)`;
}

function applyResize(pipeline: sharp.Sharp, width?: number): sharp.Sharp {
  if (!width) return pipeline;
  return pipeline.resize(width, undefined, {
    fit: 'inside',
    withoutEnlargement: true,
  });
}

function applyFormat(pipeline: sharp.Sharp, ext: string, quality: number): sharp.Sharp {
  switch (ext) {
    case '.png':
      // effort/compressionLevel 已经是不失真的最大压缩，不再降色
      return pipeline.png({ compressionLevel: 9, effort: 10 });
    case '.jpg':
    case '.jpeg':
      return pipeline.jpeg({ quality, progressive: true, mozjpeg: true });
    case '.webp':
      return pipeline.webp({ quality });
    case '.avif':
      return pipeline.avif({ quality });
    case '.gif':
      return pipeline.gif({ effort: 10 });
    case '.tiff':
      return pipeline.tiff({ quality });
    default:
      return pipeline;
  }
}

async function optimizeFile(filePath: string, opts: Options) {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED.has(ext)) return;

  const originalBuf = await readFile(filePath);
  const originalSize = originalBuf.length;

  // 1) 原地压缩原图（CI 里用 --variants-only 可跳过此步，避免重复有损压缩）
  if (!opts.variantsOnly) {
    const basePipeline = sharp(originalBuf, { animated: ext === '.gif' }).rotate();
    const pipeline = applyFormat(applyResize(basePipeline.clone(), opts.width), ext, opts.quality);
    const optimizedBuf = await pipeline.toBuffer();

    const willWrite = opts.force || optimizedBuf.length < originalSize;

    if (opts.dryRun) {
      console.log(
        `[dry-run] ${filePath}: ${formatBytes(originalSize)} → ${formatBytes(
          optimizedBuf.length
        )} ${ratio(originalSize, optimizedBuf.length)}${willWrite ? '' : ' [跳过]'}`
      );
    } else if (willWrite) {
      await writeFile(filePath, optimizedBuf);
      console.log(
        `✓ ${filePath}: ${formatBytes(originalSize)} → ${formatBytes(
          optimizedBuf.length
        )} ${ratio(originalSize, optimizedBuf.length)}`
      );
    } else {
      console.log(
        `⏭ ${filePath}: ${formatBytes(originalSize)} → ${formatBytes(
          optimizedBuf.length
        )} ${ratio(originalSize, optimizedBuf.length)}，跳过`
      );
    }
  }

  // 2) 生成 .webp 变体
  if (opts.webp && ext !== '.webp') {
    const webpPath = filePath.replace(/\.[^.]+$/, '.webp');
    const webpBuf = await applyResize(
      sharp(originalBuf).rotate(),
      opts.width
    ).webp({ quality: opts.quality }).toBuffer();

    if (opts.dryRun) {
      console.log(`[dry-run] ${webpPath}: ${formatBytes(webpBuf.length)}`);
    } else {
      await writeFile(webpPath, webpBuf);
      console.log(`✓ ${webpPath}: ${formatBytes(webpBuf.length)}`);
    }
  }
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const args = parseArgs(process.argv);
  const variantsOnly = getBoolean(args, 'variants-only');
  const opts: Options = {
    dir: getString(args, 'dir') ?? 'assets/images',
    quality: getNumber(args, 'quality') ?? 85,
    width: getNumber(args, 'width'),
    webp: getBoolean(args, 'webp') || variantsOnly,
    variantsOnly,
    dryRun: getBoolean(args, 'dry-run'),
    force: getBoolean(args, 'force'),
  };

  const files = await walk(opts.dir);
  const targets = files.filter((f) => SUPPORTED.has(extname(f).toLowerCase()));
  if (targets.length === 0) {
    console.log(`未在 ${opts.dir} 找到支持的图片`);
    return;
  }

  console.log(
    `找到 ${targets.length} 张图片：quality=${opts.quality}${
      opts.width ? `, maxWidth=${opts.width}` : ''
    }${opts.webp ? ', 生成 .webp 变体' : ''}${
      opts.variantsOnly ? ' [仅变体，不覆盖原图]' : ''
    }${opts.dryRun ? ' (dry-run)' : ''}\n`
  );

  for (const file of targets) {
    await optimizeFile(file, opts);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
