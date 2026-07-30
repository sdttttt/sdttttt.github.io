/**
 * 基于 node:assert/strict 的轻量 expect 风格断言助手。
 *
 * 让迁移自 bun:test 的测试尽量少改断言写法。
 */

import assert from 'node:assert/strict';

interface MockCall {
  arguments?: unknown[];
}

interface MockLike {
  mock: {
    calls: MockCall[] | unknown[][];
  };
}

export function expect<T>(actual: T) {
  function toBe(expected: unknown) {
    assert.strictEqual(actual, expected);
  }

  function toEqual(expected: unknown) {
    assert.deepStrictEqual(actual, expected);
  }

  function toBeNull() {
    assert.strictEqual(actual, null);
  }

  function toBeUndefined() {
    assert.strictEqual(actual, undefined);
  }

  function toBeDefined() {
    assert.notStrictEqual(actual, undefined);
  }

  function toContain(expected: string) {
    assert.ok(
      typeof actual === 'string' && actual.includes(expected),
      `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`,
    );
  }

  function notToContain(expected: string) {
    assert.ok(
      typeof actual === 'string' && !actual.includes(expected),
      `expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(expected)}`,
    );
  }

  function toMatch(expected: RegExp) {
    assert.match(String(actual), expected);
  }

  function toBeGreaterThan(expected: number) {
    assert.ok(typeof actual === 'number' && actual > expected);
  }

  function toBeGreaterThanOrEqual(expected: number) {
    assert.ok(typeof actual === 'number' && actual >= expected);
  }

  function toHaveBeenCalled(this: void) {
    const mock = actual as unknown as MockLike;
    assert.ok(mock.mock && mock.mock.calls.length > 0, 'expected function to have been called');
  }

  function notToHaveBeenCalled(this: void) {
    const mock = actual as unknown as MockLike;
    assert.strictEqual(mock.mock?.calls.length, 0);
  }

  function toHaveBeenCalledWith(this: void, ...expectedArgs: unknown[]) {
    const mock = actual as unknown as MockLike;
    assert.ok(
      mock.mock &&
        mock.mock.calls.some((call) => {
          const args = (call as MockCall).arguments ?? (call as unknown[]);
          try {
            assert.deepStrictEqual(args, expectedArgs);
            return true;
          } catch {
            return false;
          }
        }),
      `expected function to have been called with ${JSON.stringify(expectedArgs)}`,
    );
  }

  return {
    toBe,
    toEqual,
    toBeNull,
    toBeUndefined,
    toBeDefined,
    toContain,
    toMatch,
    toBeGreaterThan,
    toBeGreaterThanOrEqual,
    toHaveBeenCalled,
    toHaveBeenCalledWith,
    not: {
      toBe: (expected: unknown) => assert.notStrictEqual(actual, expected),
      toBeNull: () => assert.notStrictEqual(actual, null),
      toContain: notToContain,
      toHaveBeenCalled: notToHaveBeenCalled,
    },
  };
}
