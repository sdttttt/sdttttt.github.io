//! `particles` 引擎的单元测试。
//!
//! `#[cfg(test)]` → 只在宿主上编译，**不进 wasm 产物**：
//!
//!     cd wasm/particles && cargo test     # 或仓库根的 `deno task test-wasm`
//!
//! 引擎挂在 `static mut ENGINE` 上（wasm 单线程所以安全），而 cargo test 默认
//! 多线程跑测试 —— 所以每个测试都先抢一把全局锁，把它们串起来。测试里大量
//! 直接读写 `Engine` 的私有字段（同一 crate 内可见）：这样断言的是**状态**，
//! 不只是几个公开的返回值。
//!
//! 覆盖度（实测于 2026-10-06，rustc 1.99 + `rustup component add llvm-tools-preview`）：
//! `lib.rs` 836 regions / 30 个函数 / 530 行 —— 全部 100%；`tests.rs` 只差 2 个
//! region（就是下面 `setup()` 里“锁中毒恢复”那个闭包，除非有测试持锁 panic，
//! 否则跑不到）。复现：
//!
//! ```text
//! cd wasm/particles
//! LLVM_PROFILE_FILE=/tmp/particles-%p.profraw RUSTFLAGS="-C instrument-coverage" cargo test
//! BIN=$(ls -d ~/.rustup/toolchains/*/lib/rustlib/*/bin)
//! $BIN/llvm-profdata merge -sparse /tmp/particles-*.profraw -o /tmp/particles.profdata
//! $BIN/llvm-cov report $(ls -t target/debug/deps/particles-* | grep -v '\.d$' | head -1) \
//!     -instr-profile=/tmp/particles.profdata --ignore-filename-regex='rustlib'
//! ```
//!
//! 有意的取舍：`tick()` 的停止判据是**速度**（max|vx| + |vy| <= 0.05）而不是位置，
//! 而阻尼振子的速度每 ~7 帧过一次零点 —— 所以 `run_until_still()` 会「停得偏早」，
//! 报 0 也不「粘住」（下一帧速度又爬回阈值以上）。测试断言的是这个真实口径，
//! 不是理想收敛；真要位置对齐得显式 `settle()`。

use super::*;
use std::sync::{Mutex, MutexGuard};

/// 全局串行锁（见模块头注释）
static LOCK: Mutex<()> = Mutex::new(());

/// 抢锁 → 清引擎 → 复位随机种子：每个测试都从同一个干净状态出发。
/// 返回的 guard 必须活到测试结束（`let _g = setup();`）。
fn setup() -> MutexGuard<'static, ()> {
    let g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    unsafe {
        ENGINE = None;
        SEED = 0x9e37_79b9;
    }
    g
}

fn engine() -> &'static mut Engine {
    eng().expect("引擎应当已构建")
}

// ---- 造图工具 ----

fn opaque_all(_x: u32, _y: u32) -> bool {
    true
}
fn opaque_none(_x: u32, _y: u32) -> bool {
    false
}
/// 每 3 列有 1 列不透明（x % 3 == 0）
fn opaque_every_third_col(x: u32, _y: u32) -> bool {
    x % 3 == 0
}

/// 造一张 RGBA 源图；`opaque` 决定每像素 alpha（真 = 255，假 = 0）。
/// 颜色写成可反查的 (x % 251, y % 241, 0x33)。
fn src_img(w: u32, h: u32, opaque: fn(u32, u32) -> bool) -> Vec<u8> {
    let mut v = vec![0u8; (w as usize) * (h as usize) * 4];
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            v[i] = (x % 251) as u8;
            v[i + 1] = (y % 241) as u8;
            v[i + 2] = 0x33;
            v[i + 3] = if opaque(x, y) { 255 } else { 0 };
        }
    }
    v
}

/// 建一张 40×40 全不透明源图 → 画布 40×40、fit 1.0/1.0 → scale = 1.0、
/// step = 4（spacing = 4.0）→ 10×10 = 100 颗粒子。
fn build_demo(size_mode: u32) -> Vec<u8> {
    let src = src_img(40, 40, opaque_all);
    assert_eq!(
        build(
            src.as_ptr(),
            40,
            40,
            40,
            40,
            4.0,
            1.0,
            1.0,
            1.0,
            200_000,
            size_mode
        ),
        0
    );
    src
}

/// 250×250 → 画布 200×200、fit 1.0 → scale = 0.8；pitch 3.2 → step = 4
/// ⇒ spacing = 3.2（非整数，正是白线问题的现实起点）。
/// 一直积到 `tick()` 报静止，返回积了多少帧；2000 帧还没停就判为不收敛。
/// ⚠️ `tick()` 的判据是**速度**（max|vx| + |vy| <= 0.05），阻尼振子的速度每
/// ~7 帧过一次零点 —— 这个循环会在第一个过零点就退出，此时位置还剩不少残余，
/// 别把它当成「收敛到零」。真要对齐位置得显式 `settle()`。
fn run_until_still() -> usize {
    let mut frames = 0;
    while tick() != 0 {
        frames += 1;
        assert!(frames < 2000, "弹簧不收敛");
    }
    frames
}

fn build_250(mode: u32, ratio: f32) -> i32 {
    let src = src_img(250, 250, opaque_all);
    build(
        src.as_ptr(),
        250,
        250,
        200,
        200,
        3.2,
        ratio,
        1.0,
        1.0,
        200_000,
        mode,
    )
}

// ---------------------------------------------------------- 随机数与近似

#[test]
fn rnd_is_deterministic_and_stays_in_the_unit_interval() {
    let _g = setup();
    let mut seen = Vec::new();
    for _ in 0..1000 {
        let v = rnd();
        assert!((0.0..1.0).contains(&v), "rnd() 越界：{v}");
        seen.push(v);
    }
    assert!(seen.iter().any(|v| *v != seen[0]), "序列不应当恒定");
    // 复位种子后序列必须逐位复现（测试可重复的前提）
    unsafe { SEED = 0x9e37_79b9 };
    let mut again = Vec::new();
    for _ in 0..1000 {
        again.push(rnd());
    }
    assert_eq!(seen, again);
}

#[test]
fn unit_circle_rejects_samples_at_the_origin_and_outside() {
    let _g = setup();
    // 种子 7966：头两个随机数给出的点离原点只有 ~0.0067（r² ≈ 4.5e-5）
    // → 命中 `r2 > 1e-4` 的假分支，必须重抽
    unsafe { SEED = 7966 };
    let (u0, v0) = (rnd() * 2.0 - 1.0, rnd() * 2.0 - 1.0);
    let r2 = u0 * u0 + v0 * v0;
    assert!(
        r2 <= 1e-4,
        "种子 7966 的首个样本应当落在原点附近（r² = {r2}）"
    );
    unsafe { SEED = 7966 };
    let (x, y) = unit_circle();
    let after = rnd();
    unsafe { SEED = 7966 };
    // 前 3 对依次是 r² ≈ 4.5e-5（原点附近）/ 1.22（圆外）/ 1.66（圆外），
    // 第 4 对才落在圆内 → 总共消耗 8 个随机数
    for _ in 0..8 {
        let _ = rnd();
    }
    assert_eq!(
        after,
        rnd(),
        "应当恰好消耗 8 个随机数（拒绝 3 次 + 接受 1 次）"
    );
    assert!((x * x + y * y - 1.0).abs() < 1e-3, "必须是单位向量");

    // 种子 1：首个样本落在单位圆外（r² ≈ 1.94）→ 命中 `r2 <= 1.0` 的假分支
    unsafe { SEED = 1 };
    let (u0, v0) = (rnd() * 2.0 - 1.0, rnd() * 2.0 - 1.0);
    assert!(u0 * u0 + v0 * v0 > 1.0, "种子 1 的首个样本应当在圆外");
    unsafe { SEED = 1 };
    let (x, y) = unit_circle();
    // 种子 1：第 1 对在圆外被拒，第 2 对接受 → 恰好 4 个随机数
    let after = rnd();
    unsafe { SEED = 1 };
    for _ in 0..4 {
        let _ = rnd();
    }
    assert_eq!(
        after,
        rnd(),
        "应当恰好消耗 4 个随机数（拒绝 1 次 + 接受 1 次）"
    );
    assert!((x * x + y * y - 1.0).abs() < 1e-3);

    // 大样本：无 panic、恒为单位向量
    for _ in 0..2000 {
        let (x, y) = unit_circle();
        assert!((x * x + y * y - 1.0).abs() < 1e-3);
    }
}

