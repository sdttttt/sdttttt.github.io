/* ---------------------------------------------------------------------------
 * 全局类型：这些脚本是 <script> 直接加载的**经典脚本**（不是 ES 模块），
 * 彼此只通过 window 上的 `ptWasm` 共享，所以类型也声明在全局里。
 * ------------------------------------------------------------------------- */

/** Rust 引擎的导出（裸 C-ABI，没有 wasm-bindgen 胶水） */
interface PtWasmExports {
  readonly memory: WebAssembly.Memory;

  /* 生命周期 */
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  build(
    ptr: number,
    imgW: number,
    imgH: number,
    canvasW: number,
    canvasH: number,
    pitch: number,
    sizeRatio: number,
    fitW: number,
    fitH: number,
    maxParticles: number,
    grain: number,
  ): number;
  tick(): number;
  settle(): void;
  resize(w: number, h: number, pitch: number): number;

  /* 动画开关（都是可选：老版本 wasm 没有） */
  ripple_on?(ax: number, ay: number, wavelength: number, period: number, mode: number): number;
  wobble_on?(ax: number, ay: number): number;
  seed_on?(seed: number): number;
  jitter_on?(amp: number): number;
  size_jitter_on?(amp: number): number;
  assemble_on?(frames: number): void;
  float_on?(amp: number, periodFrames: number): void;
  pointer_set?(x: number, y: number, radius: number, power: number): void;
  pointer_clear?(): void;

  /* framebuffer / 诊断 */
  fb_ptr(): number;
  fb_len(): number;
  fb_width(): number;
  fb_height(): number;
  particle_count?(): number;
  sample_step?(): number;
  particle_size?(): number;
}

/** 共享 wasm 加载器（assets/js/pt-wasm.js 挂在 window 上） */
interface PtWasmLoader {
  /** 浏览器是否支持 WebAssembly 及所需的编译入口 */
  readonly supported: boolean;
  module(url: string): Promise<WebAssembly.Module>;
  /** 每次调用返回一个全新的 instance（内存互不干扰） */
  instance(url: string): Promise<PtWasmExports>;
}

interface Window {
  ptWasm?: PtWasmLoader;
}

/** 省流量模式：navigator.connection 不是标准 lib.dom 的一部分 */
interface NetworkInformationLike {
  readonly saveData?: boolean;
}

interface Navigator {
  readonly connection?: NetworkInformationLike;
}

/* ---------------------------------------------------------------------------
 * 页面配置：都是模板写进 <script type="application/json"> 的，字段与
 * partials 里的 JSON 一一对应。全部可选 —— 脚本里每一项都有默认值。
 * ------------------------------------------------------------------------- */

/** <script id="pt-config"> —— /particles/ 页的两个引擎共用 */
interface PtParticlesConfig {
  images?: string[];
  targetCount?: number;
  sizeRatio?: number;
  pitchCss?: number;
  dprCap?: number;
  fitW?: number;
  fitH?: number;
  maxParticles?: number;
  grain?: boolean;
  /** 纯 Canvas 2D 降级脚本的 URL */
  fallback?: string;
  wasm?: string;
}

/** <script id="pt-title-config"> —— 首页 hero 标题 */
interface PtTitleConfig {
  pitchCss?: number;
  sizeRatio?: number;
  maxParticles?: number;
  dprCap?: number;
  ink?: number;
  waveAmpX?: number;
  waveAmpY?: number;
  wavelength?: number;
  wavePeriod?: number;
  jitter?: number;
  sizeJitter?: number;
  wobbleAmpX?: number;
  wobbleAmpY?: number;
  wasm?: string;
}

/** <script id="pt-bg-config"> —— 待机屏保 */
interface PtBgConfig {
  images?: string[];
  idleMs?: number;
  prewarmMs?: number;
  blockPx?: number;
  maxBlocks?: number;
  maxPixels?: number;
  maxParticles?: number;
  assembleMs?: number;
  sizeRatio?: number;
  floatAmp?: number;
  floatPeriod?: number;
  scatterRadius?: number;
  scatterPower?: number;
  wasm?: string;
}
