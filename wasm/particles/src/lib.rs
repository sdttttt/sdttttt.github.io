//! WASM particle-image assembler — 裸导出（不用 wasm-bindgen）。
//!
//! 职责：把「源图 RGBA」变成「每帧渲染好的 RGBA 帧缓冲」。
//! JS 侧只做两件事：
//!   1. 把源图 RGBA 拷进线性内存，调 build()
//!   2. 每帧调 tick()，把 fb_ptr() 处的缓冲喂给 ImageData → putImageData
//!
//! 性能要点
//!   - 光栅化直接往帧缓冲写 u32，没有 Canvas 2D 的「4 万次 fillRect」
//!   - `tick()` 内**零堆分配** → 不会触发 memory.grow → JS 的 TypedArray 视图永不失效
//!   - 全程只有数值数组，无字符串、无对象、无回调和 JS 互调
//!
//! 单线程前提：WebAssembly 实例是单线程的，所以 `static mut ENGINE` 是安全的。

use core::ptr;

// ============================================================== 随机数

static mut SEED: u32 = 0x9e37_79b9;

/// xorshift32 —— 不引入 rand crate，省依赖也省体积
fn rnd() -> f32 {
    unsafe {
        SEED ^= SEED << 13;
        SEED ^= SEED >> 17;
        SEED ^= SEED << 5;
        (SEED >> 8) as f32 / 16_777_216.0
    }
}

// ============================================================== 小工具

const TAU: f32 = 6.283_185_5;

/// 单位圆上的均匀随机点。极角均匀 ⟺ 拒绝采样方块里落在圆内的点，
/// 所以不需要 atan2 / sin / cos —— wasm 里三角函数很贵，这里一个都用不上。
fn unit_circle() -> (f32, f32) {
    loop {
        let u = rnd() * 2.0 - 1.0;
        let v = rnd() * 2.0 - 1.0;
        let r2 = u * u + v * v;
        if r2 > 1e-4 && r2 <= 1.0 {
            let r = r2.sqrt();
            return (u / r, v / r);
        }
    }
}

// ============================================================== 引擎

struct Engine {
    n: usize,
    // 物理状态：当前位置 / 速度 / 目标位置
    px: Vec<f32>,
    py: Vec<f32>,
    vx: Vec<f32>,
    vy: Vec<f32>,
    tx: Vec<f32>,
    ty: Vec<f32>,
    // 颜色，打包成 u32（小端内存布局 = [r, g, b, a]）
    col: Vec<u32>,
    // 帧缓冲（设备像素，RGBA）
    fb: Vec<u8>,
    fb_w: u32,
    fb_h: u32,
    size: i32,
    // 源图备份：resize 时按新画布重新布局
    src: Vec<u8>,
    src_w: u32,
    src_h: u32,
    max_particles: u32,
    ratio: f32,
    // 粒子边长取整方式，见 make()：0 = floor × ratio（留缝）、
    // 1 = round × ratio、2 = 无缝（ceil(spacing) + ratio 出血）
    size_mode: u32,
    fit_w: f32,
    fit_h: f32,
    step: u32,
    // ---- 常驻漂浮（逐粒子独立相位，开关是 float_on）----
    //
    // 关键设计：漂浮偏移量与目标位置**分开存储**。弹簧只把 px/py 收到 tx/ty，
    // 漂浮在光栅化那一步叠加。这样弹簧永远不用去追一个会动的目标 ——
    // 否则两者会互相打架（弹簧把偏移拉没，漂浮又把它推出去）。
    //
    // 相位与速度在建表时一次性从 rnd() 生成（单位圆上的随机点），运行时
    // 只做简谐积分，**没有任何三角函数**：`v -= d·ω²; d += v`。
    fx: Vec<f32>,
    fy: Vec<f32>,
    fvx: Vec<f32>,
    fvy: Vec<f32>,
    f_amp: f32,
    f_wx: f32,
    f_wy: f32,
}

static mut ENGINE: Option<Engine> = None;

#[allow(static_mut_refs)]
fn eng() -> Option<&'static mut Engine> {
    unsafe { ENGINE.as_mut() }
}

// ============================================================== 给 JS 的内存入口

