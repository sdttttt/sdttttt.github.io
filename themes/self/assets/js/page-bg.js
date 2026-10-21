/* ---------------------------------------------------------------------------
 * 待机屏保：毛玻璃背景上的 2px 粒子人物。
 *
 * 行为
 *   - 页面加载后 **10 秒没有任何输入** → 进入待机：
 *       1. 8 秒时先预热 wasm（约 34KB）并解码一张图；
 *       2. 10 秒时把图按 contain 画到**透明**画布上（只有人物是不透明的），
 *          按 2px 网格采样（粒子 1px、缝隙 1px），交给 WASM；页面本身由 CSS
 *          的 backdrop-filter 做成毛玻璃，原博客内容仍然透出来；
 *       3. 引擎在 1.2 秒内按 hash01(i) 随机放行粒子，每颗从 build() 撒好的
 *          远处飞回目标位 —— 人物方块陆续出现、慢慢拼成图（约 3.5–4 秒）；
 *       4. 组装结束后 float_on() 让每颗粒子绕自己的目标位持续漂浮，画面
 *          一直是「活的」；鼠标经过时 pointer_set() 让半径内粒子受到向外的
 *          径向斥力、从指针下方散开（alpha 不变），指针移开 / 离开窗口后
 *          弹簧把它们送回原位。
 *   - **只有点击 / 按键才退出**：pointermove 只负责推开粒子，不会关掉屏保；
 *     滚轮与触摸滚动被 wake 层吞掉。第一次点击会被吞掉，不会误点链接。
 *   - 每个页面加载只进入一次；退出后不会再被空闲重新拉起。
 *
 * 性能（详见 bg.html）
 *   - backing store 用 CSS 像素、不乘 dpr，总像素上限 1.5MP；
 *   - 网格目标 2px，但屏幕大到网格数超过 maxBlocks 时自动放大（4K 约 4.6px）；
 *   - 固定 30Hz 仿真：60/120Hz 屏上组装时长一致，也把整屏 framebuffer 的
 *     上传成本压在约 150–180MB/s；
 *   - 漂浮让 tick() 永远返回 1，所以画面在待机期间持续跑 30Hz；退出或切后台
 *     才真正停下（不再有「落定后冻结」）。
 *
 * 降级
 *   - prefers-reduced-motion：不加载 wasm，10 秒后直接淡入静态合成图；
 *   - saveData：不进入待机；
 *   - wasm / 图片失败：什么都不显示，页面完全不受影响；
 *   - 无 JS：partial 里的空层不会出现，页面照常。
 *
 * 调试：URL 加 `?pt-bg=now` 可跳过 10 秒等待，直接进入待机。
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var root = document.documentElement;
  var cfgEl = document.getElementById('pt-bg-config');
  var layer = document.querySelector('.page-bg');
  var canvas = document.querySelector('.page-bg__canvas');
  var wake = document.querySelector('.page-bg__wake');
  if (!cfgEl || !layer || !canvas || !wake || !canvas.getContext) return;

  var cfg = {};
  try {
    cfg = JSON.parse(cfgEl.textContent || '{}');
  } catch (e) {
    cfg = {};
  }
  var IMAGES = Object.prototype.toString.call(cfg.images) === '[object Array]' ? cfg.images : [];
  if (!IMAGES.length) return;

  var IDLE_MS = cfg.idleMs == null ? 10000 : Math.max(0, cfg.idleMs);
  var PREWARM_MS = cfg.prewarmMs == null ? 8000 : Math.max(0, cfg.prewarmMs);
  // 预热必须留出一点余量，否则会和进入待机同一拍触发，等于没预热
  if (PREWARM_MS > IDLE_MS - 1000) PREWARM_MS = Math.max(0, IDLE_MS - 1000);

  var BLOCK_PX = cfg.blockPx > 0 ? cfg.blockPx : 2;
  var MAX_BLOCKS = Math.max(1000, cfg.maxBlocks || 400000);
  var MAX_PIXELS = Math.max(100000, cfg.maxPixels || 1500000);
  var MAX_PARTICLES = Math.max(1000, cfg.maxParticles || 180000);
  var ASSEMBLE_MS = Math.max(0, cfg.assembleMs == null ? 1200 : cfg.assembleMs);

  // 2px 网格里的 1px 方块（0.55 × 2 = 1.1 → round 1）：粒子之间留 1px 缝。
  var RATIO = cfg.sizeRatio == null ? 0.55 : cfg.sizeRatio;
  if (!(RATIO > 0) || !isFinite(RATIO)) RATIO = 0.55;
  RATIO = Math.min(RATIO, 1);

  // 持续漂浮。amp 是 CSS px（内部乘 backing 缩放），period 是墙钟毫秒。
  var FLOAT_AMP = cfg.floatAmp == null ? 0.6 : Math.max(0, cfg.floatAmp);
  var FLOAT_PERIOD = cfg.floatPeriod == null ? 6000 : Math.max(100, cfg.floatPeriod);

  // 鼠标经过时的径向斥力：半径 CSS px，power 是每帧冲量（内部乘 backing 缩放）。
  var SCATTER_RADIUS = cfg.scatterRadius == null ? 240 : Math.max(1, cfg.scatterRadius);
  var SCATTER_POWER = cfg.scatterPower == null ? 7 : Math.max(0, cfg.scatterPower);

  // 固定仿真步长：所有「帧」参数都按这个速率换算成墙钟时间。
  var STEP_MS = 1000 / 30;

  var DEBUG = false;
  try {
    DEBUG = /(?:^|[?&])pt-bg=now(?:&|$)/.test(window.location.search);
  } catch (e) {}

  var ctx = canvas.getContext('2d');
  var mod = null;
  var sourceImg = null;

  var frame = null; // 当前帧（wasm 内存的 ImageData 视图）
  var active = false; // 待机层是否正在显示
  var done = false; // 本次加载是否已经进入过待机（只进一次）
  var building = false;
  var settled = false;
  var raf = 0;
  var lastT = 0;
  var acc = 0;
  var idleTimer = 0;
  var hideTimer = 0;
  var lastActivity = performance.now();
  var prewarmed = false;
  var prewarmPromise = null;
  var swallowClick = false;
  var swallowTimer = 0;
  var lastIndex = -1;
  var floatingOn = false;

  var reduced = false;
  var saveData = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}
  try {
    saveData = !!(navigator.connection && navigator.connection.saveData);
  } catch (e) {}

  try {
    var saved = parseInt(window.sessionStorage.getItem('pt-bg-last'), 10);
    if (saved >= 0 && saved < IMAGES.length) lastIndex = saved;
  } catch (e) {}

  /* 把当前渲染路径写到 html[data-pt-engine] 上，方便排查：
     waiting  还没开始预热
     prewarm  wasm / 图片加载中
     wasm     粒子引擎正在跑（组装阶段）
     floating 组装完成，持续漂浮 / 可被鼠标推开（正常待机态）
     settled  float 不可用（旧 wasm）→ 静态粒子
     reduced  减少动态效果 → 静态图
     error    wasm / 图片 / 构建失败
     save-data 用户开启了省流量 → 不进入待机 */
  function mark(engine) {
    root.dataset.ptEngine = engine;
  }

  /* ------------------------------------------------------------ 小工具 */

  function hideMs() {
    var ms = 0;
    try {
      var parts = (window.getComputedStyle(layer).transitionDuration || '').split(',');
      for (var i = 0; i < parts.length; i++) {
        var s = parts[i].replace(/^\s+|\s+$/g, '');
        var n = parseFloat(s) || 0;
        if (/ms$/.test(s)) n /= 1000;
        if (n > ms) ms = n;
      }
    } catch (e) {}
    return ms * 1000;
  }

  /* 画布 backing store 的尺寸 / 间距。**
   *
   * blockCss 是「希望看起来多大」，但屏幕大到网格数超过 maxBlocks 时会放大：
   *   blockCss = max(blockPx, sqrt(视口面积 / maxBlocks))
   * 1440×900 → 2px；1920×1080 → 约 2.3px（backing 0.85 + step 2）；
   * 2560×1440 → 约 3.0px；4K → 约 4.6px。
   *
   * scale 是 backing store 相对 CSS 像素的缩放，**永远 ≤ 1**（不乘 dpr）。
   * 1.5MP × 4 字节 × 30fps ≈ 180MB/s，是这套软件光栅化能接受的上限；
   * dpr2 的全屏 buffer 是 20.7MB/帧，30fps 要 620MB/s，直接不可行。
   */
  function metrics() {
    var vw = document.documentElement.clientWidth || window.innerWidth || 1;
    var vh = document.documentElement.clientHeight || window.innerHeight || 1;
    var area = vw * vh;
    var blockCss = Math.max(BLOCK_PX, Math.sqrt(area / MAX_BLOCKS));
    var scale = Math.min(1, Math.sqrt(MAX_PIXELS / area));
    var w = Math.max(1, Math.round(vw * scale));
    var h = Math.max(1, Math.round(vh * scale));
    return {
      w: w,
      h: h,
      scale: scale,
      pitch: Math.max(1, blockCss * scale),
      blockCss: blockCss,
      vw: vw,
      vh: vh,
    };
  }

  /* ------------------------------------------------------------ 图片 */

  function orderImages() {
    var n = IMAGES.length;
    var start = Math.floor(Math.random() * n);
    if (n > 1 && start === lastIndex) {
      start = (start + 1 + Math.floor(Math.random() * (n - 1))) % n;
    }
    lastIndex = start;
    try {
      window.sessionStorage.setItem('pt-bg-last', String(start));
    } catch (e) {}
    return IMAGES.slice(start).concat(IMAGES.slice(0, start));
  }

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

  function tryLoad(list, i) {
    if (i >= list.length) return Promise.reject(new Error('no image'));
    return loadImage(list[i]).then(null, function () {
      return tryLoad(list, i + 1);
    });
  }

  /* 把图按 contain 画到**透明**画布上：只有人物是不透明的，其余 alpha = 0。
     引擎按 alpha > 128 采样，所以背景不会变成粒子；页面本身由 CSS 的
     `backdrop-filter` 做成毛玻璃透出来。合成图与 backing store 1:1，后面
     getImageData 喂给引擎时 fit 系数 1.0 → 2px 网格不会二次缩放。 */
  function compose(img, w, h) {
    var off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    var c = off.getContext('2d');
    var iw = img.naturalWidth;
    var ih = img.naturalHeight;

    // 四周留 6% 呼吸空间（竖屏也留，避免人物贴边）
    var contain = Math.min(w / iw, h / ih) * 0.94;
    var dw = iw * contain;
    var dh = ih * contain;
    c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

    return off;
  }

  /* ------------------------------------------------------------ WASM */

  function loadEngine() {
    if (mod) return Promise.resolve(mod);
    if (!cfg.wasm || !window.ptWasm || !window.ptWasm.supported) {
      mark('error');
      return Promise.resolve(null);
    }
    return window.ptWasm
      .instance(cfg.wasm)
      .then(function (exports) {
        if (
          typeof exports.build !== 'function' ||
          typeof exports.tick !== 'function' ||
          typeof exports.settle !== 'function' ||
          typeof exports.alloc !== 'function' ||
          typeof exports.fb_ptr !== 'function' ||
          typeof exports.fb_len !== 'function' ||
          typeof exports.fb_width !== 'function' ||
          typeof exports.fb_height !== 'function'
        ) {
          mark('error');
          return null;
        }
        mod = exports;
        return exports;
      })
      .catch(function () {
        mark('error');
        return null;
      });
  }

  /* 8 秒预热：只拉 wasm + 解码一张图，不采样、不建帧。10 秒到点时这些
     都已经在内存里，组装可以立刻开始。失败就标记 error，页面不受影响。 */
  function prewarm() {
    if (prewarmed) return Promise.resolve(true);
    if (prewarmPromise) return prewarmPromise;
    mark('prewarm');
    var engineP = reduced ? Promise.resolve(null) : loadEngine();
    var imageP = tryLoad(orderImages(), 0).then(function (img) {
      sourceImg = img;
      return img;
    });
    prewarmPromise = Promise.all([engineP, imageP])
      .then(function () {
        var ok = !!sourceImg && (reduced || !!mod);
        prewarmed = ok;
        if (!ok) mark('error');
        return ok;
      })
      .catch(function () {
        mark('error');
        return false;
      });
    return prewarmPromise;
  }

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

  function blit() {
    if (!frame) return;
    ctx.putImageData(frame, 0, 0);
  }

  /* ------------------------------------------------------------ 渲染循环 */

  function stopLoop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    lastT = 0;
    acc = 0;
  }

  function startLoop() {
    if (raf || !active || !frame || document.hidden) return;
    lastT = 0;
    acc = 0;
    raf = requestAnimationFrame(step);
  }

  /* 固定 30Hz：rAF 只负责把时间攒起来，攒够一个 STEP_MS 才调一次 tick()。
     这样 60Hz / 120Hz 屏上的组装时长完全一致；每次 tick 内部仍是一整步
     物理，不会因为掉帧改变轨迹。 */
  function step(now) {
    raf = 0;
    if (!active || !frame || !mod || document.hidden) return;
    if (!lastT) lastT = now;
    var dt = Math.min(now - lastT, 250);
    lastT = now;
    acc += dt;
    var ticks = 0;
    var busy = true;
    while (acc >= STEP_MS && ticks < 4) {
      busy = mod.tick() !== 0;
      acc -= STEP_MS;
      ticks++;
    }
    if (ticks) blit();
    if (busy) {
      raf = requestAnimationFrame(step);
    } else if (!settled) {
      settled = true;
      floatingOn = false;
      mark('settled');
    }
  }

  /* ------------------------------------------------------------ 进入 / 退出 */

  function fail(engine) {
    mark(engine || 'error');
    active = false;
    building = false;
    settled = false;
    floatingOn = false;
    root.classList.remove('pt-bg-on');
    stopLoop();
  }

  function drawStatic() {
    var m = metrics();
    var comp = compose(sourceImg, m.w, m.h);
    canvas.width = m.w;
    canvas.height = m.h;
    ctx.clearRect(0, 0, m.w, m.h);
    ctx.drawImage(comp, 0, 0);
    root.classList.add('pt-bg-on');
    building = false;
    floatingOn = false;
  }

  function startBuild() {
    if (!active || !mod || !sourceImg) {
      building = false;
      return;
    }
    var m = metrics();
    var comp = compose(sourceImg, m.w, m.h);
    var rgba;
    try {
      rgba = comp.getContext('2d').getImageData(0, 0, m.w, m.h).data;
    } catch (e) {
      fail('error');
      return;
    }

    canvas.width = m.w;
    canvas.height = m.h;

    var p = mod.alloc(rgba.length);
    new Uint8Array(mod.memory.buffer, p, rgba.length).set(rgba);
    var rc = mod.build(p, m.w, m.h, m.w, m.h, m.pitch, RATIO, 1.0, 1.0, MAX_PARTICLES, 1);
    mod.dealloc(p, rgba.length);
    if (rc !== 0) {
      fail('error');
      return;
    }

    frame = makeFrame();
    if (!frame) {
      fail('error');
      return;
    }

    // 诊断：实际粒子数 / 采样步长 / 边长（2px 网格下确认没被 maxParticles 推粗）
    if (typeof mod.particle_count === 'function') {
      root.dataset.ptParticles = String(mod.particle_count());
    }
    if (typeof mod.sample_step === 'function') {
      root.dataset.ptBlock = String(mod.sample_step());
    }
    if (typeof mod.particle_size === 'function') {
      root.dataset.ptSize = String(mod.particle_size());
    }

    // 随机放行：窗口内每颗粒子只在自己那一拍之后才出现 / 起跑。
    // 旧 wasm 没有这个入口时静默跳过，退回「整批从远处飞入」（仍然能动）。
    if (mod.assemble_on) mod.assemble_on(ASSEMBLE_MS / STEP_MS);

    // 持续漂浮：必须在 build 之后、第一帧之前。float_on 让 tick() 永远返回 1，
    // 所以 30Hz 的循环会一直跑，直到 exit() / 切后台。amp 写 CSS px，
    // 内部乘 backing 缩放（1440 下 scale = 1）。
    if (FLOAT_AMP > 0 && mod.float_on) {
      mod.float_on(FLOAT_AMP * m.scale, FLOAT_PERIOD / STEP_MS);
      floatingOn = true;
    }

    // 先 tick 一帧再显示，避免淡入的第一帧是全透明的；这一次 tick 同时把
    // 随机闸门推进一格、让漂浮开始积分。
    mod.tick();
    blit();
    root.classList.add('pt-bg-on');
    mark('wasm');
    building = false;
    startLoop();

    // 组装窗口 + 弹簧尾巴走完后，把诊断标记从 wasm 换成 floating；
    // 如果 float_on 缺失（旧 wasm）则保持 wasm，交给 step() 标 settled。
    setTimeout(function () {
      if (active && floatingOn) mark('floating');
    }, ASSEMBLE_MS + 2500);
  }

  function enter() {
    if (active || done || saveData) return;
    done = true;
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = 0;
    }
    active = true;
    settled = false;
    building = true;
    floatingOn = false;
    prewarm().then(function (ok) {
      if (!active) return;
      if (!ok) {
        fail('error');
        return;
      }
      if (reduced) {
        drawStatic();
        mark('reduced');
        return;
      }
      startBuild();
    });
  }

  function exit() {
    if (!active) return;
    clearPointer();
    active = false;
    settled = false;
    building = false;
    floatingOn = false;
    stopLoop();
    root.classList.remove('pt-bg-on');
    if (hideTimer) clearTimeout(hideTimer);
    // 等淡出走完再抹帧：否则淡出中途会先变成透明，像闪了一下
    hideTimer = setTimeout(function () {
      hideTimer = 0;
      if (active) return;
      frame = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, hideMs() + 60);
  }

  /* ------------------------------------------------------------ 空闲计时 */

  /* 每 250ms 看一次「最后一次输入到现在」——比每次 pointermove 都重建
     setTimeout 便宜，也不会被高频 mousemove 拖慢。 */
  function checkIdle() {
    idleTimer = 0;
    if (done) return;
    if (saveData) {
      mark('save-data');
      return;
    }
    if (!document.hidden) {
      var idle = performance.now() - lastActivity;
      if (idle >= PREWARM_MS) prewarm();
      if (idle >= IDLE_MS) {
        enter();
        return;
      }
    }
    idleTimer = setTimeout(checkIdle, 250);
  }

  function scheduleIdle() {
    if (!idleTimer) idleTimer = setTimeout(checkIdle, 250);
  }

  function noteActivity() {
    if (!done) lastActivity = performance.now();
  }

  /* ------------------------------------------------------------ 输入 / 退出 */

  /* 把指针位置换算到 backing px，交给引擎的斥力场。半径内的粒子会在
     随后的 tick 里被推离指针；指针离开（或下一次移动出界）时
     clearPointer()，弹簧再把它们送回去。坐标 / 半径都是 backing px，
     乘缩放后屏幕上的观感与 CSS px 一致。 */
  function pointerAt(e) {
    if (!mod || typeof mod.pointer_set !== 'function') return null;
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    ) {
      return null;
    }
    var sx = canvas.width / r.width;
    var sy = canvas.height / r.height;
    var s = (sx + sy) * 0.5;
    var x = (e.clientX - r.left) * sx;
    var y = (e.clientY - r.top) * sy;
    mod.pointer_set(x, y, SCATTER_RADIUS * s, SCATTER_POWER * s);
    return { x: x, y: y, s: s };
  }

  function clearPointer() {
    if (mod && typeof mod.pointer_clear === 'function') mod.pointer_clear();
  }

  /* 鼠标移动只把粒子推开，不关闭屏保；只有 pointerdown / 按键退出。 */
  function onPointerMove(e) {
    if (!active) {
      noteActivity();
      return;
    }
    var p = pointerAt(e);
    if (!p) clearPointer();
  }

  function onPointerDown() {
    if (active) {
      exit();
      return;
    }
    noteActivity();
  }

  function onPassive() {
    if (!active) noteActivity();
  }

  function closeScreen(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    // 吞掉紧随其后的一次 click：pointerdown 被取消后浏览器仍可能补发 click，
    // 而那时 wake 层已经被摘掉，点击就会落到下面的链接上。
    swallowClick = true;
    if (swallowTimer) clearTimeout(swallowTimer);
    swallowTimer = setTimeout(function () {
      swallowClick = false;
      swallowTimer = 0;
    }, 700);
    exit();
  }

  /* 滚轮 / 触摸滚动只被吞掉，不关闭屏保 —— 用户明确要求「点击才关闭」。 */
  function blockScroll(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
  }

  wake.addEventListener('pointerdown', closeScreen, { passive: false });
  wake.addEventListener('touchstart', closeScreen, { passive: false });
  wake.addEventListener('wheel', blockScroll, { passive: false });
  wake.addEventListener('touchmove', blockScroll, { passive: false });

  window.addEventListener('click', function (e) {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  window.addEventListener('keydown', function (e) {
    if (active) {
      // 组合键 / F5 / F12 交给浏览器（别把刷新、地址栏、DevTools 锁死）；
      // 其余按键只负责关掉屏保，避免键盘用户被困住。
      var plain =
        !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== 'F5' && e.key !== 'F12';
      if (plain) {
        e.preventDefault();
        e.stopPropagation();
      }
      exit();
      return;
    }
    noteActivity();
  }, true);

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('wheel', onPassive, { passive: true });
  window.addEventListener('touchstart', onPassive, { passive: true });
  window.addEventListener('touchmove', onPassive, { passive: true });
  window.addEventListener('scroll', onPassive, { passive: true });
  window.addEventListener('resize', function () {
    if (active) {
      exit();
      return;
    }
    noteActivity();
  });

  // 指针离开窗口 / 页面被切走 → 洞关闭，粒子淡回；再次移回会重新打开
  document.addEventListener('pointerleave', clearPointer);
  window.addEventListener('blur', clearPointer);
  wake.addEventListener('pointerleave', clearPointer);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearPointer();
      stopLoop();
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = 0;
      }
      return;
    }
    // 回来重新计 10 秒，不搞「切回来突然出现」
    lastActivity = performance.now();
    if (active && !settled) startLoop();
    else if (!active && !done) scheduleIdle();
  });

  /* ------------------------------------------------------------ 启动 */

  mark('waiting');
  if (!document.hidden) scheduleIdle();

  // 开发用：?pt-bg=now 直接进待机，省得每次等 10 秒
  if (DEBUG) {
    lastActivity = -1e9;
    setTimeout(enter, 50);
  }
})();