#[test]
fn fast_sin_tracks_real_sin_within_the_documented_error() {
    let _g = setup();
    let mut worst = 0.0f64;
    let mut x = -20.0f32;
    while x <= 20.0 {
        let e = (fast_sin(x) as f64 - (x as f64).sin()).abs();
        if e > worst {
            worst = e;
        }
        x += 0.01;
    }
    // 实测最大绝对误差 1.633e-3（x ≈ -18.647）；文档里的 0.16% 是相对误差
    assert!(worst < 2.0e-3, "最大绝对误差 {worst:e} 超出预期");
    assert!(worst > 1.0e-3, "误差小得反常，近似公式是不是被换掉了？");
    // 半周期折叠的边界 + 整数周期（t - t.floor() 的负方向也要走通）
    assert_eq!(fast_sin(0.0), 0.0);
    assert!(fast_sin(TAU).abs() < 1e-6);
    assert!(fast_sin(-TAU).abs() < 1e-6);
    assert!(fast_sin(TAU * 3.0).abs() < 1e-6);
    assert!((fast_sin(TAU * 0.25) - 1.0).abs() < 2e-3);
    assert!((fast_sin(TAU * 0.75) + 1.0).abs() < 2e-3);
    // t 正好落在折点 0.5：走 else 分支，u = π、p = u(PI - u) = 0 → 结果是 0
    assert!(fast_sin(0.5 * TAU).abs() < 2e-3, "折点处应当是 0");
}

// ---------------------------------------------------------- 内存入口