/// JS 申请一块内存写入源图 RGBA：
/// ```js
/// const p = mod.alloc(rgba.length);
/// new Uint8Array(mod.memory.buffer, p, rgba.length).set(rgba);
/// ```
/// 用完（build 之后）记得 `dealloc(p, len)`。
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(len);
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn dealloc(p: *mut u8, len: usize) {
    if p.is_null() {
        return;
    }
    unsafe { drop(Vec::from_raw_parts(p, 0, len)) };
}

// ============================================================== 采样

/// 按 step 扫一遍源图，数出不透明像素个数
fn count_opaque(src: &[u8], w: u32, h: u32, step: u32) -> usize {
    let mut n = 0usize;
    let mut y = 0u32;
    while y < h {
        let mut x = 0u32;
        while x < w {
            if src[((y * w + x) * 4 + 3) as usize] > 128 {
                n += 1;
            }
            x += step;
        }
        y += step;
    }
    n
}

const MAX_STEP: u32 = 24;

/// 按**粒子网格间距**（设备像素）反推 step。
///
/// 用「间距」而不是「粒子总数」当输入，是因为总数与画布尺寸耦合：同样 5 千颗
/// 粒子，放在 320×448 的徽标上就会很粗，放在 1275×1020 的大画布上就很细。
/// 给定间距后，粒子在两种尺寸下的**视觉密度一致**。
///
/// `step * scale` ≈ pitch，所以实际的粒子边长 ≈ `pitch * ratio`。
/// `max_particles` 是安全阀（大画布 + 小间距时防爆）。
fn pick_step(src: &[u8], sw: u32, sh: u32, pitch: f32, scale: f32, max_particles: u32) -> u32 {
    if scale <= 0.0 {
        return MAX_STEP;
    }
    let mut step = ((pitch / scale).round() as i64).clamp(1, MAX_STEP as i64) as u32;
    let cap = max_particles.clamp(200, 400_000);
    // 安全阀：粒子数超了就加大 step
    while step < MAX_STEP && count_opaque(src, sw, sh, step) as u32 > cap {
        step += 1;
    }
    step
}

/// 等比适配画布并居中，返回 (scale, offset_x, offset_y)
///
/// `fit_w` / `fit_h` 是留边系数：0.8 / 0.86 给大画布留呼吸空间；
/// 1.0 / 1.0 让图像**恰好填满**画布 —— 左下角徽标用后者，
/// 这样粒子渲染和 `<img object-fit:contain>` 的几何完全一致，
/// 双击在两者之间切换时不会出现尺寸跳变。
fn fit(cw: u32, ch: u32, iw: u32, ih: u32, fit_w: f32, fit_h: f32) -> (f32, f32, f32) {
    let cw = cw as f32;
    let ch = ch as f32;
    let iw = iw as f32;
    let ih = ih as f32;
    let scale = (cw * fit_w / iw).min(ch * fit_h / ih);
    (scale, (cw - iw * scale) / 2.0, (ch - ih * scale) / 2.0)
}

