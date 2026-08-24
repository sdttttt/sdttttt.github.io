import { describe, test } from 'node:test';
import { buildCommand } from '../format-markdown.js';
import { parseArgs, type ParsedArgs } from '../lib/args.js';
import { expect } from './expect.js';

describe('buildCommand', () => {
  test('默认（无 --check）走 --write', () => {
    const args = parseArgs(['node', 'script']);
    expect(buildCommand(args)).toBe('prettier --write "**/*.md"');
  });

  test('--check 走 --check', () => {
    const args = parseArgs(['node', 'script', '--check']);
    expect(buildCommand(args)).toBe('prettier --check "**/*.md"');
  });

  test('--check=true 字符串也识别', () => {
    const args: ParsedArgs = { _: [], check: 'true' };
    expect(buildCommand(args)).toBe('prettier --check "**/*.md"');
  });

  test('--check=false 字符串走 --write', () => {
    const args: ParsedArgs = { _: [], check: 'false' };
    expect(buildCommand(args)).toBe('prettier --write "**/*.md"');
  });

  test('pattern 固定为 **/*.md（暂未支持自定义 glob）', () => {
    const args = parseArgs(['node', 'script']);
    expect(buildCommand(args)).toContain('"**/*.md"');
  });
});