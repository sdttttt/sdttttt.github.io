import { describe, test } from 'node:test';
import { formatBytes, ratio } from '../optimize-images.js';
import { expect } from './expect.js';

describe('formatBytes', () => {
  test('小于 1024 显示 B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  test('1024-1MB 显示 KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 - 1)).toMatch(/\d+\.\d KB$/);
  });

  test('>= 1MB 显示 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });
});

describe('ratio', () => {
  test('减小返回 -X (Y%) —— 负号来自 saved 的前缀', () => {
    // 1000 → 500: saved=500, percent=50.0
    expect(ratio(1000, 500)).toBe('-500 B (50.0%)');
  });

  test('变大返回 +X (Y%) —— percent 保留负号', () => {
    // 500 → 1000: saved=-500, percent=-100.0
    expect(ratio(500, 1000)).toBe('+500 B (-100.0%)');
  });

  test('相同大小返回 -0 B (0.0%)', () => {
    // saved=0, saved >= 0 走 "-0 B" 分支
    expect(ratio(1000, 1000)).toBe('-0 B (0.0%)');
  });

  test('大文件用 MB', () => {
    // 5MB → 1MB: saved=4MB, percent=80.0
    expect(ratio(5 * 1024 * 1024, 1 * 1024 * 1024)).toBe('-4.00 MB (80.0%)');
  });

  test('百分比保留 1 位小数', () => {
    // 1000 → 333: saved=667, percent=66.7
    expect(ratio(1000, 333)).toBe('-667 B (66.7%)');
  });
});