/// 从源图构建一颗引擎实例（build 与 resize 共用）
fn make(
    src: &[u8],
    sw: u32,
    sh: u32,
    cw: u32,
    ch: u32,
    pitch: f32,
    ratio: f32,
    fit_w: f32,
    fit_h: f32,
    max_particles: u32,
    size_mode: u32,
) -> Engine {
    let (scale, ox, oy) = fit(cw, ch, sw, sh, fit_w, fit_h);
    let step = pick_step(src, sw, sh, pitch, scale, max_particles);
    // 粒子边长（设备像素）。三个模式：
    //
    //   0  floor(spacing × ratio) —— “粒”感最强：保证 size < spacing，永远留缝。
    //      但采样间距换算到设备像素后往往不是整数（如 3.2px），而光栅化会把
    //      每个方块**居中对齐到整数像素**，于是相邻方块的中心距在 3 / 4 之间
    //      跳变 —— 跳变到 4 而 size 只有 3 时，中间就裂出 1px 白线。这就是
    //      徽标上那层“明显的白色线条”。
    //   1  round(spacing × ratio) —— 同上，只是能命中带小数的边长。
    //   2  无缝：ceil(spacing) + round(ratio)。此时 `ratio` 的含义改成
    //      **额外出血量（设备像素）**，不再是比例。边长 ≥ ceil(spacing)
    //      保证任意相邻方块（中心距 ≤ ceil(spacing)）至少相接；
    //      丢掉的缝隙由出血量找回来 —— 因为常驻漂浮会让每颗粒子各自位移，
    //      两块方块在运动中可能互相远离，不预先重叠就又会裂出白线。
    let spacing = step as f32 * scale;
    let raw_size = spacing * ratio;
    let size = match size_mode {
        0 => (raw_size.floor() as i32).max(1),
        1 => (raw_size.round() as i32).max(1),
        _ => ((spacing.ceil() as i32) + (ratio.round() as i32)).max(1),
    }
    .clamp(1, 64);
    let spread_x = cw as f32 * 2.4;
    let spread_y = ch as f32 * 2.4;

    let mut px = Vec::new();
    let mut py = Vec::new();
    let mut tx = Vec::new();
    let mut ty = Vec::new();
    let mut col = Vec::new();

    let mut y = 0u32;
    while y < sh {
        let mut x = 0u32;
        while x < sw {
            let i = ((y * sw + x) * 4) as usize;
            if src[i + 3] > 128 {
                let dx = ox + x as f32 * scale;
                let dy = oy + y as f32 * scale;
                tx.push(dx);
                ty.push(dy);
                // 起始位置：画布外随机散布 → 飞入聚合
                px.push(dx + (rnd() - 0.5) * spread_x);
                py.push(dy + (rnd() - 0.5) * spread_y);
                // 打包 RGBA -> u32（小端：[r, g, b, a]）
                col.push(
                    src[i] as u32
                        | (src[i + 1] as u32) << 8
                        | (src[i + 2] as u32) << 16
                        | 0xff00_0000,
                );
            }
            x += step;
        }
        y += step;
    }

    let n = px.len();
    Engine {
        n,
        vx: vec![0.0; n],
        vy: vec![0.0; n],
        px,
        py,
        tx,
        ty,
        col,
        fb: vec![0u8; (cw as usize) * (ch as usize) * 4],
        fb_w: cw,
        fb_h: ch,
        size,
        src: src.to_vec(),
        src_w: sw,
        src_h: sh,
        max_particles,
        ratio,
        size_mode,
        fit_w,
        fit_h,
        step,
        // 漂浮默认关闭：build() 之后由 float_on() 打开。
        // 顺带一个好处：飞入 / 落地这些**相干**动作期间漂浮是关着的，
        // 引擎不用在 tick() 里同时维护两套物理。
        fx: Vec::new(),
        fy: Vec::new(),
        fvx: Vec::new(),
        fvy: Vec::new(),
        f_amp: 0.0,
        f_wx: 0.0,
        f_wy: 0.0,
    }
}

impl Engine {
    /// 建（或重建）漂浮的相位表。只在 build / resize / 开关时调用，从不逐帧调用。
    ///
    /// `amp` 是设备像素振幅；`wx`/`wy` 是角频率（rad/帧）。x 与 y 用**不同**的
    /// 频率，否则每颗粒子都沿一条斜线来回，整片会显出斜向的规律。
    ///
    /// 每颗粒子的相位 = 单位圆上的随机点（拒绝采样，避免引入 sin/cos）：
    /// 位置取 `a·u/r`、速度取 `-a·ω·v/r`，于是 (d, v/ω) 落在半径 a 的圆上 ——
    /// 简谐运动的精确初值，振幅恒定、不会衰减也不会爆掉。
    fn init_float(&mut self, amp: f32, wx: f32, wy: f32) {
        let n = self.n;
        self.f_amp = if amp > 0.0 && amp.is_finite() { amp } else { 0.0 };
        self.f_wx = wx;
        self.f_wy = wy;
        self.fx = vec![0.0; n];
        self.fy = vec![0.0; n];
        self.fvx = vec![0.0; n];
        self.fvy = vec![0.0; n];
        if self.f_amp == 0.0 {
            return;
        }
        for i in 0..n {
            // 振幅 0.55a–1.0a 随机：有层次，不是整齐划一的一起振动
            let a = self.f_amp * (0.55 + 0.45 * rnd());
            let (u, v) = unit_circle();
            self.fx[i] = a * u;
            self.fvx[i] = -a * wx * v;
            let (u2, v2) = unit_circle();
            self.fy[i] = a * u2;
            self.fvy[i] = -a * wy * v2;
        }
    }

