/* ---------------------------------------------------------------------------
 * Particle page — WASM 引擎加载器（Rust 裸导出模块）
 *
 * 和 js/particles.js（纯 Canvas 2D 引擎）的分工：
 *   - 本文件负责：加载 .wasm、把源图喂进去、每帧 putImageData
 *   - WASM 负责：采样、物理积分、**软件光栅化**（直接写 RGBA 到线性内存）
 *   - .wasm 加载失败 / 不支持 / ?engine=js 时，动态注入 particles.js 作为降级
 *
 * 为什么 WASM 在这里有意义：Canvas 2D 版的瓶颈是「每帧 4 万次 fillRect」，
 * 这部分是 native 调用开销，JS 优化不动。WASM 版把它换成「往内存写像素 +
 * 每帧 1 次 putImageData」，把 4 万次跨界调用压成 1 次。
 *
 * 三个必须注意的坑：
 *   1. memory.grow 会让旧的 TypedArray 视图 detach（byteLength 变 0），
 *      所以 ImageData 必须在 build()/resize() **之后**重建
 *   2. instantiateStreaming 要求服务器把 .wasm 标成 application/wasm，
 *      否则会抛错 —— 这里 fallback 到 arrayBuffer + instantiate
 *   3. 软件光栅化的成本主要在 putImageData 的整块 memcpy，缓冲大小随 DPR
 *      平方增长，所以 DPR 要设上限
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var canvas = document.getElementById('pt-canvas');
  var cfgEl = document.getElementById('pt-config');
  if (!canvas || !cfgEl || !canvas.getContext) return;

  var cfg = {};
  try {
    cfg = JSON.parse(cfgEl.textContent || '{}');
  } catch (e) {
    cfg = {};
  }
  var IMAGES = Object.prototype.toString.call(cfg.images) === '[object Array]' ? cfg.images : [];
  if (!IMAGES.length) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 降级：动态注入纯 JS 引擎（particles.js 是 IIFE，加载即启动）
  function useFallback() {
    if (!cfg.fallback) return;
    var s = document.createElement('script');
    s.src = cfg.fallback;
    s.async = false;
    document.head.appendChild(s);
  }

  // A/B 对比开关：?engine=js 强制走 Canvas 2D 版
  if (/[?&]engine=js(&|$)/.test(window.location.search)) {
    useFallback();
    return;
  }

  // 粒子网格间距（CSS px）—— 视觉密度的**唯一旋钮**，与画布大小解耦：
  // 同样 2px 的间距，在徽标和大画布上看起来一样细
  var PITCH_CSS = cfg.pitchCss || 2;
  // 小屏粒子粗一点（间距变 1.5 倍 = 粒子数降到 ~44%），避免低端机掉帧
  if (window.innerWidth < 768) PITCH_CSS *= 1.5;
  var RATIO = cfg.sizeRatio || 0.85;
  var DPR_CAP = cfg.dprCap || 1.5;
  // 大画布留一点呼吸空间；fitW/fitH=1 时图像恰好填满画布
  var FIT_W = cfg.fitW || 0.8;
  var FIT_H = cfg.fitH || 0.86;
  // 安全阀：万一画布特别大 / 间距特别小，不让粒子数失控
  var MAX_PARTICLES = cfg.maxParticles || 150000;
  // 粒子边长取整方式：false 时用 round（可能无缝拼块），true 时用 floor
  // （保证 size < spacing → 留缝 → 颗粒感）。大画布保持 round。
  var GRAIN = !!cfg.grain;

  var mod = null;
  var ctx = canvas.getContext('2d');
  var frame = null; // 复用同一个 ImageData，每帧不分配
  var raf = 0;
  var visible = true;

  /* ------------------------------------------------------------ 模块加载 */

  function loadImage(src) {
    return new Promise(function (ok, no) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        ok(img);
      };
      img.onerror = no;
      img.src = src;
    });
  }

  /* ---------------------------------------------------------------- 画布 */

  function sizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    canvas.width = w;
    canvas.height = h;
    return { w: w, h: h, dpr: dpr };
  }

  /* 必须在 build()/resize() 之后调用：那两处会重新分配，可能触发 memory.grow，
     grow 之后 memory.buffer 换了一块，旧的视图全部 detach。 */
  function makeFrame() {
    var len = mod.fb_len();
    var w = mod.fb_width();
    var h = mod.fb_height();
    if (!len || !w || !h || len !== w * h * 4) return null;
    var view = new Uint8ClampedArray(mod.memory.buffer, mod.fb_ptr(), len);
    if (view.length !== len) return null; // detach 了
    try {
      return new ImageData(view, w, h);
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------ 渲染循环 */

  function loop() {
    raf = 0;
    if (!visible || !frame) return;
    var moving = mod.tick(); // WASM：物理 + 光栅化
    ctx.putImageData(frame, 0, 0); // 每帧唯一一次画布调用
    if (moving) raf = requestAnimationFrame(loop);
  }

  function wake() {
    if (raf || !frame || reduceMotion) return;
    raf = requestAnimationFrame(loop);
  }

  /* 把粒子直接放到目标位置并画一帧（不重播飞入）。
     用于 reduce-motion、以及 resize 之后 —— resize 内部是重建（粒子位置
     重新随机），不 settle 的话每次拖窗口都会重演一遍聚合动画。 */
  function drawSettled() {
    if (!frame) return;
    mod.settle();
    ctx.putImageData(frame, 0, 0);
  }

  /* ---------------------------------------------------------------- 启动 */

  function start() {
    loadImage(IMAGES[Math.floor(Math.random() * IMAGES.length)])
      .then(function (img) {
        var iw = img.naturalWidth;
        var ih = img.naturalHeight;
        // 离屏画布取像素（同源图片，getImageData 不会被 taint）
        var off = document.createElement('canvas');
        off.width = iw;
        off.height = ih;
        var octx = off.getContext('2d', { willReadFrequently: true });
        octx.drawImage(img, 0, 0);
        var rgba = octx.getImageData(0, 0, iw, ih).data;

        var s = sizeCanvas();
        var p = mod.alloc(rgba.length);
        new Uint8Array(mod.memory.buffer, p, rgba.length).set(rgba);
        var rc = mod.build(
          p,
          iw,
          ih,
          s.w,
          s.h,
          PITCH_CSS * s.dpr,
          RATIO,
          FIT_W,
          FIT_H,
          MAX_PARTICLES,
          GRAIN ? 1 : 0,
        );
        mod.dealloc(p, rgba.length);
        if (rc !== 0) {
          useFallback();
          return;
        }

        frame = makeFrame();
        if (!frame) {
          useFallback();
          return;
        }

        if (reduceMotion) {
          drawSettled();
          return;
        }
        wake();
      })
      .catch(function () {
        canvas.parentElement.classList.add('pt-error');
      });
  }

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!mod) return;
      var s = sizeCanvas();
      if (mod.resize(s.w, s.h, PITCH_CSS * s.dpr) !== 0) return;
      frame = makeFrame(); // resize 内部重建，视图要跟着换
      if (!frame) return;
      // 不能 wake()：resize 重建时粒子位置重新随机，会把飞入动画重播一遍
      drawSettled();
    }, 150);
  });

  // 离屏停帧
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) wake();
        else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { threshold: 0 },
    ).observe(canvas);
  }

  // 共享加载器（assets/js/pt-wasm.js）：只共享编译结果，instance 各自独立。
  // 浏览器不支持 WASM 就直接走纯 Canvas 2D 降级，连 wasm 都不去拉。
  if (!window.ptWasm || !window.ptWasm.supported) {
    useFallback();
    return;
  }
  window.ptWasm
    .instance(cfg.wasm)
    .then(function (exports) {
      if (typeof exports.build !== 'function' || typeof exports.tick !== 'function') {
        throw new Error('unexpected wasm interface');
      }
      mod = exports;
      start();
    })
    .catch(function () {
      useFallback();
    });
})();
