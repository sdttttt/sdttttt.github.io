import { describe, test } from 'node:test';
import { parseArgs, getString, getBoolean, getNumber } from '../lib/args.js';
import { expect } from './expect.js';

describe('parseArgs', () => {
  test('空参数返回空对象', () => {
    expect(parseArgs(['node', 'script'])).toEqual({});
  });

  test('--flag 转为 true', () => {
    expect(parseArgs(['node', 'script', '--dry-run'])).toEqual({ 'dry-run': true });
  });

  test('--key value 转为字符串', () => {
    expect(parseArgs(['node', 'script', '--message', 'hello'])).toEqual({ message: 'hello' });
  });

  test('--key=value 也认（曾经被静默解析成 { "format=webp": true }）', () => {
    expect(parseArgs(['node', 'script', '--format=webp'])).toEqual({ format: 'webp' });
  });

  test('--key= 取空字符串', () => {
    expect(parseArgs(['node', 'script', '--message='])).toEqual({ message: '' });
  });

  test('= 形式与空格形式可以混用', () => {
    expect(parseArgs(['node', 'script', '--a=1', '--b', '2'])).toEqual({ a: '1', b: '2' });
  });

  test('多个键值对', () => {
    expect(parseArgs(['node', 'script', '--a', '1', '--b', '2'])).toEqual({ a: '1', b: '2' });
  });

  test('忽略位置参数与短选项', () => {
    expect(parseArgs(['node', 'script', 'a.md', '-x', '--force'])).toEqual({ force: true });
  });

  test('第三个位置参数不会被吃成值', () => {
    expect(parseArgs(['node', 'script', '--files', 'a.md', 'b.md'])).toEqual({ files: 'a.md' });
  });

  test('键后面无值时置 true', () => {
    expect(parseArgs(['node', 'script', '--check'])).toEqual({ check: true });
  });

  test('后面紧跟另一个 --key 时不吞掉它', () => {
    expect(parseArgs(['node', 'script', '--check', '--verbose'])).toEqual({
      check: true,
      verbose: true,
    });
  });
});

describe('getString', () => {
  test('返回字符串值', () => {
    expect(getString({ key: 'value' }, 'key')).toBe('value');
  });

  test('布尔值返回 undefined', () => {
    expect(getString({ key: true }, 'key')).toBeUndefined();
  });

  test('缺失返回 undefined', () => {
    expect(getString({}, 'key')).toBeUndefined();
  });
});

describe('getBoolean', () => {
  test('flag 存在为 true', () => {
    expect(getBoolean({ dryRun: true }, 'dryRun')).toBe(true);
  });

  test('字符串 true 为 true', () => {
    expect(getBoolean({ dryRun: 'true' }, 'dryRun')).toBe(true);
  });

  test('字符串 false 为 false', () => {
    expect(getBoolean({ dryRun: 'false' }, 'dryRun')).toBe(false);
  });

  test('缺失为 false', () => {
    expect(getBoolean({}, 'dryRun')).toBe(false);
  });
});

describe('getNumber', () => {
  test('解析整数', () => {
    expect(getNumber({ timeout: '10000' }, 'timeout')).toBe(10000);
  });

  test('解析浮点数', () => {
    expect(getNumber({ ratio: '1.5' }, 'ratio')).toBe(1.5);
  });

  test('非数字返回 undefined', () => {
    expect(getNumber({ timeout: 'abc' }, 'timeout')).toBeUndefined();
  });

  test('缺失返回 undefined', () => {
    expect(getNumber({}, 'timeout')).toBeUndefined();
  });
});