    /// 软件光栅化：清屏 + 把每颗粒子写成一个 size×size 的色块
    fn rasterize(&mut self) {
        self.fb.fill(0);
        let w = self.fb_w as i32;
        let h = self.fb_h as i32;
        let s = self.size;
        let half = s / 2;
        // 没有漂浮时走原路径，省掉每帧 n 次加法
        let floating = self.f_amp > 0.0 && self.fx.len() == self.n;

        for i in 0..self.n {
            let (ox, oy) = if floating {
                (self.fx[i], self.fy[i])
            } else {
                (0.0, 0.0)
            };
            let x0 = (self.px[i] + ox).round() as i32 - half;
            let y0 = (self.py[i] + oy).round() as i32 - half;
            let bytes = self.col[i].to_le_bytes();
            for yy in y0..(y0 + s) {
                if yy < 0 || yy >= h {
                    continue;
                }
                let row = yy * w;
                for xx in x0..(x0 + s) {
                    if xx < 0 || xx >= w {
                        continue;
                    }
                    let idx = ((row + xx) * 4) as usize;
                    self.fb[idx..idx + 4].copy_from_slice(&bytes);
                }
            }
        }
    }
}

// ============================================================== 对外接口

/// 构建。src 指向 JS 写进来的 RGBA；cw/ch 是画布**设备像素**尺寸。
/// `pitch` 是期望的粒子网格间距（设备像素）；`fit_w`/`fit_h` 见 `fit()`；
/// `max_particles` 是防爆上限；`size_mode` 是粒子边长的取整方式（见 `make()`：
/// 0 = 留缝、1 = round、2 = 无缝），返回值 0 表示成功，<0 表示参数非法。
#[no_mangle]
pub extern "C" fn build(
    src: *const u8,
    sw: u32,
    sh: u32,
    cw: u32,
    ch: u32,
    pitch: f32,
    ratio: f32,
    fit_w: f32,
    fit_h: f32,
    max_particles: u32,
    size_mode: u32,
) -> i32 {
    if src.is_null() || sw == 0 || sh == 0 || cw == 0 || ch == 0 {
        return -1;
    }
    let slice = unsafe { core::slice::from_raw_parts(src, sw as usize * sh as usize * 4) };
    let e = make(
        slice,
        sw,
        sh,
        cw,
        ch,
        pitch,
        ratio,
        fit_w,
        fit_h,
        max_particles,
        size_mode,
    );
    unsafe { ENGINE = Some(e) };
    0
}

/// 画布尺寸变了：按新画布重建布局（复用缓存的源图）。
/// `pitch` 一并传进来，因为 devicePixelRatio 可能随显示器变化。
#[no_mangle]
pub extern "C" fn resize(cw: u32, ch: u32, pitch: f32) -> i32 {
    let e = match eng() {
        Some(e) => e,
        None => return -1,
    };
    if cw == 0 || ch == 0 {
        return -1;
    }
    let (sw, sh, ratio, fit_w, fit_h, max_particles, size_mode) = (
        e.src_w,
        e.src_h,
        e.ratio,
        e.fit_w,
        e.fit_h,
        e.max_particles,
        e.size_mode,
    );
    let src = e.src.clone();
    // 漂浮的相位表必须跟着新粒子数组重建（n 变了），但频率与振幅要留着，
    // 否则一次窗口缩放就会把漂浮静默关掉。
    let (f_amp, f_wx, f_wy) = (e.f_amp, e.f_wx, e.f_wy);
    let mut next = make(
        &src,
        sw,
        sh,
        cw,
        ch,
        pitch,
        ratio,
        fit_w,
        fit_h,
        max_particles,
        size_mode,
    );
    next.init_float(f_amp, f_wx, f_wy);
    unsafe { ENGINE = Some(next) };
    0
}

