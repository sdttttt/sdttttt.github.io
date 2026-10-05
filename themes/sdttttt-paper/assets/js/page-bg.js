/* ---------------------------------------------------------------------------
 * 页面左下角的装饰徽标 —— 用 WASM 粒子渲染，双击切回真实 PNG。
 *
 * 行为（沿用改造前的门控逻辑）：
 *   - 每次加载随机挑一张图；PNG 与粒子用的是同一张
 *   - 默认不可见；滚到文档底部时（html.at-bottom）淡入
 *   - WASM 成功后加 html.pt-bg-ready → canvas 接管，PNG 退到幕后
 *   - 双击（canvas 或 PNG 上都可以）切换 html.pt-bg-photo：
 *       进入 → 显示真实 PNG；再次 → 回到粒子（直接呈现已聚合的成品）
 *   - 任何一步失败 → 什么都不改，就保持原来的 PNG（天然的降级路径）
 *   - prefers-reduced-motion → 不做飞入动画，直接画成品
 *
 * 渲染方式与 /particles/ 一致：WASM 负责采样 + 物理 + 软件光栅化，
 * JS 每帧只做一次 putImageData。
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js'); // CSS 的 no-JS fallback 靠 html:not(.js)

  var cfgEl = document.getElementById('pt-bg-config');
  var box = document.querySelector('.page-bg__box');
  var canvas = document.querySelector('.page-bg__canvas');
  var photo = document.querySelector('.page-bg__png');
  if (!cfgEl || !box || !canvas || !photo || !canvas.getContext) return;

  var cfg = {};
  try {
    cfg = JSON.parse(cfgEl.textContent || '{}');
  } catch (e) {
    cfg = {};
  }
  var IMAGES = Object.prototype.toString.call(cfg.images) === '[object Array]' ? cfg.images : [];
  if (!IMAGES.length) return;

  var DPR_CAP = cfg.dprCap || 1.5;
  var RATIO = cfg.sizeRatio || 0.85;
  // 徽标要粒子**恰好填满**盒子，才能和 `<img object-fit:contain>` 完全对齐，
  // 双击切换不会有尺寸跳变 —— 所以留边系数是 1/1（大画布用的是 0.8/0.86）
  var FIT_W = cfg.fitW || 1;
  var FIT_H = cfg.fitH || 1;
  // 粒子网格间距（CSS px）—— 视觉密度的**唯一旋钮**。
  // 早期版本用「画布面积 / N」推目标粒子数，结果徽标（320×448）只分到
  // ~5000 颗，step 到 10、间距 4 CSS px，明显偏粗；改成间距后就与尺寸解耦了。
  var PITCH_CSS = cfg.pitchCss || 2;
  var MAX_PARTICLES = cfg.maxParticles || 60000;
  // 徽标默认开颗粒感：尺寸小时 round 会把 sizeRatio 吃掉（3 × 0.85 → 3，
  // 边长 == 间距 → 缝隙归零 → 成品退化成无缝拼块），改用 floor 保出缝隙。
  var GRAIN = cfg.grain !== false;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 一页一图：PNG 与粒子共用同一张
  var SRC = IMAGES[Math.floor(Math.random() * IMAGES.length)];
  photo.src = SRC;

  var ctx = canvas.getContext('2d');
  var mod = null;
  var frame = null;
  var raf = 0;
  var settled = false;

  /* ------------------------------------------------------------ 画布尺寸 */

  function sizeCanvas() {
    var r = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    var w = Math.max(1, Math.round(r.width * dpr));
    var h = Math.max(1, Math.round(r.height * dpr));
    canvas.width = w;
    canvas.height = h;
    return { w: w, h: h, dpr: dpr };
  }

  /* 必须在 build()/resize() 之后调用：那两处会重新分配，可能触发 memory.grow，
     grow 之后 memory.buffer 换块 → 旧视图全部 detach。 */
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

  /* ------------------------------------------------------------ 门控 / 渲染 */

  function atBottom() {
    var d = document.documentElement;
    var top = window.scrollY || d.scrollTop || 0;
    return top + window.innerHeight >= d.scrollHeight - 8;
  }

  function inPhotoMode() {
    return root.classList.contains('pt-bg-photo');
  }

  // 已聚合的成品直接画一帧（无动画）
  function drawSettled() {
    mod.settle();
    ctx.putImageData(frame, 0, 0);
    settled = true;
  }

  function loop() {
    raf = 0;
    if (!frame || inPhotoMode() || !root.classList.contains('at-bottom')) return;
    var moving = mod.tick();
    ctx.putImageData(frame, 0, 0);
    if (moving) {
      raf = requestAnimationFrame(loop);
    } else {
      settled = true;
    }
  }

  function wake() {
    if (raf || !frame || reduceMotion || inPhotoMode()) return;
    raf = requestAnimationFrame(loop);
  }

  function syncGate() {
    var on = atBottom();
    root.classList.toggle('at-bottom', on);
    if (!on) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      return;
    }
    if (!frame) return;
    if (reduceMotion || settled) drawSettled();
    else wake();
  }

  /* ------------------------------------------------------------ 双击切换 */
  //
  // 为什么监听器在 document 上而不是 box 上：
  //   `.page-bg` 是 z-index:-1（**刻意**压在正文之下，避免遮挡阅读）。
  //   负 z-index 会让它**完全收不到指针事件** —— 命中测试会落到正文
  //   （实测 elementFromPoint 返回 MAIN）上。所以只能挂 document，
  //   再用坐标判断是否落在徽标矩形内。
  //
  // 代价：徽标收不到 hover，所以 `cursor: pointer` 与 `title` 提示无效，
  // 双击区域内的文字也仍会被选中（叠加在徽标上的正文）。这是为了保住
  // “装饰层在正文之下”这个设计所做的取舍。
  document.addEventListener('dblclick', function (e) {
    if (!frame) return;
    // 只在徽标已揭示时响应，避免误触看不见的角落
    if (!root.classList.contains('at-bottom')) return;
    var r = box.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      return;

    var toPhoto = !inPhotoMode();
    root.classList.toggle('pt-bg-photo', toPhoto);
    if (toPhoto) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    } else {
      // 回到粒子：不重播飞入，直接呈现成品，避免打扰
      drawSettled();
    }
  });

  /* ---------------------------------------------------------------- 启动 */

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

  function boot() {
    loadImage(SRC)
      .then(function (img) {
        var iw = img.naturalWidth;
        var ih = img.naturalHeight;
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
        if (rc !== 0) return; // 失败 → 保持 PNG

        frame = makeFrame();
        if (!frame) return; // 失败 → 保持 PNG

        // canvas 接管；此时 PNG 仍在 DOM 里，双击可随时切回
        root.classList.add('pt-bg-ready');
        syncGate();
      })
      .catch(function () {
        /* 保持 PNG 不动即可 */
      });
  }

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    syncGate();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!mod || !frame) return;
      var s = sizeCanvas();
      if (mod.resize(s.w, s.h, PITCH_CSS * s.dpr) !== 0) return;
      frame = makeFrame();
      if (!frame) return;
      drawSettled();
    }, 200);
  });

  window.addEventListener('scroll', syncGate, { passive: true });
  // 初始 + 下一拍各跑一次（字体/布局变化可能改文档高度）
  syncGate();
  setTimeout(syncGate, 50);

  if (cfg.wasm && window.ptWasm) {
    window.ptWasm
      .instance(cfg.wasm)
      .then(function (exports) {
        if (typeof exports.build !== 'function' || typeof exports.tick !== 'function') return;
        mod = exports;
        boot();
      })
      .catch(function () {
        /* 保持 PNG 不动即可 */
      });
  }
})();
