/**
 * 基于 node:assert/strict 的轻量 expect 风格断言助手。
 *
 * 让迁移自 bun:test 的测试尽量少改断言写法。
 */
import assert from 'node:assert/strict';
export function expect(actual) {
    function toBe(expected) {
        assert.strictEqual(actual, expected);
    }
    function toEqual(expected) {
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
    function toContain(expected) {
        assert.ok(typeof actual === 'string' && actual.includes(expected), `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
    }
    function notToContain(expected) {
        assert.ok(typeof actual === 'string' && !actual.includes(expected), `expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(expected)}`);
    }
    function toMatch(expected) {
        assert.match(String(actual), expected);
    }
    function toBeGreaterThan(expected) {
        assert.ok(typeof actual === 'number' && actual > expected);
    }
    function toBeGreaterThanOrEqual(expected) {
        assert.ok(typeof actual === 'number' && actual >= expected);
    }
    function toHaveBeenCalled() {
        const mock = actual;
        assert.ok(mock.mock && mock.mock.calls.length > 0, 'expected function to have been called');
    }
    function notToHaveBeenCalled() {
        const mock = actual;
        assert.strictEqual(mock.mock?.calls.length, 0);
    }
    function toHaveBeenCalledWith(...expectedArgs) {
        const mock = actual;
        assert.ok(mock.mock &&
            mock.mock.calls.some((call) => {
                const args = call.arguments ?? call;
                try {
                    assert.deepStrictEqual(args, expectedArgs);
                    return true;
                }
                catch {
                    return false;
                }
            }), `expected function to have been called with ${JSON.stringify(expectedArgs)}`);
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
            toBe: (expected) => assert.notStrictEqual(actual, expected),
            toBeNull: () => assert.notStrictEqual(actual, null),
            toContain: notToContain,
            toHaveBeenCalled: notToHaveBeenCalled,
        },
    };
}
