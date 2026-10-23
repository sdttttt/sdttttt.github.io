/* ---------------------------------------------------------------------------
 * 首页 hero 标题：宋体字形 → WASM 粒子 → 像海浪一样漫浮。
 *
 * 数据流
 *   1. 标题文字只存在于 DOM（.home-title__text），本文件从它读 textContent；
 *      字体 / 字号 / 字重 / 颜色也全部从它的 computed style 读 —— 样式只有一个
 *      来源（assets/custom.css 的宋体栈），JS 不重复硬编码。
 *   2. 用离屏 canvas 把字形画成一张透明底 RGBA 蒙版（设备像素，1:1），
 *      额外描一圈 ink 宽的边：引擎按 alpha > 128 每 PITCH 个像素采样一次，
 *      宋体的细横画不补一点墨就会漏在采样格之间。
 *   3. 蒙版喂给 WASM（build）→ 粒子目标位就是蒙版上的不透明像素。
 *   4. **立刻 settle()**：标题画布很小，而 build() 会把粒子撒到 2.4 倍画布外，
 *      直接交叉淡入会先出现「文字没了、粒子还在几百 px 外」的空窗。所以这里
 *      不要飞入动画，改用「文字淡出 / 粒子淡入」作为入场（CSS 过渡）。
 *   5. ripple_on(..., mode 2) 打开沿 x 的行波：每颗粒子沿一个很扁的椭圆轨道
 *      转圈（横向 sin、纵向 cos），整体是一道从左向右滚过去的浪。
 *   6. 固定 30Hz：rAF 只攒时间，攒够 1/30s 才 tick + putImageData 一次。
 *
 * 为什么不用 DOM 文字做「背后一层」：粒子是独立方块、有缝隙，文字透出来会
 * 变成重影。文字只是无障碍 / SEO / 无 JS 的兜底，粒子生效后由 CSS 淡出。
 *
 * 降级
 *   - 无 JS / 脚本 404：宋体纯文字，页面不受影响（canvas 默认 opacity 0）。
 *   - 无 WebAssembly / wasm 加载失败 / build 失败：保持纯文字。
 *   - prefers-reduced-motion：渲染一帧静态粒子，不启动波浪、不跑循环。
 *   - saveData：不拉 wasm，保持纯文字。
 *   - ?pt-title=off：强制纯文字（调试 / 截图对比用）。
 *
 * 暂停：标签页隐藏、标题滚出视口、待机屏保盖住页面（html.pt-bg-on）时跳过
 * tick；恢复时重置时间累加器，不会一次补上几十帧。
 *
 * 调试：html[data-pt-title] = waiting / wasm / reduced / save-data / error / off；
 * html[data-pt-title-particles|step|size|jitter|sizeJitter|wobble] 是引擎的
 * 实际粒子数 / 采样步长 / 边长 / 目标位抖动 / 边长抖动 / 微动幅度（设备 px）。
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var host = document.querySelector('.home-title');
  var textEl = host && host.querySelector('.home-title__text');
  var canvas = host && host.querySelector('.home-title__canvas');
  var cfgEl = document.getElementById('pt-title-config');
  if (!host || !textEl || !canvas || !canvas.getContext || !cfgEl) return;

  var root = document.documentElement;

  function mark(state) {
    root.dataset.ptTitle = state;
  }

  if (/(?:^|[?&])pt-title=off(?:&|$)/.test(window.location.search)) {
    mark('off');
    return;
  }

  var TITLE = (textEl.textContent || '').replace(/\s+/g, ' ').trim();
  if (!TITLE) {
    mark('off');
    return;
  }

  var cfg = {};
  try {
    cfg = JSON.parse(cfgEl.textContent || '{}');
  } catch (e) {
    cfg = {};
  }

  var PITCH_CSS = cfg.pitchCss > 0 ? cfg.pitchCss : 2;
  var RATIO = cfg.sizeRatio > 0 ? cfg.sizeRatio : 0.8;
  var MAX_PARTICLES = Math.max(1000, cfg.maxParticles || 60000);
  var DPR_CAP = cfg.dprCap > 0 ? cfg.dprCap : 2;
  var INK = cfg.ink >= 0 ? cfg.ink : 0.6;
  var AMP_X = cfg.waveAmpX >= 0 ? cfg.waveAmpX : 0.8;
  var AMP_Y = cfg.waveAmpY >= 0 ? cfg.waveAmpY : 2.2;
  var WAVELENGTH = cfg.wavelength > 0 ? cfg.wavelength : 140;
  var WAVE_PERIOD = cfg.wavePeriod > 0 ? cfg.wavePeriod : 4200;
  var JITTER = cfg.jitter >= 0 ? cfg.jitter : 1;
  var SIZE_JITTER = cfg.sizeJitter >= 0 ? cfg.sizeJitter : 0.45;
  var WOBBLE_X = cfg.wobbleAmpX >= 0 ? cfg.wobbleAmpX : 0.6;
  var WOBBLE_Y = cfg.wobbleAmpY >= 0 ? cfg.wobbleAmpY : 0.9;

  /* 每次打开换一把随机种子。
     引擎里点阵的落点、边长、微动相位都取自「按索引取哈希」这条序列 ——
     不播种时同一个索引永远给同一个值，于是每次刷新标题都长得一模一样。
     种子一换就是另一套随机排布。
     同一页面里只生成一次：缩放 / 深色切换触发的重建复用它，点阵不会被洗掉。 */
  function randomSeed() {
    var s = 0;
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var buf = new Uint32Array(1);
        window.crypto.getRandomValues(buf);
        s = buf[0] >>> 0;
      }
    } catch (e) {
      s = 0;
    }
    if (!s && typeof Math.random === 'function') {
      s = (Math.random() * 0xffffffff) >>> 0;
    }
    return s || 1; // 0 是「不播种」的保留值
  }
  var SEED = randomSeed();
  root.dataset.ptTitleSeed = String(SEED);

  // 固定仿真步长：波浪周期与暂停恢复都按这个速率换算 / 对齐。
  var STEP_MS = 1000 / 30;

  var reduced = false;
  var saveData = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}
  try {
    saveData = !!(navigator.connection && navigator.connection.saveData);
  } catch (e) {}

  if (saveData) {
    mark('save-data');
    return;
  }

  var ctx = canvas.getContext('2d');
  var mod = null;
  var frame = null;
  var raf = 0;
  var lastT = 0;
  var acc = 0;
  var visible = true;
  var current = { w: 0, h: 0, dpr: 1 };
  var resizeTimer = 0;

  /* ------------------------------------------------------------ 几何 / 样式 */

  /* 画布盒子由 CSS 决定（左右贴齐 h1，上下各外扩 0.6rem 给波浪留空间）。
     注意不能给 canvas 用 display:none —— 那样 getBoundingClientRect() 全是 0，
     JS 永远量不到尺寸。默认态是 opacity:0。 */
  function geometry() {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    return {
      w: Math.max(1, Math.round(rect.width * dpr)),
      h: Math.max(1, Math.round(rect.height * dpr)),
      dpr: dpr,
    };
  }

  function styleInfo() {
    var cs = window.getComputedStyle(textEl);
    return {
      weight: cs.fontWeight || '400',
      family: cs.fontFamily || 'serif',
      size: parseFloat(cs.fontSize) || 48,
      color: cs.color || '#000',
      spacing: cs.letterSpacing || 'normal',
    };
  }

  /* 把标题画成透明底的字形蒙版。颜色用 currentColor 的 computed 值：
     深色模式下文字是白的，粒子也跟着是白的，重建时不需要另一套配色。 */
  function renderMask(g, st) {
    var off = document.createElement('canvas');
    off.width = g.w;
    off.height = g.h;
    var c = off.getContext('2d', { willReadFrequently: true });
    if (!c) return null;

    var size = st.size * g.dpr;
    function applyFont(px) {
      c.font = st.weight + ' ' + px.toFixed(2) + 'px ' + st.family;
      if ('letterSpacing' in c) c.letterSpacing = st.spacing;
    }
    applyFont(size);

    // 站名变长时按宽度缩字号；标题文字本身仍是 DOM 里的那一份。
    var m = c.measureText(TITLE);
    var maxW = g.w - 4;
    if (m.width > maxW && m.width > 0) {
      size *= maxW / m.width;
      applyFont(size);
      m = c.measureText(TITLE);
    }

    c.fillStyle = st.color;
    c.strokeStyle = st.color;
    c.lineJoin = 'round';
    c.lineWidth = Math.max(0, INK) * g.dpr * 2;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';

    // 与 DOM 文字共用**同一条基线**：布局用 line-height 与字体 ascent/descent
    // 算半行距，canvas 里按同一基线落笔，0.35s 交叉淡入时不会上下跳。
    // （旧做法把墨迹包围盒在画布居中，实测粒子比 DOM 文字高 3.4 CSS px ——
    // 画布上下各外扩了 0.6rem，而 CJK 字形在行盒里并不居中。）
    var asc = m.fontBoundingBoxAscent;
    var desc = m.fontBoundingBoxDescent;
    var lh = parseFloat(window.getComputedStyle(textEl).lineHeight);
    var y;
    if (isFinite(asc) && isFinite(desc) && isFinite(lh)) {
      var spanTop =
        textEl.getBoundingClientRect().top - canvas.getBoundingClientRect().top;
      y = spanTop * g.dpr + ((lh - (asc + desc) / g.dpr) / 2) * g.dpr + asc;
    } else {
      // 老浏览器没有 fontBoundingBox*：退回墨迹居中，只是可能差 1–2px。
      var iAsc = m.actualBoundingBoxAscent;
      var iDesc = m.actualBoundingBoxDescent;
      y = g.h / 2;
      if (isFinite(iAsc) && isFinite(iDesc)) y += (iAsc - iDesc) / 2;
    }
    var x = 2;

    if (c.lineWidth > 0) c.strokeText(TITLE, x, y);
    c.fillText(TITLE, x, y);

    try {
      return c.getImageData(0, 0, g.w, g.h).data;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------ WASM */

  function makeFrame() {
    var len = mod.fb_len();
    var w = mod.fb_width();
    var h = mod.fb_height();
    if (!len || !w || !h || len !== w * h * 4) return null;
    var view = new Uint8ClampedArray(mod.memory.buffer, mod.fb_ptr(), len);
    if (view.length !== len) return null; // detach 了（build 时 memory.grow）
    try {
      return new ImageData(view, w, h);
    } catch (e) {
      return null;
    }
  }

  function buildEngine(g, st) {
    var rgba = renderMask(g, st);
    if (!rgba) return false;

    canvas.width = g.w;
    canvas.height = g.h;

    var p = mod.alloc(rgba.length);
    if (!p) return false;
    new Uint8Array(mod.memory.buffer, p, rgba.length).set(rgba);
    // 蒙版与画布同尺寸、fit 1:1：pitch 直接就是画布上的采样间距，
    // step = round(pitch)，粒子边长 = floor(step × ratio)。
    //
    // 小字号特例（当前 6rem / 4.5rem 不会触发，留给更小的自定义字号）：
    // 1.5px 网格在 dpr 2 下是 step 3 / 边长 2，36px 左右的宋体细横画只占
    // 2–3 个设备像素，采出来会碎成噪点；step 2 的 1px 圆点又太淡。所以这时
    // 退到 **2px 无缝网格**（step 2、边长 2）：方块彼此相接、仍是逐粒子点阵，
    // 但字形可辨。桌面 96px / 窄屏 72px（step 3 / 边长 2）与 dpr 3 手机
    // （step 5 / 边长 4）都保留缝隙。
    var dense =
      st.size < 40 && g.dpr >= 2 && Math.round(PITCH_CSS * g.dpr) <= 3;
    var pitchDev = dense ? 2 : PITCH_CSS * g.dpr;
    var ratio = dense ? 1 : RATIO;
    // 播种：把「按索引取哈希」的序列换成这一页的随机种子，落点 / 边长 /
    // 微动相位随之换一套。引擎没有这个导出时（老 wasm）只是退回「每次
    // 打开位置相同」的老行为，不影响其余功能。
    if (typeof mod.seed_on === 'function') mod.seed_on(SEED);
    var rc = mod.build(
      p,
      g.w,
      g.h,
      g.w,
      g.h,
      pitchDev,
      ratio,
      1,
      1,
      MAX_PARTICLES,
      0,
    );
    mod.dealloc(p, rgba.length);
    if (rc !== 0) return false;

    // 打散严格网格：给每颗粒子的目标位加一次抖动（build 后、settle 前）。
    // 偏移取自带种子的哈希，所以每次打开落点都不同；同一页面内重建时
    // 种子不变，点阵保持原样。设备像素下限 1，dpr 1 的屏幕上也能看出参差；
    // 0 则保持原来的整齐点阵。
    if (JITTER > 0 && typeof mod.jitter_on === 'function') {
      var jitterDev = Math.max(1, JITTER * g.dpr);
      if (mod.jitter_on(jitterDev) === 1) {
        root.dataset.ptTitleJitter = String(jitterDev);
      }
    }

    // 随机边长：不再是一水儿的 2px 方块。设备像素下限 0.6，dpr 1 也有一点参差。
    if (SIZE_JITTER > 0 && typeof mod.size_jitter_on === 'function') {
      var sizeJitterDev = Math.max(0.6, SIZE_JITTER * g.dpr);
      if (mod.size_jitter_on(sizeJitterDev) === 1) {
        root.dataset.ptTitleSizeJitter = String(sizeJitterDev);
      }
    }

    frame = makeFrame();
    if (!frame) return false;

    if (typeof mod.particle_count === 'function') {
      root.dataset.ptTitleParticles = String(mod.particle_count());
    }
    if (typeof mod.sample_step === 'function') {
      root.dataset.ptTitleStep = String(mod.sample_step());
    }
    if (typeof mod.particle_size === 'function') {
      root.dataset.ptTitleSize = String(mod.particle_size());
    }
    return true;
  }

  /* 落位 + 开波 + 画第一帧。rebuild（缩放 / 换主题）也走这里：
     重建后粒子位置与首次一致（同一种子），settle() 直接摆到目标位，
     不重播飞入。 */
  function arm(g) {
    if (!frame || !mod) return false;
    mod.settle();
    if (!reduced && typeof mod.ripple_on === 'function') {
      mod.ripple_on(
        AMP_X * g.dpr,
        AMP_Y * g.dpr,
        WAVELENGTH * g.dpr,
        WAVE_PERIOD / STEP_MS,
        2,
      );
    }
    // 逐粒子微动叠加在行波上：每颗点按自己的相位轻轻呼吸。
    if (
      !reduced &&
      (WOBBLE_X > 0 || WOBBLE_Y > 0) &&
      typeof mod.wobble_on === 'function'
    ) {
      var wobX = WOBBLE_X * g.dpr;
      var wobY = WOBBLE_Y * g.dpr;
      if (mod.wobble_on(wobX, wobY) === 1) {
        root.dataset.ptTitleWobble = wobX.toFixed(2) + ',' + wobY.toFixed(2);
      }
    }
    mod.tick();
    ctx.putImageData(frame, 0, 0);
    return true;
  }

  /* ------------------------------------------------------------ 渲染循环 */

  function paused() {
    if (document.hidden || !visible) return true;
    return root.classList.contains('pt-bg-on');
  }

  function step(now) {
    raf = 0;
    if (!mod || !frame) return;
    if (paused()) {
      // 暂停期间不推进物理；恢复时从零攒时间，不会一次补几十帧。
      lastT = 0;
      acc = 0;
      raf = requestAnimationFrame(step);
      return;
    }
    if (!lastT) lastT = now;
    acc += Math.min(now - lastT, 250);
    lastT = now;
    var ticks = 0;
    while (acc >= STEP_MS && ticks < 4) {
      mod.tick();
      acc -= STEP_MS;
      ticks++;
    }
    if (ticks) ctx.putImageData(frame, 0, 0);
    raf = requestAnimationFrame(step);
  }

  function startLoop() {
    if (raf || reduced) return;
    lastT = 0;
    acc = 0;
    raf = requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------ 初始化 */

  function init() {
    var g = geometry();
    current = g;
    if (!buildEngine(g, styleInfo())) {
      mark('error');
      return;
    }
    if (!arm(g)) {
      mark('error');
      return;
    }
    mark(reduced ? 'reduced' : 'wasm');
    host.classList.add('is-particle');
    if (!reduced) startLoop();
  }

  function loadWasm() {
    if (!window.ptWasm || !window.ptWasm.supported || !cfg.wasm) {
      return Promise.resolve(null);
    }
    return window.ptWasm.instance(cfg.wasm).then(function (exports) {
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
        throw new Error('unexpected wasm interface');
      }
      return exports;
    });
  }

  /* ------------------------------------------------------------ 重建 */

  function rebuild(force) {
    if (!mod || !frame) return;
    var g = geometry();
    if (!force && g.w === current.w && g.h === current.h && g.dpr === current.dpr) return;
    current = g;
    if (!buildEngine(g, styleInfo())) {
      mark('error');
      host.classList.remove('is-particle');
      return;
    }
    if (!arm(g)) {
      mark('error');
      host.classList.remove('is-particle');
      return;
    }
    if (reduced) mark('reduced');
    else mark('wasm');
  }

  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      rebuild(false);
    }, 150);
  });

  // 深色切换：文字颜色变了，字形蒙版必须重画（不能只改 canvas 的 CSS）。
  // 同时监听 class 的 pt-bg-on 变化，但只在 dark 真正翻转时才重建。
  if ('MutationObserver' in window) {
    var isDark = root.classList.contains('dark');
    new MutationObserver(function () {
      var next = root.classList.contains('dark');
      if (next === isDark) return;
      isDark = next;
      rebuild(true);
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  // 滚出视口（首页标题通常在最上面，滚下去就看不到）→ 暂停 tick。
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { threshold: 0 }).observe(host);
  }

  /* ------------------------------------------------------------ 启动 */

  mark('waiting');
  var fontsReady =
    document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.all([loadWasm(), fontsReady])
    .then(function (r) {
      if (!r[0]) {
        mark('error');
        return;
      }
      mod = r[0];
      init();
    })
    .catch(function () {
      mark('error');
    });
})();
