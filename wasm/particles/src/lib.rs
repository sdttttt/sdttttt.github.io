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
    fit_w: f32,
    fit_h: f32,
    step: u32,
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
) -> Engine {
    let (scale, ox, oy) = fit(cw, ch, sw, sh, fit_w, fit_h);
    let step = pick_step(src, sw, sh, pitch, scale, max_particles);
    // 粒子边长（设备像素）：采样间距 × 缩放 × 比例系数，钳在 [1, 64]
    let size = ((step as f32 * scale * ratio).round() as i32).clamp(1, 64);
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
        fit_w,
        fit_h,
        step,
    }
}

impl Engine {
    /// 软件光栅化：清屏 + 把每颗粒子写成一个 size×size 的色块
    fn rasterize(&mut self) {
        self.fb.fill(0);
        let w = self.fb_w as i32;
        let h = self.fb_h as i32;
        let s = self.size;
        let half = s / 2;

        for i in 0..self.n {
            let x0 = (self.px[i].round() as i32) - half;
            let y0 = (self.py[i].round() as i32) - half;
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
/// `max_particles` 是防爆上限。返回 0 表示成功，<0 表示参数非法。
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
) -> i32 {
    if src.is_null() || sw == 0 || sh == 0 || cw == 0 || ch == 0 {
        return -1;
    }
    let slice = unsafe { core::slice::from_raw_parts(src, sw as usize * sh as usize * 4) };
    let e = make(slice, sw, sh, cw, ch, pitch, ratio, fit_w, fit_h, max_particles);
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
    let (sw, sh, ratio, fit_w, fit_h, max_particles) = (
        e.src_w,
        e.src_h,
        e.ratio,
        e.fit_w,
        e.fit_h,
        e.max_particles,
    );
    let src = e.src.clone();
    let next = make(&src, sw, sh, cw, ch, pitch, ratio, fit_w, fit_h, max_particles);
    unsafe { ENGINE = Some(next) };
    0
}

/// 推进一帧：物理积分 + 光栅化。返回 1 表示还在动，0 表示已静止。
/// 注意：内部不分配内存，保证 memory 不增长、JS 视图不失效。
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

    e.rasterize();
    if max_v > 0.05 {
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
