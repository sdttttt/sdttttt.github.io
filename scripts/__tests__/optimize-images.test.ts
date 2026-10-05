import { describe, test } from 'node:test';
import { buildPlans } from '../optimize-images.js';
import {
  AVATAR_OUTPUT,
  BG_QUALITY,
  BG_SOURCE_DIR,
  BG_WIDTH,
  planImage,
  SOURCE_EXTENSIONS,
} from '../lib/image-plan.js';
import { expect } from './expect.js';

describe('planImage', () => {
  test('背景图 png 映射到 static/bg 下的 avif', () => {
    const plan = planImage(`${BG_SOURCE_DIR}/F_tZfZBbwAALItU.png`);
    expect(plan).toEqual({
      source: `${BG_SOURCE_DIR}/F_tZfZBbwAALItU.png`,
      output: 'static/bg/F_tZfZBbwAALItU.avif',
      format: 'avif',
      width: BG_WIDTH,
      quality: BG_QUALITY.avif,
    });
  });

  test('--format webp 只换扩展名与质量，宽度不变', () => {
    const plan = planImage(`${BG_SOURCE_DIR}/a.jpg`, 'webp');
    expect(plan?.output).toBe('static/bg/a.webp');
    expect(plan?.format).toBe('webp');
    expect(plan?.width).toBe(BG_WIDTH);
    expect(plan?.quality).toBe(BG_QUALITY.webp);
  });

  test('头像固定输出 static/avatar.webp，且忽略 format 参数', () => {
    const avifWanted = planImage('assets/src/avatar/avatar.jpg', 'avif');
    const webpWanted = planImage('assets/src/avatar/avatar.jpg', 'webp');
    expect(avifWanted?.output).toBe(AVATAR_OUTPUT);
    expect(avifWanted?.format).toBe('webp');
    expect(webpWanted?.output).toBe(AVATAR_OUTPUT);
    expect(webpWanted?.format).toBe('webp');
  });

  test('扩展名大小写与 ./ 前缀都能识别', () => {
    expect(planImage('./assets/src/bg/x.PNG')?.output).toBe('static/bg/x.avif');
  });

  test('未管理的路径返回 null', () => {
    expect(planImage('static/bg/x.png')).toBeNull();
    expect(planImage('assets/src/bg/nested/x.png')).toBeNull();
    expect(planImage(`${BG_SOURCE_DIR}/x.psd`)).toBeNull();
    expect(planImage(`${BG_SOURCE_DIR}/noext`)).toBeNull();
    expect(planImage('x.png')).toBeNull();
  });

  test('输出扩展名白名单与源扩展名不重叠', () => {
    for (const ext of SOURCE_EXTENSIONS) {
      expect(['.avif', '.webp'].includes(ext)).toBe(false);
    }
  });
});

describe('buildPlans', () => {
  test('混合输入时把无法识别的记进 skipped', () => {
    const { plans, skipped } = buildPlans(
      [`${BG_SOURCE_DIR}/a.png`, 'assets/src/misc/readme.txt', `${BG_SOURCE_DIR}/b.jpg`],
      'avif',
    );
    expect(plans.length).toBe(2);
    expect(skipped).toEqual(['assets/src/misc/readme.txt']);
  });
});