/// 推进一帧：物理积分 + 光栅化。返回 1 表示还在动，0 表示已静止。
/// 注意：内部不分配内存，保证 memory 不增长、JS 视图不失效。
///
/// 这是**唯一的**动画来源。两条完全独立的通道：
///   · 弹簧：把飞入撒开的 px/py 收到 tx/ty（`burst()` 只负责往 vx/vy 里塞一把力）
///   · 漂浮：`float_on()` 打开后一直在跑的逐粒子微位移（简谐积分，无三角）
/// 只要漂浮还开着，这个函数永远不会返回 0 —— 调用方「还在动就继续排帧」
/// 的循环天然就是常驻的。
#[no_mangle]
pub extern "C" fn tick() -> i32 {
    let e = match eng() {
        Some(e) => e,
        None => return 0,
    };
    let spring = 0.08f32;
    let damp = 0.86f32;
    let mut max_v = 0.0f32;

    {
        let (px, py, vx, vy, tx, ty) = (
            &mut e.px,
            &mut e.py,
            &mut e.vx,
            &mut e.vy,
            &e.tx,
            &e.ty,
        );
        for i in 0..e.n {
            let target_x = tx[i];
            let target_y = ty[i];
            let mut v_x = vx[i] + (target_x - px[i]) * spring;
            let mut v_y = vy[i] + (target_y - py[i]) * spring;
            v_x *= damp;
            v_y *= damp;
            vx[i] = v_x;
            vy[i] = v_y;
            px[i] += v_x;
            py[i] += v_y;
            let v = v_x.abs() + v_y.abs();
            if v > max_v {
                max_v = v;
            }
        }
    }

    // 漂浮：逐粒子简谐积分（半隐式欧拉）。ω 很小（周期几百帧），稳定裕度极大，
    // 不需要额外限幅。注意它**不动 px/py**，只积分 fx/fy。
    let floating = e.f_amp > 0.0 && e.fx.len() == e.n;
    if floating {
        let wx2 = e.f_wx * e.f_wx;
        let wy2 = e.f_wy * e.f_wy;
        let (fx, fy, fvx, fvy) = (&mut e.fx, &mut e.fy, &mut e.fvx, &mut e.fvy);
        for i in 0..e.n {
            fvx[i] -= fx[i] * wx2;
            fx[i] += fvx[i];
            fvy[i] -= fy[i] * wy2;
            fy[i] += fvy[i];
        }
    }

    e.rasterize();
    if max_v > 0.05 || floating {
        1
    } else {
        0
    }
}

/// 直接把粒子放到目标位置（prefers-reduced-motion / 想要静态成品时用）
#[no_mangle]
pub extern "C" fn settle() {
    let e = match eng() {
        Some(e) => e,
        None => return,
    };
    for i in 0..e.n {
        e.px[i] = e.tx[i];
        e.py[i] = e.ty[i];
        e.vx[i] = 0.0;
        e.vy[i] = 0.0;
    }
    e.rasterize();
}

// ============================================================== 交互力（徽标动效）

/// 从 (x, y) 向外的一次性径向冲量。
///
/// 坐标与粒子的 px/py 同一坐标系（**设备像素**），所以调用方要自己把
/// CSS 坐标乘上 dpr —— 引擎内部不保存 fit() 算出的 scale/ox/oy。
///
/// 用途：飞入聚合结束后从画布中心「顿」一下，或指针点击处的爆散。
/// 返回受影响的粒子数（0 = 没有引擎 / 半径非法 / 半径内没有粒子）。
///
/// 之所以能和 `tick()` 分工得这么干净：冲量只写 `vx/vy`，
/// 之后的减速、回位、停帧全部由已有的弹簧阻尼积木自动接管。
#[no_mangle]
pub extern "C" fn burst(x: f32, y: f32, radius: f32, power: f32) -> i32 {
    let e = match eng() {
        Some(e) => e,
        None => return 0,
    };
    if !(radius > 0.0) || !power.is_finite() {
        return 0;
    }
    let r2 = radius * radius;
    let mut hit = 0i32;
    for i in 0..e.n {
        let dx = e.px[i] - x;
        let dy = e.py[i] - y;
        let d2 = dx * dx + dy * dy;
        if d2 > r2 {
            continue;
        }
        // 线性衰减：中心最强，到半径处归零（保证边界连续，不出硬边）
        let d = d2.sqrt().max(0.001);
        let f = power * (1.0 - d / radius);
        e.vx[i] += dx / d * f;
        e.vy[i] += dy / d * f;
        hit += 1;
    }
    hit
}

