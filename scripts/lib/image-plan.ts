/**
 * 图片「源图 → 发布图」转换的规划逻辑。
 *
 * 纯函数，不碰文件系统、不 import 编码器（sharp 只在 scripts/optimize-images.ts
 * 里按需动态 import），所以测试可以零依赖跑在 CI 上。
 *
 * 目录约定：
 *
 *   assets/src/bg/*.png|jpg    → static/bg/*.<format>
 *   assets/src/avatar/*.jpg    → static/avatar.webp
 *
 * 为什么源图放 `assets/` 而不是 `static/`：
 *   Hugo 会把 `static/` **整目录**复制进 `public/`，而 `assets/` 里没被
 *   Hugo Pipes 引用过的文件不会发布。原图只占仓库、不占部署体积，也不会
 *   被浏览器下载（改天想换质量/尺寸还能重新编码）。
 *
 * 尺寸依据（见 content/changelog 2026-10-05 的体积审计）：
 *   - 徽标：CSS 宽度 clamp(220px, 24vw, 320px)，dprCap 1.5 → 最多约 480 设备像素，
 *     取 640px 留一点余量；同时它也是 WASM 粒子的采样源，太小会掉细节。
 *   - 头像：显示 96px（h-24 w-24），@2x 即 192px。
 */

export type ImageFormat = 'avif' | 'webp';

export interface ImagePlan {
  /** 源图（仓库相对路径） */
  source: string;
  /** 产物（仓库相对路径） */
  output: string;
  format: ImageFormat;
  width: number;
  quality: number;
}

/** 背景图源目录（只支持平铺一层，不递归子目录） */
export const BG_SOURCE_DIR = 'assets/src/bg';

/** 背景图发布目录（模板里的 readDir "static/bg" 就是它） */
export const BG_OUTPUT_DIR = 'static/bg';

export const BG_WIDTH = 640;

/**
 * 背景图质量。AVIF 在带 alpha 的抠图上比 WebP 强 3 倍以上
 * （同一张图 640px：AVIF q45 ≈ 50KB，WebP q82 ≈ 162KB），所以默认 AVIF。
 */
export const BG_QUALITY: Record<ImageFormat, number> = { avif: 45, webp: 78 };

export const AVATAR_SOURCE_DIR = 'assets/src/avatar';

/** 头像固定输出 WebP：它比徽标显眼得多，不值得为 4KB 去赌老 Safari 的 AVIF 支持 */
export const AVATAR_OUTPUT = 'static/avatar.webp';

export const AVATAR_WIDTH = 192;

export const AVATAR_QUALITY = 85;

/** 认得的源图扩展名（小写，含点） */
export const SOURCE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg'];

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * 给一张源图算产物路径与编码参数；不是「被管理的源图」则返回 null。
 *
 * @param relPath 仓库相对路径（如 `assets/src/bg/foo.png`）
 * @param format  背景图的目标格式；头像永远忽略它、固定 WebP
 */
export function planImage(relPath: string, format: ImageFormat = 'avif'): ImagePlan | null {
  const path = normalize(relPath);
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return null;

  const dir = path.slice(0, slash);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return null;

  const stem = file.slice(0, dot);
  const ext = file.slice(dot).toLowerCase();
  if (!SOURCE_EXTENSIONS.includes(ext)) return null;

  if (dir === BG_SOURCE_DIR) {
    return {
      source: path,
      output: `${BG_OUTPUT_DIR}/${stem}.${format}`,
      format,
      width: BG_WIDTH,
      quality: BG_QUALITY[format],
    };
  }

  if (dir === AVATAR_SOURCE_DIR) {
    return {
      source: path,
      output: AVATAR_OUTPUT,
      format: 'webp',
      width: AVATAR_WIDTH,
      quality: AVATAR_QUALITY,
    };
  }

  return null;
}

/** 产物扩展名白名单 —— Hugo 模板（partials/bg.html、_default/particles.html）用它过滤 readDir */
export const OUTPUT_EXTENSIONS: readonly string[] = ['.avif', '.webp'];
