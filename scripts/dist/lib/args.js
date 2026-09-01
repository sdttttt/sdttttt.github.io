/**
 * 轻量级 CLI 参数解析
 *
 * 支持：
 *   --flag          → boolean true
 *   --key value     → string
 *   --key a b       → 第一个值 string，其余进入 positional
 *   positional      → string[]
 */
export function parseArgs(argv) {
    const raw = argv.slice(2);
    const out = { _: [] };
    for (let i = 0; i < raw.length; i++) {
        const arg = raw[i];
        if (!arg.startsWith('--')) {
            out._.push(arg);
            continue;
        }
        const key = arg.slice(2);
        const next = raw[i + 1];
        if (next && !next.startsWith('--')) {
            out[key] = next;
            i++;
        }
        else {
            out[key] = true;
        }
    }
    return out;
}
export function getString(args, key) {
    const v = args[key];
    if (typeof v === 'string')
        return v;
    if (Array.isArray(v) && v.length > 0)
        return v[0];
    return undefined;
}
export function getBoolean(args, key) {
    const v = args[key];
    return v === true || v === 'true';
}
export function getStrings(args, key) {
    const v = args[key];
    if (Array.isArray(v))
        return v;
    if (typeof v === 'string')
        return [v];
    return [];
}
export function getNumber(args, key) {
    const v = args[key];
    if (typeof v === 'number')
        return v;
    if (typeof v === 'string') {
        const n = Number(v);
        if (!Number.isNaN(n))
            return n;
    }
    return undefined;
}
