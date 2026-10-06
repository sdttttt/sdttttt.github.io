/* ---------------------------------------------------------------------------
 * 页面左下角的装饰徽标 —— 用 WASM 粒子渲染，双击切回真实图片。
 *
 * 呈现方式（2026-10 起重做）：**飞入聚合 → 落地顿一下 → 待机漂浮**。
 *   build() 时粒子被随机撒在一个比画布大的范围里，tick() 的弹簧阻尼把它们
 *   收拢到目标位置（这就是「飞入」，约 1.6s）；落定瞬间用 burst() 从画布中心
 *   补一记径向冲量（「顿一下」）；之后由 float_on() 接管 —— 每颗粒子拿一套
 *   随机相位/振幅、绕自己的初始位慢慢画圆，单颗粒子只挪亚像素级，整幅看上去
 *   是**像素点在微微闪烁**。显隐依旧是 CSS 的 opacity 过渡。
 *
 *   待机动效这里走过一段弯路，值得记一笔。粒子方块的边长（5 设备 px）比
 *   采样间距（3.2 设备 px）只大 1.8px，方块之间只是勉强相接，所以**位移
 *   梯度**一大就会把缝隙撕开、冒出白纹。当年在「出血量只有 0.2px」的旧
 *   参数下试过竖直行波（静位移 5px 就出条纹、1px 又完全看不出动过，可用
 *   区间近乎为零）、绕中心缩放（会整体「呼吸」），一度得出「相干驱动力
 *   一律不可用」的结论 —— 那个结论只在旧参数下成立。改成无缝边长、出血量
 *   1.8px 之后，只要**把位移梯度压低**，相干波（ripple_on：径向涟漪 /
 *   横向剪切 / 单向纵波）就重新可用，实测也确实比随机漂浮自然：
 *     · 径向涟漪：波长远大于采样间距，相邻粒子的相对位移 ≈ amp·k·间距，
 *       λ = 120 设备 px、间距 3.2 时只有 0.05·amp，振幅 8px 才 0.4px。
 *     · 横向剪切：位移只随 y 变化 → 同一行整体平移，行距分毫不变，
 *       相对位移恒等于 0，结构上不可能裂缝。
 *   真正不能用的是「让相邻行互相错开」的垂直位移 —— 1:1 图上立刻出条纹。
 *
 *   **但最后选的是 float**：水波压到 amp 2 CSS px / λ 80 / 7.5s 之后，反馈
 *   仍是「整幅在动」；相比之下逐粒子漂浮只有亚像素级抖动、安静得多。
 *   引擎侧的 float_on / ripple_on 都还在，改 cfg.idleEffect 就能换回去。
 *
 *   白线本身是另一个坑，在 Rust 的 make() 里用 size_mode = 2（无缝）解决：
 *   取整后 size 3 < 间距 3.2，方块中心又被吸附到整数像素，相邻中心距在 3/4
 *   之间跳变 —— 跳到 4 就裂出 1px 白线。详见那边的注释。
 *
 *   跑 rAF，所以有三重闸：html.at-bottom（徽标已揭示）、文档在前台、没切成
 *   真实图片；`prefers-reduced-motion` 下直接吸附出成品，一帧都不动。
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
  var RATIO = cfg.sizeRatio == null ? 0.85 : cfg.sizeRatio;
  // 徽标要粒子**恰好填满**盒子，才能和 `<img object-fit:contain>` 完全对齐，
  // 双击切换不会有尺寸跳变 —— 所以留边系数是 1/1（大画布用的是 0.8/0.86）
  var FIT_W = cfg.fitW || 1;
  var FIT_H = cfg.fitH || 1;
  // 粒子网格间距（CSS px）—— 视觉密度的**唯一旋钮**，与画布尺寸解耦
  var PITCH_CSS = cfg.pitchCss || 2;
  var MAX_PARTICLES = cfg.maxParticles || 60000;
  // 粒子边长的取整模式，对应 Rust 侧 make() 的 size_mode：
  //   2 = 无缝：size = ceil(间距) + round(sizeRatio)，**sizeRatio 的含义从
  //       “比例”变成“额外出血量（设备 px）”**。徽标用这一档。
  //   1 = round(间距 × sizeRatio)
  //   0 = floor(间距 × sizeRatio)（最“颗粒”但一定留缝 → 一定长白线）
  var SIZE_MODE = cfg.gapFree ? 2 : cfg.grain === false ? 1 : 0;

  // ---- 动效参数 ----
  // 三个阶段：飞入（land）→ 落地顿一下（thump）→ 待机（idle）。
  //
  //   飞入 / 落地都是**相干**冲量，但只跑一次，而且此时粒子还在大范围移动，
  //   没人会去数格子。长期待机则必须挑一个**位移梯度足够低**的场：
  //   idleEffect 选 'float'（逐粒子随机相位，非相干）或 'ripple'（水波，
  //   相干，三个模式，详见 Rust 的 ripple_on()）。float 是当前默认。
  //
  // 落地冲量力度（设备像素速度）：发动机里线性衰减到半径处归零，
  // 1.4 对应峰值位移 3 个设备像素左右 —— 明显一顿但不散架。0 = 不顿。
  var THUMP_POWER = cfg.thumpPower == null ? 1.4 : cfg.thumpPower;

  // 待机动效：'float'（逐粒子随机漂浮，默认 —— 单颗粒子只挪亚像素级，整幅
  // 看上去是轻微的像素闪烁）或 'ripple'（水波荡漾）。写其他值一律按 float。
  var IDLE_EFFECT = cfg.idleEffect === 'ripple' ? 'ripple' : 'float';

  // 水波参数（只在 idleEffect: 'ripple' 时生效；留着是为了能一键切回去）。
  // 振幅与波长都写 **CSS px**，内部乘 dpr 转设备 px —— 观感与
  // 屏幕密度无关；而 dpr 被 dprCap 夹在 2 以内，梯度也就总是在安全范围内。
  //   rippleMode   'rise'   单向纵波：波前是水平线，**自下而上**推过去，
  //                         位移沿纵向（画面像被一波波抬起）。默认
  //                'radial' 径向涟漪（从画布中心一圈圈荡开）
  //                'shear'  横向剪切（同一行整体左右平移，经典水中倒影）
  //   rippleAmp    振幅（CSS px）
  //   rippleLength 波长（CSS px）。60 时整幅约 7 个波，是「细密荡漾」的量级；
  //                120/240 更接近大涌
  //   ripplePeriod 一个周期多少毫秒（慢了看不见，快了就是抖）
  //
  // 'rise' 与 'shear' 共用引擎里的模式 0（位移只随 y 变化），区别只在把振幅
  // 给哪一个分量：'shear' 给横向（行距不变，结构上不可能裂）、'rise' 给纵向
  // （行距会被压缩/拉伸，靠低梯度保安全 —— 波长 80 CSS px 下相邻采样行的
  // 相对位移只有 0.5 设备 px，出血量 1.8）。
  var RIPPLE_RISE = cfg.rippleMode === 'rise';
  var RIPPLE_MODE = cfg.rippleMode === 'shear' || RIPPLE_RISE ? 0 : 1;
  var RIPPLE_AMP = cfg.rippleAmp == null ? 2 : cfg.rippleAmp;
  var RIPPLE_LENGTH = cfg.rippleLength || 80;
  var RIPPLE_PERIOD = cfg.ripplePeriod || 7500;

  // 漂浮（当前默认的待机动效）。
  // 振幅是 CSS px；相邻两颗粒子各自最多反向走 2×振幅，所以它受「出血量」
  // 约束：现状 step4 出血 1.8 设备 px（间距 3.2 / 边长 5），0.4 CSS px
  // （@dpr2 = 0.8 设备 px）下透明孔洞与静止帧完全一致。
  var FLOAT_AMP = cfg.floatAmp == null ? 0.4 : cfg.floatAmp;
  // 漂浮周期（毫秒）。慢了看不见，快了就是抖。
  var FLOAT_PERIOD = cfg.floatPeriod || 5200;

  // 一页一图：页面里的 <img> 与粒子共用同一张（赋 src 推迟到 start()，
  // 免得在一篇永远不会滚到底的文章上白下 50KB；HTML 里那张图仍是兜底）
  var SRC = IMAGES[Math.floor(Math.random() * IMAGES.length)];

  var ctx = canvas.getContext('2d');
  var mod = null;
  var frame = null;
  var drawn = false; // 当前 frame 是否已经画到 canvas 上
  var lastDpr = 1; // 最近一次算出的有效 devicePixelRatio（漂浮振幅要用）

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
    lastDpr = dpr;
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

  /* 把帧缓冲贴到 canvas 上。粒子位置一直活在 wasm 的 px/py 里，所以只要
     内存里那份 ImageData 还是活的，贴上去就是当前帧。 */
  function blit() {
    if (!frame) return;
    ctx.putImageData(frame, 0, 0);
    drawn = true;
  }

  /* 立刻吸附到位并画一帧（减少动态效果 / resize / 双击切回时用）。
     代价是粒子从随机散布「跳」到目标位置 —— 没有飞入。
     顺带把待机动效关掉：resize 会重建内部状态，不关的话那一帧的偏移量
     恰好最大。*/
  function draw() {
    if (!frame) return;
    stopMotion();
    phase = 'idle';
    idleOn = false;
    if (mod.float_off) mod.float_off();
    if (mod.ripple_off) mod.ripple_off();
    mod.settle();
    blit();
  }

  /* ---------------------------------------------------------- 动效状态机 */

  // land（飞入）→ thump（落地顿一下）→ idle（待机荡漾）
  var phase = 'land';
  var raf = 0;
  var lastT = 0;
  // 待机动效是否已开启（引擎内部的相位表 / 参数只在第一次进 idle 时建）
  var idleOn = false;
  // 实测帧间隔的指数平均：漂浮的周期以「帧」为单位传进引擎，
  // 60Hz / 120Hz 屏上要拿到同一个墙钟周期，就得先把毫秒换算成帧数。
  var avgDt = 16.7;

  // 尊重系统设置：prefers-reduced-motion 下不飞入、不漂浮，直接出成品。
  var REDUCED = false;
  try {
    REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}
  // 动效接口缺失（旧 wasm / 旧加载器）同样退化成静态粒子，不算错误。
  var NO_ANIM = REDUCED;

  function stopMotion() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    lastT = 0;
  }

  /* 什么时候该动：徽标已揭示（html.at-bottom）+ 页面在前台 + 没切成真实图片。
     滚离页底、切后台标签页、双击切换都会让动画彻底停下，不白烧 CPU。 */
  function motionAllowed() {
    return root.classList.contains('at-bottom') && !document.hidden && !inPhotoMode();
  }

  function step(now) {
    raf = 0;
    if (!mod || !frame || !motionAllowed()) return;

    // 相位按**时间**推进：先算实测帧间隔，再用它把漂浮周期换算成帧数。
    var dt = lastT ? Math.min(now - lastT, 100) : 16.7;
    lastT = now;
    avgDt = avgDt + (dt - avgDt) * 0.1;

    // 每帧**只** tick 一次：tick 的返回值（0 = 弹簧已经平静）既是「这一档
    // 走完了吗」的唯一信号，也是换档依据。因此换档必然发生在一帧的尾部，
    // 比实际动作晚一帧 —— 肉眼不可见。
    var busy = mod.tick() !== 0;
    if (!busy) {
      if (phase === 'land' && THUMP_POWER > 0) {
        phase = 'thump';
        // 坐标必须是**设备像素**：引擎不知道 dpr，它只认自己的 px/py
        // （canvas.width 就是设备像素，所以直接用，不要再乘 dpr）
        mod.burst(
          canvas.width / 2,
          canvas.height / 2,
          Math.max(canvas.width, canvas.height),
          THUMP_POWER,
        );
        busy = true;
      } else if (phase !== 'idle') {
        phase = 'idle';
      }
    }

    if (phase === 'idle') {
      if (IDLE_EFFECT === 'float') {
        if (FLOAT_AMP > 0 && mod.float_on) {
          if (!idleOn) {
            // 只开一次：float_on 会重建相位表，每帧调一次等于把漂浮钉死在
            // 初始相位上（粒子会原地不动）。
            mod.float_on(FLOAT_AMP * lastDpr, FLOAT_PERIOD / avgDt);
            idleOn = true;
          }
          // 漂浮是**常驻**状态：引擎里的 tick() 只要它开着就永远返回 1，
          // 所以这里跟着 busy = true，rAF 链永不断。
          busy = true;
        } else {
          busy = false;
        }
      } else if (RIPPLE_AMP > 0 && mod.ripple_on) {
        if (!idleOn) {
          // 同样只开一次：每帧调一次会把相位反复清零（波会停在原地）。
          // 模式 0（'shear' / 'rise'）只给一个分量：横向剪切不给垂直振幅，
          // 纵向纵波不给水平振幅。径向两个分量都要（沿半径推）。
          mod.ripple_on(
            RIPPLE_MODE === 1 || RIPPLE_RISE ? 0 : RIPPLE_AMP * lastDpr,
            RIPPLE_MODE === 1 || RIPPLE_RISE ? RIPPLE_AMP * lastDpr : 0,
            RIPPLE_LENGTH * lastDpr,
            RIPPLE_PERIOD / avgDt,
            RIPPLE_MODE,
          );
          idleOn = true;
        }
        // 水波也是常驻：tick() 在 ripple 开着时永远返回 1。
        busy = true;
      } else {
        busy = false;
      }
    }

    blit();
    if (busy) raf = requestAnimationFrame(step);
  }

  /* 幂等地把动画叫起来。首次揭示会从「飞入」开始；已经在跑就什么都不做。 */
  function startMotion() {
    if (raf || !mod || !frame) return;
    if (NO_ANIM) {
      if (!drawn) draw();
      return;
    }
    raf = requestAnimationFrame(step);
  }

  /* 唯一的显隐开关：写 html.at-bottom，CSS 负责淡入 / 淡出。 */
  function syncGate() {
    // 预热时机：滚到离页底还有 PREWARM_VIEWPORTS 个视口高度时就开工。
    // 短页面（文档总高不足这么高）在首次调用时就会直接开工，行为和以前一致。
    if (nearBottom()) start();
    var on = atBottom();
    root.classList.toggle('at-bottom', on);
    if (!on) {
      // 滚离页底就停手：显隐走 CSS 过渡，画布内容不需要重画
      stopMotion();
      return;
    }
    if (!frame) return; // 引擎还没就绪（boot() 就绪后会再调一次 syncGate）
    startMotion();
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
    if (inPhotoMode()) {
      stopMotion(); // 切成照片 = 粒子被藏起来，没必要继续算
    } else {
      blit();
      startMotion();
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
          SIZE_MODE,
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
      // resize 会把粒子位置重新随机，直接吸附重画（**不重放飞入**：徽标已经
      // 落定了，拖动窗口时反复飞入会很闹），然后接着荡漾
      drawn = false;
      draw();
      startMotion();
    }, 200);
  });

  // 切后台就停手，切回来再续上（否则后台标签页会一直烧 CPU 跑水波）
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopMotion();
    else syncGate();
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
        // 徽标要 build / settle / alloc / dealloc / resize / 各访问器；动效还
        // 额外要 tick / burst / 待机动效那个入口（float_on 或 ripple_on）。
        // 缺动效接口不算致命 —— 退化成静态粒子。
        if (typeof exports.build !== 'function' || typeof exports.settle !== 'function') {
          mark('error');
          return;
        }
        if (
          typeof exports.tick !== 'function' ||
          typeof exports.burst !== 'function' ||
          (IDLE_EFFECT === 'float'
            ? typeof exports.float_on !== 'function'
            : typeof exports.ripple_on !== 'function')
        ) {
          NO_ANIM = true;
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