#[test]
fn alloc_and_dealloc_round_trip() {
    let _g = setup();
    let p = alloc(16);
    assert!(!p.is_null());
    let payload = [7u8, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    unsafe { core::slice::from_raw_parts_mut(p, 16).copy_from_slice(&payload) };
    assert_eq!(unsafe { core::slice::from_raw_parts(p, 16) }, &payload[..]);
    dealloc(p, 16);
    // 0 长度也要能申请 / 归还，空指针直接忽略
    let z = alloc(0);
    dealloc(z, 0);
    dealloc(core::ptr::null_mut(), 4);
}

// ---------------------------------------------------------- 采样

#[test]
fn count_opaque_honours_step_and_the_alpha_threshold() {
    let _g = setup();
    let src = src_img(8, 8, opaque_every_third_col); // x = 0 / 3 / 6 → 每行 3 个
    assert_eq!(count_opaque(&src, 8, 8, 1), 8 * 3);
    assert_eq!(count_opaque(&src, 8, 8, 2), 4 * 2); // x = 0 / 2 / 4 / 6 → 只中 0 和 6
    assert_eq!(count_opaque(&src, 8, 8, 3), 3 * 3);
    assert_eq!(count_opaque(&src, 8, 8, 8), 1); // 只扫到 (0, 0)
    assert_eq!(count_opaque(&src, 8, 8, 100), 1);
    assert_eq!(count_opaque(&src_img(8, 8, opaque_none), 8, 8, 1), 0);

    // alpha 阈值是 > 128：128 不算、129 算
    let mut edge = vec![0u8; 4 * 4 * 4];
    edge[3] = 128;
    edge[((1 * 4) + 1) * 4 + 3] = 129;
    assert_eq!(count_opaque(&edge, 4, 4, 1), 1);
}

#[test]
fn pick_step_rounds_clamps_and_guards_the_particle_count() {
    let _g = setup();
    let full = src_img(64, 64, opaque_all);
    let empty = src_img(8, 8, opaque_none);

    // scale <= 0：调用方已经算不出密度了 → 直接给最大步长
    assert_eq!(pick_step(&full, 64, 64, 4.0, 0.0, 200_000), MAX_STEP);
    assert_eq!(pick_step(&full, 64, 64, 4.0, -1.0, 200_000), MAX_STEP);
    // 正常：step * scale ≈ pitch
    assert_eq!(pick_step(&full, 64, 64, 4.0, 1.0, 200_000), 4);
    assert_eq!(pick_step(&full, 64, 64, 3.2, 0.8, 200_000), 4);
    // 下夹到 1 / 上夹到 MAX_STEP
    assert_eq!(pick_step(&full, 64, 64, 0.1, 1.0, 200_000), 1);
    assert_eq!(pick_step(&full, 64, 64, 1000.0, 1.0, 200_000), MAX_STEP);
    // NaN 经饱和转换落到 0 → 夹到 1
    assert_eq!(pick_step(&full, 64, 64, f32::NAN, 1.0, 200_000), 1);
    // 安全阀：64×64 全不透明在 step=1 时是 4096 颗，cap 被夹到 200 → 加到 5
    assert_eq!(pick_step(&full, 64, 64, 1.0, 1.0, 1), 5);
    assert_eq!(pick_step(&full, 64, 64, 1.0, 1.0, 200), 5);
    // cap 上界 400k：4096 颗远远不够 → 不触发安全阀
    assert_eq!(pick_step(&full, 64, 64, 1.0, 1.0, 10_000_000), 1);
    // 1000×1000 全不透明：加到 MAX_STEP 也降不到 cap 以下 → 停在 MAX_STEP
    let huge = src_img(1000, 1000, opaque_all);
    assert_eq!(pick_step(&huge, 1000, 1000, 1.0, 1.0, 200), MAX_STEP);
    // 全透明：一颗也没有，step 只由 pitch 决定
    assert_eq!(pick_step(&empty, 8, 8, 4.0, 1.0, 200), 4);
}

#[test]
fn fit_scales_and_centres_without_stretching() {
    let _g = setup();
    // 宽图：宽度先贴边（0.8），高度还剩很多 → 上下留白
    let (s, ox, oy) = fit(100, 100, 200, 10, 0.8, 0.86);
    assert!((s - 0.4).abs() < 1e-6);
    assert!((ox - 10.0).abs() < 1e-4);
    assert!((oy - 48.0).abs() < 1e-4);
    // 高图：这次轮到高度贴边
    let (s, ox, oy) = fit(100, 100, 10, 200, 0.8, 0.86);
    assert!((s - 0.43).abs() < 1e-5);
    assert!((ox - (100.0 - 10.0 * s) / 2.0).abs() < 1e-4);
    assert!((oy - (100.0 - 200.0 * s) / 2.0).abs() < 1e-4);
    // 恰好填满：scale = 1、偏移 0 —— 徽标靠这个和 <img object-fit:contain> 对齐
    assert_eq!(fit(40, 24, 40, 24, 1.0, 1.0), (1.0, 0.0, 0.0));
}

// ---------------------------------------------------------- build

#[test]
fn build_rejects_invalid_arguments_and_keeps_the_previous_engine() {
    let _g = setup();
    let src = src_img(8, 8, opaque_all);
    let p = src.as_ptr();
    let ok = |ptr: *const u8, sw: u32, sh: u32, cw: u32, ch: u32| {
        build(ptr, sw, sh, cw, ch, 4.0, 1.0, 1.0, 1.0, 200_000, 2)
    };
    assert_eq!(ok(core::ptr::null(), 8, 8, 8, 8), -1);
    assert_eq!(ok(p, 0, 8, 8, 8), -1);
    assert_eq!(ok(p, 8, 0, 8, 8), -1);
    assert_eq!(ok(p, 8, 8, 0, 8), -1);
    assert_eq!(ok(p, 8, 8, 8, 0), -1);
    assert!(eng().is_none(), "非法参数不应当建出引擎");

    assert_eq!(ok(p, 8, 8, 8, 8), 0);
    assert_eq!(fb_width(), 8);
    // 已经建好之后再传非法参数：返回 -1，但旧引擎原封不动
    assert_eq!(ok(core::ptr::null(), 8, 8, 8, 8), -1);
    assert_eq!(ok(p, 0, 0, 0, 0), -1);
    assert_eq!(fb_width(), 8);
    assert!(eng().is_some());
}

#[test]
fn build_packs_rgba_and_targets_the_scaled_position() {
    let _g = setup();
    let mut src = vec![0u8; 4 * 4 * 4];
    // 只有 (1, 2) 不透明：ox = oy = 0、scale = 1 → 应当落在设备像素 (1, 2)
    let i = ((2 * 4) + 1) * 4;
    src[i] = 0x11;
    src[i + 1] = 0x22;
    src[i + 2] = 0x33;
    src[i + 3] = 255;
    assert_eq!(
        build(src.as_ptr(), 4, 4, 4, 4, 1.0, 1.0, 1.0, 1.0, 200_000, 2),
        0
    );
    assert_eq!(particle_count(), 1);
    assert_eq!(sample_step(), 1);
    assert_eq!(particle_size(), 2); // ceil(1.0) + round(1.0)
    assert_eq!(fb_len(), 4 * 4 * 4);
    assert!(!fb_ptr().is_null());
    {
        let e = engine();
        assert_eq!(e.n, 1);
        assert_eq!(e.tx[0], 1.0);
        assert_eq!(e.ty[0], 2.0);
        // 起始位置撒在画布外 → 飞入；距离是随机的，但基本不会正好为 0
        assert_ne!(e.px[0], 1.0, "x 方向不该正好落在目标上");
        assert_ne!(e.py[0], 2.0, "y 方向不该正好落在目标上");
        // 打包顺序：小端内存布局 = [r, g, b, a]
        assert_eq!(e.col[0].to_le_bytes(), [0x11, 0x22, 0x33, 0xff]);
    }
    settle();
    let fb = engine().fb.clone();
    let at = |x: usize, y: usize| -> [u8; 4] {
        let o = (y * 4 + x) * 4;
        [fb[o], fb[o + 1], fb[o + 2], fb[o + 3]]
    };
    // 中心 (1, 2)、边长 2 → half = 1 → 覆盖 (0..2, 1..3)
    assert_eq!(at(0, 1), [0x11, 0x22, 0x33, 0xff]);
    assert_eq!(at(1, 2), [0x11, 0x22, 0x33, 0xff]);
    assert_eq!(at(3, 3), [0, 0, 0, 0]);
    assert_eq!(
        fb.iter().filter(|b| **b != 0).count(),
        4 * 4,
        "2×2 像素 × 4 通道"
    );
}

#[test]
fn build_uses_the_same_alpha_threshold_as_count_opaque() {
    let _g = setup();
    let mut src = vec![0u8; 4 * 4 * 4];
    src[3] = 128; // (0,0)：128 不算
    src[((1 * 4) + 1) * 4 + 3] = 129; // (1,1)：129 算
    assert_eq!(
        build(src.as_ptr(), 4, 4, 4, 4, 1.0, 1.0, 1.0, 1.0, 200_000, 2),
        0
    );
    assert_eq!(particle_count(), 1);
    let e = engine();
    assert_eq!(e.tx[0], 1.0);
    assert_eq!(e.ty[0], 1.0);
}

#[test]
fn build_size_modes_pick_the_documented_particle_edge() {
    let _g = setup();
    // spacing = 3.2（非整数），ratio = 1.0
    assert_eq!(build_250(0, 1.0), 0);
    assert_eq!(sample_step(), 4);
    assert_eq!(particle_count(), 63 * 63);
    assert_eq!(particle_size(), 3); // floor(3.2)：留缝模式
    assert_eq!(build_250(1, 1.0), 0);
    assert_eq!(particle_size(), 3); // round(3.2)
    assert_eq!(build_250(2, 1.0), 0);
    assert_eq!(particle_size(), 5); // ceil(3.2) + round(1.0)：无缝模式
    assert_eq!(build_250(9, 1.0), 0); // 未知模式 → 落到无缝分支
    assert_eq!(particle_size(), 5);
    // mode 2 下 ratio 的含义是「额外出血量（设备像素）」
    assert_eq!(build_250(1, 1.5), 0);
    assert_eq!(particle_size(), 5); // round(4.8)
    assert_eq!(build_250(2, 1.8), 0);
    assert_eq!(particle_size(), 6); // ceil(3.2) + round(1.8)
    assert_eq!(build_250(2, 0.0), 0);
    assert_eq!(particle_size(), 4); // 出血量 0 → 只保证相接
    assert_eq!(build_250(0, 0.01), 0);
    assert_eq!(particle_size(), 1); // floor(0.032) → 至少 1
    assert_eq!(build_250(1, 100.0), 0);
    assert_eq!(particle_size(), 64); // 上夹到 64
}

#[test]
fn build_with_no_opaque_pixels_makes_an_empty_but_usable_engine() {
    let _g = setup();
    let src = src_img(8, 8, opaque_none);
    assert_eq!(
        build(src.as_ptr(), 8, 8, 8, 8, 4.0, 1.0, 1.0, 1.0, 200_000, 2),
        0
    );
    assert_eq!(particle_count(), 0);
    assert_eq!(fb_len(), 8 * 8 * 4);
    assert!(!fb_ptr().is_null());
    assert_eq!(max_offset(), 0.0);
    assert_eq!(burst(4.0, 4.0, 100.0, 5.0), 0); // 半径内没有粒子
    assert_eq!(tick(), 0);
    settle();
    assert!(engine().fb.iter().all(|b| *b == 0));
    // n = 0 时相位表长度也是 0，两个 idle 通道都不应当炸
    assert_eq!(float_on(0.4, 300.0), 1);
    assert_eq!(tick(), 1);
    assert_eq!(float_off(), 1);
    assert_eq!(ripple_on(2.0, 2.0, 80.0, 240.0, 1), 1);
    assert_eq!(tick(), 1);
    assert_eq!(ripple_off(), 1);
}

// ---------------------------------------------------------- 光栅化与静止

#[test]
fn settle_puts_everything_on_target_and_renders() {
    let _g = setup();
    build_demo(2);
    assert!(max_offset() > 0.0, "刚建好时粒子应当撒在画布外（飞入初态）");
    settle();
    assert_eq!(max_offset(), 0.0);
    {
        let e = engine();
        assert!(e.vx.iter().all(|v| *v == 0.0));
        assert!(e.vy.iter().all(|v| *v == 0.0));
        assert!(e.fb.iter().any(|b| *b != 0), "settle 应当顺手渲染一帧");
    }
    assert_eq!(tick(), 0, "静止成品帧不该再报“还在动”");
}

#[test]
fn spring_converges_and_tick_reports_the_still_frame() {
    let _g = setup();
    build_demo(2);
    {
        let e = engine();
        for i in 0..e.n {
            e.px[i] = e.tx[i] + 12.0;
            e.py[i] = e.ty[i] - 7.0;
        }
    }
    assert!((max_offset() - 13.892_444).abs() < 1e-3, "(12² + 7²)^0.5");
    let frames = run_until_still();
    assert!(frames > 1, "至少要真的积几帧");
    assert!(frames < 40, "阻尼 0.86 不该积上百帧");
    // 停止判据只看速度，而阻尼振子的速度每 ~7 帧过一次零点：第一个过零点就会
    // 报静止，此时位置还剩初始偏移的 ~40%（实测 5.63 / 13.89）—— 这是引擎
    // 的口径（飞入动效由前端自己的计时器兜底），不是这个循环在收敛
    let residual = max_offset();
    assert!(
        residual > 0.0 && residual < 13.892_444 * 0.5,
        "残余 {residual} 应当至少缩掉一半"
    );
    // 而且报 0 并不「粘住」：过了过零点速度又爬回阈值以上（实测下一帧就是 1）
    assert_eq!(tick(), 1, "这个 0 只是「当帧够安静」");
    // 想把位置真的对齐，得显式 settle()
    settle();
    assert_eq!(max_offset(), 0.0);
    assert_eq!(tick(), 0, "对齐之后才是真的静止帧");
    assert!(engine().fb.iter().any(|b| *b != 0));
}

#[test]
fn tick_uses_a_velocity_threshold_to_report_stillness() {
    let _g = setup();
    build_demo(2);
    settle();
    assert_eq!(tick(), 0);
    // 0.04 × 0.86 = 0.0344 < 0.05 → 算静止
    engine().vx[0] = 0.04;
    assert_eq!(tick(), 0);
    // 0.1 × 0.86 = 0.086 > 0.05 → 还在动
    engine().vx[0] = 0.1;
    assert_eq!(tick(), 1);
}

#[test]
fn rasterize_clips_blocks_that_hang_over_the_canvas_edges() {
    let _g = setup();
    build_demo(2); // size = ceil(4) + round(1) = 5 → half = 2
    {
        let e = engine();
        assert_eq!(e.size, 5);
        e.px[0] = 1.0;
        e.py[0] = 1.0; // 左上角出血：x0 = -1
        e.px[1] = 39.0;
        e.py[1] = 39.0; // 右下角出血：x0 + size = 42 > 40
        e.px[2] = -50.0;
        e.py[2] = -50.0; // 整块在画布外侧（yy < 0 提前跳过）
        e.px[3] = 1e6;
        e.py[3] = 1e6; // 另一侧（yy >= h 提前跳过）
        for i in 4..e.n {
            e.px[i] = -1e6;
            e.py[i] = -1e6; // 其余全部藏起来，断言才干净
        }
        e.rasterize();
        let fb = e.fb.clone();
        let at = |x: usize, y: usize| -> [u8; 4] {
            let o = (y * 40 + x) * 4;
            [fb[o], fb[o + 1], fb[o + 2], fb[o + 3]]
        };
        // 粒子 0 来自源图 (0, 0) → 颜色 (0, 0, 0x33)
        assert_eq!(at(0, 0), [0, 0, 0x33, 0xff]);
        assert_eq!(at(3, 3), [0, 0, 0x33, 0xff], "可见部分一直画到 (3, 3)");
        assert_eq!(at(4, 4), [0, 0, 0, 0], "越界部分必须被裁掉");
        // 粒子 1 来自源图 (4, 0) → 颜色 (4, 0, 0x33)
        assert_eq!(at(39, 39), [4, 0, 0x33, 0xff]);
        assert_eq!(at(36, 36), [0, 0, 0, 0]);
        // 数「不透明像素」的个数：颜色里的 g 通道常常是 0，按非零字节数会数错
        let painted = (0..fb.len() / 4).filter(|i| fb[i * 4 + 3] != 0).count();
        assert_eq!(painted, 4 * 4 + 3 * 3, "只剩两块：4×4 与 3×3");
    }
}

#[test]
fn rasterize_and_tick_tolerate_an_unbuilt_offset_table() {
    let _g = setup();
    build_demo(2);
    settle();
    let base = engine().fb.clone();
    assert!(base.iter().any(|b| *b != 0));
    {
        let e = engine();
        assert_eq!(
            e.fx.len(),
            0,
            "make() 不建相位表 —— 开关由 float_on / ripple_on 负责"
        );
    }
    // f_amp > 0 但相位表是空的：光栅化不能去索引它（索引就会 panic）
    {
        let e = engine();
        e.f_amp = 1.0;
        e.rasterize();
        assert_eq!(e.fb, base, "没有相位表时应当退回无位移路径");
    }
    assert_eq!(tick(), 0, "floating 判据里 fx.len() != n → 不做漂浮积分");
    // 水波同理
    {
        let e = engine();
        e.f_amp = 0.0;
        e.w_amp_x = 1.0;
        e.rasterize();
        assert_eq!(e.fb, base);
    }
    assert_eq!(tick(), 0, "rippling 判据同理");
}

// ---------------------------------------------------------- 交互力

#[test]
fn burst_rejects_bad_arguments_and_a_missing_engine() {
    let _g = setup();
    assert_eq!(burst(1.0, 1.0, 10.0, 1.0), 0, "没有引擎");
    build_demo(2);
    settle();
    assert_eq!(burst(20.0, 20.0, 0.0, 5.0), 0, "半径 0");
    assert_eq!(burst(20.0, 20.0, -5.0, 5.0), 0, "负半径");
    assert_eq!(burst(20.0, 20.0, f32::NAN, 5.0), 0, "半径 NaN");
    assert_eq!(burst(20.0, 20.0, 10.0, f32::NAN), 0, "冲量 NaN");
    assert_eq!(burst(20.0, 20.0, 10.0, f32::INFINITY), 0, "冲量 ∞");
    assert_eq!(max_offset(), 0.0, "一次都没生效");
    assert_eq!(tick(), 0);
}

#[test]
fn burst_pushes_exactly_the_particles_inside_the_radius() {
    let _g = setup();
    build_demo(2);
    settle();
    let all = particle_count() as i32;
    let hit = burst(20.0, 20.0, 10.0, 8.0);
    assert_eq!(hit, 21, "(20, 20) 半径 10 内的格点是 21 颗");
    assert!(hit < all);
    {
        let e = engine();
        for i in 0..e.n {
            let dx = e.px[i] - 20.0;
            let dy = e.py[i] - 20.0;
            let moved = e.vx[i] != 0.0 || e.vy[i] != 0.0;
            // 正中那颗 dx / d = 0 / 0.001 = 0 → 方向退化，半径内也不受力
            let degenerate = dx == 0.0 && dy == 0.0;
            assert_eq!(
                moved,
                dx * dx + dy * dy <= 100.0 && !degenerate,
                "粒子 {i} 的受力范围不对"
            );
        }
    }
    assert!(max_offset() > 0.0 || particle_count() > 0);
    // 冲量只写速度，减速回位交给弹簧
    let mut frames = 0;
    while tick() != 0 {
        frames += 1;
        assert!(frames < 2000, "冲量之后应当收敛回静止");
    }
    assert!(max_offset() < 1.0, "冲量衰减完只剩亚像素残余");

    // 半径盖住全场 → 每颗粒子都被推；远处爆散 → 一颗都不碰
    settle();
    assert_eq!(burst(20.0, 20.0, 1000.0, 8.0), all);
    settle();
    assert_eq!(burst(1_000_000.0, 1_000_000.0, 10.0, 8.0), 0);
}

#[test]
fn burst_at_a_particles_exact_position_does_not_produce_nan() {
    let _g = setup();
    build_demo(2);
    {
        let e = engine();
        for i in 0..e.n {
            e.px[i] = 10.0;
            e.py[i] = 10.0;
        }
    }
    assert_eq!(burst(10.0, 10.0, 50.0, 5.0), 100);
    {
        let e = engine();
        for i in 0..e.n {
            // dx / d = 0 / 0.001 = 0 → 方向分量没了，但方向向量退化也不能出 NaN
            assert_eq!(e.vx[i], 0.0);
            assert_eq!(e.vy[i], 0.0);
        }
    }
    assert!(max_offset().is_finite());
    // 冲量全被吃掉，但位置还停在 (10, 10)：偏移是「回到各自格点」的距离，
    // 最远那颗（格点 (36, 36)）≈ 36.8
    let initial = max_offset();
    assert!(initial > 30.0 && initial < 40.0, "偏移 {initial}");
    // 弹簧不看速度表，照样把它们一路拉回格点，全程不能出 NaN
    let frames = run_until_still();
    assert!(frames > 1);
    for i in 0..engine().n {
        let e = engine();
        assert!(e.px[i].is_finite() && e.py[i].is_finite());
        assert!(e.vx[i].is_finite() && e.vy[i].is_finite());
    }
    let shrunk = max_offset();
    assert!(shrunk < initial * 0.6, "至少缩掉 40%：{shrunk}");
    assert!(engine().fb.iter().any(|b| *b != 0), "该渲染出了一帧");
}

// ---------------------------------------------------------- 常驻漂浮

#[test]
fn float_on_validates_clamps_and_steals_the_offset_arrays() {
    let _g = setup();
    build_demo(2);
    // 非法幅值一律关掉漂浮并返回 0
    for amp in [0.0f32, -1.0, f32::NAN, f32::INFINITY] {
        assert_eq!(float_on(amp, 300.0), 0, "amp = {amp} 应当被拒");
        assert_eq!(engine().f_amp, 0.0);
    }
    // 非法周期同理
    for period in [0.0f32, -1.0, f32::NAN, f32::INFINITY] {
        assert_eq!(float_on(0.4, period), 0, "period = {period} 应当被拒");
        assert_eq!(engine().f_amp, 0.0);
    }
    // 周期下夹到 30 帧、上夹到 100000 帧
    assert_eq!(float_on(0.4, 1.0), 1);
    assert_eq!(engine().f_wx, TAU / 30.0);
    assert_eq!(engine().f_wy, TAU / (30.0 * 1.37));
    assert_eq!(float_on(0.4, 1e9), 1);
    assert_eq!(engine().f_wx, TAU / 100_000.0);
    assert_eq!(engine().f_wy, TAU / (100_000.0 * 1.37));
    // 相位表按 n 建好，初值落在半径 a 的圆上
    {
        let e = engine();
        assert_eq!(e.fx.len(), e.n);
        assert_eq!(e.fy.len(), e.n);
        assert_eq!(e.fvx.len(), e.n);
        assert_eq!(e.fvy.len(), e.n);
        let amp = e.f_amp;
        assert_eq!(amp, 0.4);
        for i in 0..e.n {
            // 振幅 0.55a–1.0a 随机
            assert!(e.fx[i].abs() > 0.0 && e.fx[i].abs() <= amp);
            assert!(e.fy[i].abs() > 0.0 && e.fy[i].abs() <= amp);
        }
    }
    // 打开漂浮会顺手关掉水波（两者共用 fx/fy，只能开一个）
    assert_eq!(ripple_on(2.0, 2.0, 80.0, 240.0, 0), 1);
    assert_eq!(float_on(0.4, 300.0), 1);
    {
        let e = engine();
        assert_eq!(e.w_amp_x, 0.0);
        assert_eq!(e.w_amp_y, 0.0);
        assert_eq!(e.w_mode, 0);
        assert_eq!(e.w_phase, 0.0);
        assert!(e.f_amp > 0.0);
    }
}

#[test]
fn float_stays_bounded_and_actually_moves_pixels() {
    let _g = setup();
    build_demo(2);
    settle();
    // 幅值必须 > 0.5：rasterize 把 (px + ox).round() 量化到整数像素，
    // 亚像素偏移在整格坐标上恒等，framebuffer 一个字节都不会变
    assert_eq!(float_on(2.0, 300.0), 1);
    let before = engine().fb.clone();
    for _ in 0..200 {
        assert_eq!(tick(), 1, "漂浮开着就永远是“还在动”");
    }
    assert_ne!(engine().fb, before, "漂浮应当真的挪动了像素");
    assert_eq!(max_offset(), 0.0, "漂浮只动偏移量，不碰 px/py");
    // 简谐积分（半隐式欧拉）不能发散
    {
        let e = engine();
        let amp = e.f_amp;
        for i in 0..e.n {
            let (dx, dy) = (e.fx[i], e.fy[i]);
            assert!(dx.abs() <= amp * 1.01, "x 振幅漂了：{dx}");
            assert!(dy.abs() <= amp * 1.01, "y 振幅漂了：{dy}");
        }
        assert!(e.fx.iter().any(|v| *v != 0.0));
    }
    assert_eq!(float_off(), 1);
    assert_eq!(engine().f_amp, 0.0);
    assert_eq!(tick(), 0, "关掉之后回到静止成品帧");
}

// ---------------------------------------------------------- 常驻水波

#[test]
fn ripple_on_validates_clamps_and_maps_modes() {
    let _g = setup();
    build_demo(2);
    for wl in [0.0f32, -1.0, f32::NAN, f32::INFINITY] {
        assert_eq!(
            ripple_on(2.0, 2.0, wl, 240.0, 0),
            0,
            "wavelength = {wl} 应当被拒"
        );
        assert_eq!(engine().w_amp_x, 0.0);
        assert_eq!(engine().w_amp_y, 0.0);
    }
    for period in [0.0f32, -1.0, f32::NAN, f32::INFINITY] {
        assert_eq!(
            ripple_on(2.0, 2.0, 80.0, period, 0),
            0,
            "period = {period} 应当被拒"
        );
        assert_eq!(engine().w_amp_x, 0.0);
    }
    // 非有限的振幅被当成 0（其余参数合法时依然算“开启”，只是没有位移）
    assert_eq!(ripple_on(f32::NAN, f32::INFINITY, 80.0, 240.0, 1), 1);
    assert_eq!(engine().w_amp_x, 0.0);
    assert_eq!(engine().w_amp_y, 0.0);

    assert_eq!(ripple_on(2.0, 1.0, 80.0, 240.0, 0), 1);
    {
        let e = engine();
        assert_eq!(e.w_k, TAU / 80.0);
        assert_eq!(e.w_w, TAU / 240.0);
        assert_eq!(e.w_amp_x, 2.0);
        assert_eq!(e.w_amp_y, 1.0);
        assert_eq!(e.w_mode, 0);
        assert_eq!(e.w_phase, 0.0);
        assert_eq!(e.f_amp, 0.0, "与漂浮互斥，先把它关掉");
        assert_eq!(e.fx.len(), e.n, "偏移数组与漂浮共用，得按 n 备好");
    }
    // 周期夹到 [30, 100000]
    assert_eq!(ripple_on(2.0, 1.0, 80.0, 1.0, 0), 1);
    assert_eq!(engine().w_w, TAU / 30.0);
    assert_eq!(ripple_on(2.0, 1.0, 80.0, 1e9, 0), 1);
    assert_eq!(engine().w_w, TAU / 100_000.0);
    // 未知 mode：w_mode 原样存下，tick 里走 match 的 _ 臂（径向涟漪）
    assert_eq!(ripple_on(2.0, 2.0, 80.0, 240.0, 7), 1);
    assert_eq!(engine().w_mode, 7);
    assert_eq!(tick(), 1);
}

#[test]
fn ripple_shear_keeps_every_row_rigid() {
    let _g = setup();
    build_demo(2);
    settle();
    assert_eq!(ripple_on(5.0, 0.0, 200.0, 240.0, 0), 1);
    assert_eq!(tick(), 1);
    let e = engine();
    let mut pairs = 0;
    for i in 0..e.n {
        for j in (i + 1)..e.n {
            if e.py[i] == e.py[j] {
                // 位移只取决于 y ⇒ 同一行整体平移 ⇒ 行距分毫不变 ⇒ 不可能裂缝
                assert_eq!(e.fx[i], e.fx[j], "同行粒子 {i} / {j} 的位移必须一致");
                pairs += 1;
            }
        }
    }
    assert!(pairs > 0, "至少要有一对同行粒子");
    assert!(e.fx.iter().any(|v| *v != 0.0), "剪切波应当真的位移了");
    assert!(
        e.fy.iter().all(|v| *v == 0.0),
        "amp_y = 0 时纵向位移必须为零"
    );
    assert!(e.fx.iter().all(|v| v.abs() <= 5.0 * 1.45 + 1e-3));
}

#[test]
fn ripple_radial_mode_pushes_outwards_and_survives_a_zero_radius() {
    let _g = setup();
    build_demo(2);
    settle();
    assert_eq!(ripple_on(6.0, 6.0, 200.0, 240.0, 1), 1);
    {
        let e = engine();
        let (cx, cy) = (e.fb_w as f32 * 0.5, e.fb_h as f32 * 0.5);
        e.px[0] = cx;
        e.py[0] = cy; // 正好落在中心 → 触发 r.max(1.0) 的兜底
                      // 目标点也要搬过去：tick 里弹簧先跑，起点和目标不一致的话
                      // 第一帧就把 px 拉走，dx 不再是 0，这条兜底就测不到了
        e.tx[0] = cx;
        e.ty[0] = cy;
        e.px[1] = 1.0;
        e.py[1] = 1.0;
    }
    assert_eq!(tick(), 1);
    let e = engine();
    assert_eq!(e.fx[0], 0.0, "dx = 0 → 方向分量 0");
    assert_eq!(e.fy[0], 0.0);
    assert!(
        e.fx[1].abs() > 0.0 && e.fy[1].abs() > 0.0,
        "左上角的粒子应当被向外推"
    );
    assert!(e.fx[1] < 0.0 && e.fy[1] < 0.0, "“向外” = 远离画布中心");
    for i in 0..e.n {
        assert!(
            e.fx[i].is_finite() && e.fy[i].is_finite(),
            "粒子 {i} 出 NaN 了"
        );
        assert!(e.fx[i].abs() <= 6.0 * 1.45 + 1e-3);
        assert!(e.fy[i].abs() <= 6.0 * 1.45 + 1e-3);
    }
}

#[test]
fn ripple_phase_wraps_inside_one_turn() {
    let _g = setup();
    build_demo(2);
    assert_eq!(ripple_on(2.0, 0.0, 80.0, 240.0, 0), 1);
    engine().w_phase = TAU - 1e-4;
    assert_eq!(tick(), 1);
    let phase = engine().w_phase;
    assert!(
        (0.0..TAU).contains(&phase),
        "相位应当折回 [0, TAU)：{phase}"
    );
    assert!(phase < 1.0, "折回之后只剩一点尾巴：{phase}");
    for _ in 0..500 {
        tick();
        let p = engine().w_phase;
        assert!((0.0..TAU).contains(&p), "相位跑飞了：{p}");
    }
}

#[test]
fn float_and_ripple_are_mutually_exclusive_and_reversible() {
    let _g = setup();
    build_demo(2);
    settle();
    assert_eq!(float_on(0.4, 300.0), 1);
    assert_eq!(engine().fx.len(), 100);
    // 切到水波：相位表内容被清掉、长度留着（免得 resize 之后重新分配）
    assert_eq!(ripple_on(2.0, 2.0, 80.0, 240.0, 1), 1);
    {
        let e = engine();
        assert_eq!(e.w_amp_x, 2.0);
        assert_eq!(e.f_amp, 0.0);
        assert_eq!(e.fx.len(), 100);
        // 数组留着（免得 window resize 之后重新分配）、内容不保证立刻清掉：
        // init_ripple 的开启分支只备好数组，残留的漂浮相位由下一帧 tick 全量覆盖
    }
    assert_eq!(tick(), 1);
    assert!(
        engine().fx.iter().any(|v| *v != 0.0),
        "tick 会把位移场算出来"
    );
    // 关掉水波：回到静止，数组长度不变（下一次打开走「不重新分配」那条路）
    assert_eq!(ripple_off(), 1);
    {
        let e = engine();
        assert_eq!(e.w_amp_x, 0.0);
        assert_eq!(e.w_amp_y, 0.0);
        assert_eq!(e.w_phase, 0.0);
        assert_eq!(e.fx.len(), 100);
        assert!(e.fx.iter().all(|v| *v == 0.0));
    }
    assert_eq!(tick(), 0);
    assert_eq!(ripple_on(2.0, 2.0, 80.0, 240.0, 1), 1);
    assert_eq!(engine().fx.len(), 100);
    assert_eq!(ripple_off(), 1);
    assert_eq!(float_on(0.4, 300.0), 1);
    assert_eq!(float_off(), 1);
    assert_eq!(tick(), 0);
}

// ---------------------------------------------------------- resize

#[test]
fn resize_relayouts_on_the_new_canvas_and_rejects_bad_sizes() {
    let _g = setup();
    build_demo(2);
    assert_eq!(resize(0, 40, 4.0), -1);
    assert_eq!(resize(40, 0, 4.0), -1);
    assert_eq!(fb_width(), 40, "非法尺寸不得动引擎");
    assert_eq!(resize(80, 80, 4.0), 0);
    assert_eq!(fb_width(), 80);
    assert_eq!(fb_height(), 80);
    assert_eq!(fb_len(), 80 * 80 * 4);
    // scale = 2 → step = round(4 / 2) = 2 → 20×20 颗粒子
    assert_eq!(sample_step(), 2);
    assert_eq!(particle_count(), 400);
    assert_eq!(particle_size(), 5); // spacing 4 → ceil(4) + round(1)
    assert!(max_offset() > 0.0, "重建之后同样是飞入初态");
    assert_eq!(tick(), 1);
}

#[test]
fn resize_keeps_the_idle_animation_settings() {
    let _g = setup();
    build_demo(2);
    assert_eq!(float_on(0.4, 300.0), 1);
    let (wx, wy) = {
        let e = engine();
        (e.f_wx, e.f_wy)
    };
    assert_eq!(resize(80, 80, 4.0), 0);
    {
        let e = engine();
        assert_eq!(e.f_amp, 0.4, "一次窗口缩放不该把漂浮静默关掉");
        assert_eq!(e.f_wx, wx);
        assert_eq!(e.f_wy, wy);
        assert_eq!(e.fx.len(), e.n);
        // resize 里先 init_ripple（会清空 fx/fy）再 init_float（重填相位表）
        // —— 顺序反了漂浮就没了
        assert!(e.fx.iter().any(|v| *v != 0.0), "漂浮相位表应当被重建");
    }
    assert_eq!(tick(), 1);

    // 水波同理：振幅 / 波长 / 周期 / 模式都得活过一次 resize
    assert_eq!(ripple_on(2.0, 1.0, 80.0, 240.0, 0), 1);
    assert_eq!(resize(64, 64, 4.0), 0);
    {
        let e = engine();
        assert_eq!(e.w_amp_x, 2.0);
        assert_eq!(e.w_amp_y, 1.0);
        assert_eq!(e.w_k, TAU / 80.0);
        assert_eq!(e.w_w, TAU / 240.0);
        assert_eq!(e.w_mode, 0);
        assert_eq!(e.f_amp, 0.0, "ripple_on 已经把漂浮关掉了");
        assert!(e.fx.iter().all(|v| *v == 0.0), "等下一帧 tick 重算位移场");
        assert_eq!(e.fx.len(), e.n);
    }
    assert_eq!(tick(), 1);
    assert!(engine().fx.iter().any(|v| *v != 0.0));
}

// ---------------------------------------------------------- 显现闸门（首次入场）

#[test]
fn hash01_is_stable_spread_and_within_the_unit_interval() {
    let _g = setup();
    let a: Vec<f32> = (0..256).map(hash01).collect();
    assert!(a.iter().all(|v| (0.0..1.0).contains(v)), "hash01 越界");
    // 逐帧稳定：同一索引必须每次得到同一个值，否则波前边缘会「沸腾」
    let b: Vec<f32> = (0..256).map(hash01).collect();
    assert_eq!(a, b);
    // 分布不塌缩到一小段（否则抖动就退化成常数、又变回刀切直线）
    assert!(a.iter().any(|v| *v < 0.25) && a.iter().any(|v| *v > 0.75));
    // 相邻索引不应退化成同一个值（同一行的粒子要能分出先后）
    assert!(a.windows(2).filter(|w| w[0] != w[1]).count() > 200);
}

/// 读 framebuffer 某个设备像素的 alpha（没被任何粒子画到的地方是 0）
fn alpha_at(x: u32, y: u32) -> u8 {
    let i = ((y as usize) * fb_width() as usize + x as usize) * 4 + 3;
    assert!(i < fb_len() as usize, "读越界：({x}, {y})");
    unsafe { *fb_ptr().add(i) }
}

#[test]
fn wipe_on_validates_and_lifts_every_particle_above_its_target() {
    let _g = setup();
    build_demo(2);
    // 非法 drop / frames 一律拒绝并清掉闸门（drop = 0 是合法的：纯逐行显现）
    for drop in [-1.0f32, f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        assert_eq!(wipe_on(drop, 100.0, 4.0), 0, "drop = {drop} 应当被拒");
        assert_eq!(engine().wipe_gate, 0);
        assert_eq!(engine().wipe_step, 0.0);
        assert_eq!(engine().wipe_front, 0.0);
    }
    for frames in [0.0f32, -1.0, f32::NAN, f32::INFINITY] {
        assert_eq!(wipe_on(20.0, frames, 4.0), 0, "frames = {frames} 应当被拒");
        assert_eq!(engine().wipe_gate, 0);
    }
    // band 非法只是退化成 0（和 float_on 的 clamp 一样，不拒绝整个调用）
    assert_eq!(wipe_on(20.0, 50.0, f32::NAN), 1);
    assert_eq!(engine().wipe_band, 0.0);
    // 合法参数：全部悬在目标位**上方** drop、x 一分不差、速度归零、
    // 波前从画布上缘之上出发，一步走 (fb_h + 2·band) / frames
    assert_eq!(wipe_on(20.0, 50.0, 6.0), 1);
    {
        let e = engine();
        assert_eq!(e.wipe_drop, 20.0);
        assert_eq!(e.wipe_band, 6.0);
        assert_eq!(e.wipe_front, -6.0);
        assert_eq!(e.wipe_step, (40.0 + 12.0) / 50.0);
        for i in 0..e.n {
            assert_eq!(e.px[i], e.tx[i], "闸门期 x 必须完全一致（只沿 y 平移）");
            assert_eq!(e.py[i], e.ty[i] - 20.0);
            assert_eq!(e.vx[i], 0.0);
            assert_eq!(e.vy[i], 0.0);
        }
    }
    // wipe_off 只解闸门，不一并动粒子
    let py: Vec<f32> = engine().py.clone();
    assert_eq!(wipe_off(), 1);
    assert_eq!(engine().wipe_gate, 0);
    assert_eq!(engine().wipe_step, 0.0);
    assert_eq!(engine().wipe_front, 0.0);
    assert_eq!(engine().py, py);
    // drop = 0：粒子原地待命，等波前扫到才「长出来」
    assert_eq!(wipe_on(0.0, 50.0, 6.0), 1);
    {
        let e = engine();
        assert_eq!(e.wipe_drop, 0.0);
        assert_eq!(e.px, e.tx);
        assert_eq!(e.py, e.ty);
    }
    // settle 的语义是「立刻给我成品帧」：闸门一并解除、粒子回目标位
    assert_eq!(wipe_on(20.0, 50.0, 6.0), 1);
    settle();
    {
        let e = engine();
        assert_eq!(e.wipe_gate, 0);
        assert_eq!(e.wipe_step, 0.0);
        assert_eq!(e.wipe_front, 0.0);
        assert_eq!(max_offset(), 0.0);
        assert_eq!(e.px, e.tx);
        assert_eq!(e.py, e.ty);
    }
    // resize 重建引擎 → 闸门自动关（拖窗口不会重放整段入场）
    assert_eq!(wipe_on(20.0, 50.0, 6.0), 1);
    assert_eq!(resize(40, 40, 4.0), 0);
    assert_eq!(engine().wipe_gate, 0);
}

#[test]
fn wipe_gate_freezes_the_unreached_layers_and_keeps_tick_reporting_motion() {
    let _g = setup();
    build_demo(2); // 40×40 画布、step 4 → 10×10 颗，ty ∈ {0, 4, …, 36}
    // 抖动带 6 ⇒ 波前从 -6 出发；frames 很大 ⇒ 一步只有 0.13 px
    assert_eq!(wipe_on(10.0, 400.0, 6.0), 1);
    let start: Vec<f32> = engine().py.clone();
    // 第一帧：波前才走到 -5.87，连最上面的放行阈值（≥ -3）都没碰到 ——
    // 一个粒子都没轮到、max_v = 0，但 tick() 必须报「还在动」，否则 JS 会立刻
    // 去放落地那记顿挫，整段入场就废了。这一条就是这个 bug 的回归守卫。
    assert_eq!(tick(), 1);
    {
        let e = engine();
        assert!((e.wipe_front - (-6.0 + 52.0 / 400.0)).abs() < 1e-4);
        for i in 0..e.n {
            assert_eq!(e.py[i], start[i], "第 {i} 颗还没轮到，不该动");
            assert_eq!(e.vy[i], 0.0);
        }
    }
    // 再走一大段：波前越过最上面那几行，它们动了，下面的行仍然原地不动
    for _ in 0..200 {
        assert_eq!(tick(), 1);
    }
    {
        let e = engine();
        let front = e.wipe_front;
        for i in 0..e.n {
            let jitter = (hash01(i) - 0.5) * e.wipe_band;
            if e.ty[i] + jitter > front {
                assert_eq!(e.py[i], start[i], "ty = {} 还没轮到", e.ty[i]);
            } else {
                assert!(e.py[i] > start[i], "ty = {} 应当已经往下走了", e.ty[i]);
            }
        }
    }
    // 扫到底：闸门自己关掉
    for _ in 0..400 {
        let _ = tick();
    }
    {
        let e = engine();
        assert_eq!(e.wipe_gate, 0, "波前扫完应当自关");
        assert_eq!(e.wipe_step, 0.0);
        assert_eq!(e.wipe_front, 0.0);
        for i in 0..e.n {
            assert!(e.py[i] > start[i], "放行之后每一颗都该动了");
        }
    }
    let residual = max_offset();
    assert!(residual < 0.5, "残余偏移应当很小，实际 {residual}");
}

#[test]
fn wipe_reveals_rows_top_down_and_hides_the_ones_not_reached_yet() {
    let _g = setup();
    build_demo(2);
    // 速度 = 40/40 = 1.0 px/帧（band = 0）⇒ ty 那一行恰好在第 ty 帧放行
    // drop = 0：粒子一出现就在最终位置上，所以「动没动」不能当放行判据 ——
    // 这里直接看**画面**（alpha），这正是「逐行渲染」与「整幅已在那儿被挪了
    // 位置」的分水岭。
    assert_eq!(wipe_on(0.0, 40.0, 0.0), 1);
    for _ in 0..20 {
        assert_eq!(tick(), 1);
    }
    // 波前走到 20：ty ≤ 20 的行已经画出来了，下面的行一个像素都没有
    assert_ne!(alpha_at(2, 2), 0, "最上面那一行应当已经画出来了");
    assert_ne!(alpha_at(2, 18), 0, "波前扫过的行都该在");
    assert_eq!(alpha_at(2, 36), 0, "波前还没扫到最下面一行");
    assert_eq!(alpha_at(20, 30), 0, "半路都不该有像素");
    // 扫完之后整幅都在
    for _ in 0..40 {
        let _ = tick();
    }
    assert_ne!(alpha_at(2, 2), 0);
    assert_ne!(alpha_at(2, 36), 0, "扫完之后最下面一行也得在");
}

#[test]
fn wipe_releases_rows_top_down_and_then_the_spring_takes_over() {
    let _g = setup();
    build_demo(2);
    // 速度 = 0.4 + 2·0 / … = 40/40 = 1.0 px/帧（band = 0）⇒ ty 行第 ty 帧放行
    assert_eq!(wipe_on(10.0, 40.0, 0.0), 1);
    let n = engine().n;
    let start: Vec<f32> = engine().py.clone();
    let mut released = vec![usize::MAX; n];
    let mut frames = 0usize;
    loop {
        frames += 1;
        assert!(frames < 2000, "闸门 + 弹簧不收敛");
        let still = tick();
        for i in 0..n {
            if released[i] == usize::MAX && engine().py[i] != start[i] {
                released[i] = frames;
            }
        }
        if still == 0 {
            break;
        }
    }
    {
        let e = engine();
        // 自上而下：目标行越靠上（ty 越小）放行越早，且同一行的粒子同时放行
        // （band = 0 ⇒ 没有抖动）
        for i in 0..n {
            for j in 0..n {
                if e.ty[i] < e.ty[j] {
                    assert!(
                        released[i] <= released[j],
                        "行序与放行顺序不一致：ty {} 在 ty {} 之后放行",
                        e.ty[i],
                        e.ty[j]
                    );
                } else if e.ty[i] == e.ty[j] {
                    assert_eq!(released[i], released[j], "同一行应当同时放行");
                }
            }
        }
        // 最上面一行第 1 帧、最下面一行第 36 帧 —— 正好是 (ty + 1) / 1.0 取整
        assert_eq!(released[0], 1);
        assert_eq!(released[n - 1], 36);
    }
    // 弹簧把最后一层也收回去了（残余远小于 drop）；settle 之后才是真对齐
    let residual = max_offset();
    assert!(residual < 0.5, "残余偏移应当很小，实际 {residual}");
    settle();
    assert_eq!(max_offset(), 0.0);
}

#[test]
fn wipe_band_gives_the_front_a_ragged_edge() {
    let _g = setup();
    build_demo(2);
    assert_eq!(wipe_on(10.0, 40.0, 8.0), 1);
    let n = engine().n;
    let start: Vec<f32> = engine().py.clone();
    let mut released = vec![usize::MAX; n];
    for f in 1..=150 {
        let still = tick();
        for i in 0..n {
            if released[i] == usize::MAX && engine().py[i] != start[i] {
                released[i] = f;
            }
        }
        if still == 0 {
            break;
        }
    }
    {
        let e = engine();
        let first_row = e.ty.iter().cloned().fold(f32::MAX, f32::min);
        let row: Vec<usize> = (0..n).filter(|&i| e.ty[i] == first_row).collect();
        assert!(row.len() > 2);
        assert!(row.iter().all(|&i| released[i] != usize::MAX), "整行都该放行");
        // 抖动让同一行内部也分出先后（±band/2 ⇒ 最多 band/speed = 8 帧的差）
        let first = released[row[0]];
        assert!(row.iter().any(|&i| released[i] != first), "同一行不能整行一起出现");
        let span = row.iter().map(|&i| released[i]).max().unwrap()
            - row.iter().map(|&i| released[i]).min().unwrap();
        assert!(span <= 8, "抖动的跨度不该超过 band / speed，实际 {span}");
    }
}

// ---------------------------------------------------------- 无引擎时的兜底

#[test]
fn every_entry_point_is_safe_without_an_engine() {
    let _g = setup();
    assert!(fb_ptr().is_null());
    assert_eq!(fb_len(), 0);
    assert_eq!(fb_width(), 0);
    assert_eq!(fb_height(), 0);
    assert_eq!(particle_count(), 0);
    assert_eq!(sample_step(), 0);
    assert_eq!(particle_size(), 0);
    assert_eq!(max_offset(), 0.0);
    assert_eq!(tick(), 0);
    assert_eq!(burst(1.0, 1.0, 10.0, 1.0), 0);
    assert_eq!(float_on(0.4, 300.0), 0);
    assert_eq!(float_off(), 0);
    assert_eq!(ripple_on(2.0, 2.0, 80.0, 240.0, 0), 0);
    assert_eq!(ripple_off(), 0);
    assert_eq!(wipe_on(20.0, 50.0, 4.0), 0);
    assert_eq!(wipe_on(-1.0, 50.0, 4.0), 0, "负 drop 也不合法");
    assert_eq!(wipe_off(), 0);
    assert_eq!(resize(64, 64, 4.0), -1);
    settle(); // 只是不能 panic
    assert!(eng().is_none(), "兜底路径不应当顺手建出引擎");
}

#[test]
fn max_offset_reports_the_farthest_particle() {
    let _g = setup();
    build_demo(2);
    settle();
    assert_eq!(max_offset(), 0.0);
    engine().px[7] = engine().tx[7] + 10.0;
    assert!((max_offset() - 10.0).abs() < 1e-4);
    {
        let e = engine();
        e.px[7] = e.tx[7];
        e.py[9] = e.ty[9] + 3.0;
        e.px[9] = e.tx[9] + 4.0;
    }
    assert!((max_offset() - 5.0).abs() < 1e-4, "3-4-5 直角三角形");
}
