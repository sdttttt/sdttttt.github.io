import { describe, test } from 'node:test';
import { parseArgs, getString, getBoolean, getStrings, getNumber } from '../lib/args.js';
import { expect } from './expect.js';

describe('parseArgs', () => {
  test('空参数返回空对象和空位置参数', () => {
    expect(parseArgs(['node', 'script'])).toEqual({ _: [] });
  });

  test('--flag 转为 true', () => {
    expect(parseArgs(['node', 'script', '--dry-run'])).toEqual({ _: [], 'dry-run': true });
  });

  test('--key value 转为字符串', () => {
    expect(parseArgs(['node', 'script', '--message', 'hello'])).toEqual({ _: [], message: 'hello' });
  });

  test('多个键值对', () => {
    expect(parseArgs(['node', 'script', '--a', '1', '--b', '2'])).toEqual({
      _: [],
      a: '1',
      b: '2',
    });
  });

  test('收集位置参数', () => {
    expect(parseArgs(['node', 'script', 'a.md', 'b.md'])).toEqual({ _: ['a.md', 'b.md'] });
  });

  test('混合 flag、键值和位置参数', () => {
    expect(parseArgs(['node', 'script', '--force', '--files', 'a.md', 'b.md'])).toEqual({
      _: ['b.md'],
      force: true,
      files: 'a.md',
    });
  });

  test('键后面无值时置 true', () => {
    expect(parseArgs(['node', 'script', '--check'])).toEqual({ _: [], check: true });
  });
});

describe('getString', () => {
  test('返回字符串值', () => {
    expect(getString({ _: [], key: 'value' }, 'key')).toBe('value');
  });

  test('数组取首个元素', () => {
    expect(getString({ _: [], key: ['a', 'b'] }, 'key')).toBe('a');
  });

  test('布尔值返回 undefined', () => {
    expect(getString({ _: [], key: true }, 'key')).toBeUndefined();
  });

  test('缺失返回 undefined', () => {
    expect(getString({ _: [] }, 'key')).toBeUndefined();
  });
});

describe('getBoolean', () => {
  test('flag 存在为 true', () => {
    expect(getBoolean({ _: [], dryRun: true }, 'dryRun')).toBe(true);
  });

  test('字符串 true 为 true', () => {
    expect(getBoolean({ _: [], dryRun: 'true' }, 'dryRun')).toBe(true);
  });

  test('字符串 false 为 false', () => {
    expect(getBoolean({ _: [], dryRun: 'false' }, 'dryRun')).toBe(false);
  });

  test('缺失为 false', () => {
    expect(getBoolean({ _: [] }, 'dryRun')).toBe(false);
  });
});

describe('getStrings', () => {
  test('数组原样返回', () => {
    expect(getStrings({ _: [], key: ['a', 'b'] }, 'key')).toEqual(['a', 'b']);
  });

  test('字符串包装成数组', () => {
    expect(getStrings({ _: [], key: 'a' }, 'key')).toEqual(['a']);
  });

  test('缺失返回空数组', () => {
    expect(getStrings({ _: [] }, 'key')).toEqual([]);
  });
});

describe('getNumber', () => {
  test('解析整数', () => {
    expect(getNumber({ _: [], timeout: '10000' }, 'timeout')).toBe(10000);
  });

  test('解析浮点数', () => {
    expect(getNumber({ _: [], ratio: '1.5' }, 'ratio')).toBe(1.5);
  });

  test('非数字返回 undefined', () => {
    expect(getNumber({ _: [], timeout: 'abc' }, 'timeout')).toBeUndefined();
  });

  test('缺失返回 undefined', () => {
    expect(getNumber({ _: [] }, 'timeout')).toBeUndefined();
  });
});
