/* ---------------------------------------------------------------------------
 * Particle image assembler — pure Canvas 2D, no dependencies.
 *
 * 读 config（<script id="pt-config" type="application/json">）里的图片列表，
 * 随机挑一张，采样它的不透明像素，按 step 抽成粒子，用弹簧缓动让粒子飞入
 * 并拼出图像。无交互：聚合成形后停帧。
 *
 * 关键设计：
 *   - 颜色按 5bit 量化分桶排序 -> 每帧只需 ~50 次 fillStyle 切换（实测素材
 *     只有 ~230 种精确色 / ~47 个 5bit 桶），所以上万粒子在 2D 上也毫无压力。
 *   - 用 fillRect 而非 arc（快 3~5x）。
 *   - 归位后停帧（sleep），只在 resize 时唤醒。
 *   - prefers-reduced-motion 时直接画出成品，不做动画。
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

  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TARGET = cfg.targetCount || 40000; // 目标粒子数（会自动调 step 逼近）
  // 小屏降低密度：手机 GPU/CPU 跑 3 万多粒子会掉帧，降到 1/3 左右
  if (window.innerWidth < 768) TARGET = Math.round(TARGET * 0.35);
  var SIZE_RATIO = cfg.sizeRatio || 0.85; // 粒子边长 / 采样间距；调小=更细的颗粒感

  var W = 0,
    H = 0; // canvas 的 CSS 像素尺寸
  var particles = [];
  var size = 2; // 每颗粒子边长（CSS px）
  var raf = 0;
  var visible = true;
  var ready = false;
  var imgCache = {};

  /* ---------------------------------------------------------------- 载入 */

  function load(src) {
    if (!imgCache[src]) {
      imgCache[src] = new Promise(function (ok, no) {
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          ok(img);
        };
        img.onerror = no;
        img.src = src;
      });
    }
    return imgCache[src];
  }

  /* -------------------------------------------------- 采样：图 -> 粒子点阵 */

  function sample(img) {
    var iw = img.naturalWidth,
      ih = img.naturalHeight;
    var off = document.createElement('canvas');
    off.width = iw;
    off.height = ih;
    var octx = off.getContext('2d', { willReadFrequently: true });
    octx.drawImage(img, 0, 0);
    var data = octx.getImageData(0, 0, iw, ih).data;

    // 逐步放大 step，直到粒子数 <= TARGET（或触顶）
    var step = 2,
      pts = [];
    for (;;) {
      pts.length = 0;
      for (var y = 0; y < ih; y += step) {
        for (var x = 0; x < iw; x += step) {
          var i = (y * iw + x) << 2;
          if (data[i + 3] > 128) pts.push(x, y, data[i], data[i + 1], data[i + 2]);
        }
      }
      if (pts.length / 5 <= TARGET || step >= 16) break;
      step++;
    }
    return { iw: iw, ih: ih, step: step, pts: pts };
  }

  /* ---------------------------------------------------- 生成粒子（含布局） */

  function build(res) {
    var iw = res.iw,
      ih = res.ih,
      pts = res.pts;
    // 适配画布：留一点边距，等比缩放居中
    var scale = Math.min((W * 0.8) / iw, (H * 0.86) / ih);
    var ox = (W - iw * scale) / 2;
    var oy = (H - ih * scale) / 2;
    size = Math.max(1, res.step * scale * SIZE_RATIO);

    var list = [];
    for (var k = 0; k < pts.length; k += 5) {
      var sx = pts[k],
        sy = pts[k + 1],
        r = pts[k + 2],
        g = pts[k + 3],
        b = pts[k + 4];
      var tx = ox + sx * scale,
        ty = oy + sy * scale;
      list.push({
        tx: tx,
        ty: ty,
        // 起始位置：画布外随机散布，飞入聚合
        x: tx + (Math.random() - 0.5) * W * 2.4,
        y: ty + (Math.random() - 0.5) * H * 2.4,
        vx: 0,
        vy: 0,
        key: ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5),
        color: 'rgb(' + r + ',' + g + ',' + b + ')',
      });
    }
    // 按颜色分桶排序 -> 渲染时连续同色，只需极少次 fillStyle 赋值
    list.sort(function (a, b) {
      return a.key - b.key;
    });
    particles = list;
    ready = true;
  }

  /* -------------------------------------------------------------- 尺寸 */

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ------------------------------------------------------------ 渲染 / 循环 */

  function draw() {
    ctx.clearRect(0, 0, W, H);

    var spring = 0.08,
      damp = 0.86,
      half = size / 2;
    var last = -1,
      maxV = 0;

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];

      p.vx += (p.tx - p.x) * spring;
      p.vy += (p.ty - p.y) * spring;
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx;
      p.y += p.vy;

      var v = Math.abs(p.vx) + Math.abs(p.vy);
      if (v > maxV) maxV = v;

      if (p.key !== last) {
        ctx.fillStyle = p.color;
        last = p.key;
      }
      ctx.fillRect(p.x - half, p.y - half, size, size);
    }
    return maxV > 0.05;
  }

  function tick() {
    raf = 0;
    if (!visible || !ready) return;
    if (draw()) raf = requestAnimationFrame(tick);
  }

  function wake() {
    if (raf || reduceMotion || !ready) return;
    raf = requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------------- 启动 */

  function show(img) {
    var res = sample(img);
    build(res);
    if (reduceMotion) {
      // 直接呈现成品，不做动画
      for (var i = 0; i < particles.length; i++) {
        particles[i].x = particles[i].tx;
        particles[i].y = particles[i].ty;
      }
      draw();
    } else {
      wake();
    }
  }

  // 每次加载随机挑一张（与 partials/bg.html 的“一页一图”行为一致）
  resize();
  load(IMAGES[Math.floor(Math.random() * IMAGES.length)])
    .then(show)
    .catch(function () {
      canvas.parentElement.classList.add('pt-error');
    });

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resize();
      if (!particles.length) return;
      // 按新画布重新计算目标点（保持已有的颜色/顺序）
      var minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.tx < minX) minX = p.tx;
        if (p.tx > maxX) maxX = p.tx;
        if (p.ty < minY) minY = p.ty;
        if (p.ty > maxY) maxY = p.ty;
      }
      var iw = maxX - minX || 1,
        ih = maxY - minY || 1;
      var scale = Math.min((W * 0.8) / iw, (H * 0.86) / ih);
      var ox = (W - iw * scale) / 2,
        oy = (H - ih * scale) / 2;
      for (var j = 0; j < particles.length; j++) {
        var q = particles[j];
        q.tx = ox + (q.tx - minX) * scale;
        q.ty = oy + (q.ty - minY) * scale;
      }
      wake();
    }, 150);
  });

  // 离屏时停帧
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
})();
