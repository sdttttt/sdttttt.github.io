/* ---------------------------------------------------------------------------
 * 页面左下角的装饰徽标 —— 用 WASM 粒子渲染，双击切回真实图片。
 *
 * 呈现方式（2026-10 起）：**淡入淡出，不聚合**。
 *   粒子在 wasm 里一次 settle() 就位（build 时它们是随机散布的，settle 会
 *   直接吸附到目标位置），JS 只 putImageData 一帧；之后显隐完全由 CSS 的
 *   opacity 过渡负责（.page-bg__box / 两个子层）。所以这里**不需要 rAF**。
 *
 * 行为：
 *   - 每次加载随机挑一张图；页面里的 <img> 与粒子用的是同一张
 *   - 默认不可见；滚到文档底部时（html.at-bottom）淡入
 *   - **引擎按需预热**：只有「快滚到底」（距离页底 2 个视口高度）时才去拉
 *     wasm、换图、采样建帧 —— 徽标只在页底揭示，绝大多数访问根本看不到它，
 *     以前却是加载即执行，每页白付 23KB wasm + 一次满量采样（见 start()）
 *   - WASM 成功后加 html.pt-bg-ready → canvas 接管，图片退到幕后
 *   - 双击（document 级监听 + 矩形判定，见下）切换 html.pt-bg-photo
 *   - 任何一步失败 → 什么都不改，保持图片（天然的降级路径）
 *
 * 关于监听器为什么在 document 上而不是 box 上：
 *   `.page-bg` 是 z-index:-1（刻意压在正文之下），而负 z-index 会让它
 *   **完全收不到指针事件** —— 命中测试会落到正文（elementFromPoint 返回
 *   MAIN）。复用 `html[data-pt-engine]` 记录当前路径便于排查。
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var root = document.documentElement;
  // baseof.html 已经用同步内联脚本加过 .js（必须在首屏前，否则
  // html:not(.js) 这条“无 JS 回退”规则会先让徽标闪一下）。这里只是幂等兜底。
  root.classList.add('js');

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
  // 粒子网格间距（CSS px）—— 视觉密度的**唯一旋钮**，与画布尺寸解耦
  var PITCH_CSS = cfg.pitchCss || 2;
  var MAX_PARTICLES = cfg.maxParticles || 60000;
  // 徽标默认开颗粒感：尺寸小时 round 会把 sizeRatio 吃掉（3 × 0.85 → 3，
  // 边长 == 间距 → 缝隙归零 → 成品退化成无缝拼块），改用 floor 保出缝隙。
  var GRAIN = cfg.grain !== false;

  // 一页一图：页面里的 <img> 与粒子共用同一张（赋 src 推迟到 start()，
  // 免得在一篇永远不会滚到底的文章上白下 50KB；HTML 里那张图仍是兜底）
  var SRC = IMAGES[Math.floor(Math.random() * IMAGES.length)];

  var ctx = canvas.getContext('2d');
  var mod = null;
  var frame = null;
  var drawn = false; // 当前 frame 是否已经画到 canvas 上

  /* 把当前用的渲染路径写到 html[data-pt-engine] 上，方便排查：
     deferred    还没接近页底，引擎按需预热尚未开始（同样能挡住兜底定时器）
     pending     引擎正在加载（baseof 里的兜底定时器看到这个就不抢答）
     png         未配置 wasm / 加载器没到位
     unsupported 浏览器不支持 WASM → 直接显示原图
     error       WASM 下载 / 编译 / 构建失败 → 回退原图
     wasm        粒子引擎已就绪 */
  function mark(engine) {
    root.dataset.ptEngine = engine;
  }

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

  /* ------------------------------------------------------------ 门控 / 绘制 */

  function atBottom() {
    var d = document.documentElement;
    var top = window.scrollY || d.scrollTop || 0;
    return top + window.innerHeight >= d.scrollHeight - 8;
  }

  function inPhotoMode() {
    return root.classList.contains('pt-bg-photo');
  }

  /* 把粒子吸附到目标位置并绘制一帧。**没有动画**：显隐交给 CSS 的
     opacity 过渡，所以只需要在内容失效时画一次。 */
  function draw() {
    if (!frame) return;
    mod.settle();
    ctx.putImageData(frame, 0, 0);
    drawn = true;
  }

  /* 唯一的显隐开关：写 html.at-bottom，CSS 负责淡入 / 淡出。 */
  function syncGate() {
    // 预热时机：滚到离页底还有 PREWARM_VIEWPORTS 个视口高度时就开工。
    // 短页面（文档总高不足这么高）在首次调用时就会直接开工，行为和以前一致。
    if (nearBottom()) start();
    var on = atBottom();
    root.classList.toggle('at-bottom', on);
    // 首次（或 resize 后）揭示时才画；之后画布内容一直有效，不必重画
    if (on && !drawn) draw();
  }

  /* ------------------------------------------------------------ 双击切换 */

  document.addEventListener('dblclick', function (e) {
    if (!frame) return;
    // 只在徽标已揭示时响应，避免误触看不见的角落
    if (!root.classList.contains('at-bottom')) return;
    var r = box.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;

    root.classList.toggle('pt-bg-photo');
    // 从真实图片切回粒子时确保画布有内容（正常已画过，这里是兜底）
    if (!inPhotoMode()) draw();
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
          mark('error'); // 失败 → 保持 PNG
          return;
        }

        frame = makeFrame();
        if (!frame) {
          mark('error'); // 失败 → 保持 PNG
          return;
        }

        // canvas 接管；此时 PNG 仍在 DOM 里，双击可随时切回
        root.classList.add('pt-bg-ready');
        mark('wasm');
        syncGate();
      })
      .catch(function () {
        mark('error'); // 保持 PNG 不动即可
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
      frame = makeFrame(); // resize 内部重建，视图要跟着换
      if (!frame) return;
      drawn = false; // 重新吸附 + 重画（resize 会把粒子位置重新随机）
      if (atBottom()) draw();
    }, 200);
  });

  /* ------------------------------------------------------------ 按需预热 */

  // 距离页底还有 N 个视口高度时开始预热。徽标只在页底揭示，提前两屏启动
  // 足够让 50KB 图片 + 23KB wasm + 一次采样在淡入动画（0.8s）期间就绪。
  var PREWARM_VIEWPORTS = 2;
  var started = false;

  function nearBottom() {
    var d = document.documentElement;
    var top = window.scrollY || d.scrollTop || 0;
    return top + window.innerHeight * (1 + PREWARM_VIEWPORTS) >= d.scrollHeight;
  }

  /* 幂等的启动开关：photo.src 赋值、wasm 下载 / 编译、采样建帧都发生在这里，
     所以「读过但没滚到底」的访问一点成本都不付。 */
  function start() {
    if (started) return;
    started = true;

    photo.src = SRC; // 与粒子同源的那张（HTML 里的 src 是兜底用的另一张）
    mark('pending'); // 从这一刻起才算「引擎加载中」

    if (!cfg.wasm || !window.ptWasm) {
      mark('png'); // 没配置 / 加载器没来 → 保持 PNG
      return;
    }
    // 显式能力检测：不支持就**连 wasm 都不去拉**，直接用 PNG 原图
    if (!window.ptWasm.supported) {
      mark('unsupported');
      return;
    }
    window.ptWasm
      .instance(cfg.wasm)
      .then(function (exports) {
        // 徽标只用 build / settle / alloc / dealloc / resize / 各访问器，
        // 不做逐帧动画，所以不需要 tick
        if (typeof exports.build !== 'function' || typeof exports.settle !== 'function') {
          mark('error');
          return;
        }
        mod = exports;
        boot();
      })
      .catch(function () {
        mark('error'); // 加载 / 编译失败 → 保持 PNG
      });
  }

  window.addEventListener('scroll', syncGate, { passive: true });

  // 同步标记「还没开始预热」：baseof 里的 2s 兜底定时器只在**完全无标记**时
  // 才当降级，所以这个标记能保护“懒加载但一切正常”的情况不被误判。
  // 必须在下面第一次 syncGate() 之前 —— 否则短页面上 start() 先写上
  // 'pending' 就被这里覆盖回去了。
  mark('deferred');

  // 初始 + 下一拍各跑一次（字体/布局变化可能改文档高度）
  syncGate();
  setTimeout(syncGate, 50);
})();