/// 打开**常驻漂浮**：每颗粒子围绕自己的目标位做小幅简谐运动，永不停止。
///
/// `amp` 是**设备像素**振幅（上界值；实际每颗在 0.55·amp–amp 之间随机），
/// `period` 是 x 方向的周期，单位是**帧**；y 方向内部用 1.37 倍周期（互质
/// 得差不多就行），免得每颗粒子都沿同一条斜线来回。
///
/// 为什么这不是「呼吸」也不是「行波」：
///   · 呼吸 / 缩放是**相干**的 —— 全图所有粒子同时往同一个方向走，格子
///     间距会被整体改变，实测会沿水平方向浮出规律的亮纹。
///   · 漂浮是**非相干**的 —— 每颗粒子的相位独立、振幅也不同，不存在某个
///     方向上的整体事件，所以结构上不可能长出摩尔纹、也不可能亮纹爬行。
///
/// 相位在建表时从 `rnd()` 生成（单位圆上的随机点），运行时只做 `v -= d·ω²;
/// d += v`，**一个三角函数都不用**：这直接关系到 wasm 体积，实测真的引入
/// `f32::sin` 会把 libm 拖进来，产物从 23KB 涨到 30KB（+33%）。
///
/// 返回 1 表示已开启；0 表示没有引擎 / amp 非法（0、NaN、负值）。
#[no_mangle]
pub extern "C" fn float_on(amp: f32, period: f32) -> i32 {
    let e = match eng() {
        Some(e) => e,
        None => return 0,
    };
    if !(amp > 0.0) || !amp.is_finite() || !(period > 0.0) || !period.is_finite() {
        e.init_float(0.0, 0.0, 0.0);
        return 0;
    }
    // 角频率：ω 取小一点更稳，硬夹一下防止调用方传个荒谬的周期
    let period = period.clamp(30.0, 100_000.0);
    let wx = TAU / period;
    let wy = TAU / (period * 1.37);
    e.init_float(amp, wx, wy);
    1
}

/// 关闭漂浮（回到静止成品帧）。飞入 / 落地这些相干阶段会自动停用。
#[no_mangle]
pub extern "C" fn float_off() -> i32 {
    match eng() {
        Some(e) => {
            e.init_float(0.0, 0.0, 0.0);
            1
        }
        None => 0,
    }
}

/// 距目标位置的**最大**距离（设备像素）。诊断用：飞入 / 呼吸收敛了没有、
/// 冲量给大了还是小了，看这个值比看截图直观。
#[no_mangle]
pub extern "C" fn max_offset() -> f32 {
    let e = match eng() {
        Some(e) => e,
        None => return 0.0,
    };
    let mut m = 0.0f32;
    for i in 0..e.n {
        let dx = e.px[i] - e.tx[i];
        let dy = e.py[i] - e.ty[i];
        let d = dx * dx + dy * dy;
        if d > m {
            m = d;
        }
    }
    m.sqrt()
}

// ============================================================== 只读访问器

#[no_mangle]
pub extern "C" fn fb_ptr() -> *const u8 {
    match eng() {
        Some(e) => e.fb.as_ptr(),
        None => ptr::null(),
    }
}

#[no_mangle]
pub extern "C" fn fb_len() -> usize {
    match eng() {
        Some(e) => e.fb.len(),
        None => 0,
    }
}

#[no_mangle]
pub extern "C" fn fb_width() -> u32 {
    match eng() {
        Some(e) => e.fb_w,
        None => 0,
    }
}

#[no_mangle]
pub extern "C" fn fb_height() -> u32 {
    match eng() {
        Some(e) => e.fb_h,
        None => 0,
    }
}

#[no_mangle]
pub extern "C" fn particle_count() -> u32 {
    match eng() {
        Some(e) => e.n as u32,
        None => 0,
    }
}

/// 实际用到的采样步长（诊断用）
#[no_mangle]
pub extern "C" fn sample_step() -> u32 {
    match eng() {
        Some(e) => e.step,
        None => 0,
    }
}

/// 实际粒子边长（设备像素，诊断用）
#[no_mangle]
pub extern "C" fn particle_size() -> i32 {
    match eng() {
        Some(e) => e.size,
        None => 0,
    }
}
