/**
 * 轻量级 CLI 参数解析
 *
 * 支持：
 *   --flag          → boolean true
 *   --key value     → string
 *   --key=value     → string（`deno task x --format=webp` 不会被静默忽略）
 *
 * 只认 `--` 长选项；位置参数与 `-x` 短选项一律忽略（当前没有脚本用得到，
 * 所以不再收集 `_.`）。
 */

type ArgValue = string | boolean;

type ParsedArgs = Record<string, ArgValue>;

export function parseArgs(argv: string[]): ParsedArgs {
  const raw = argv.slice(2);
  const out: ParsedArgs = {};

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;
    if (!arg.startsWith('--')) continue;

    const rest = arg.slice(2);
    const eq = rest.indexOf('=');
    if (eq > 0) {
      out[rest.slice(0, eq)] = rest.slice(eq + 1);
      continue;
    }

    const next = raw[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[rest] = next;
      i++;
    } else {
      out[rest] = true;
    }
  }

  return out;
}

export function getString(args: ParsedArgs, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

export function getBoolean(args: ParsedArgs, key: string): boolean {
  const v = args[key];
  return v === true || v === 'true';
}

export function getNumber(args: ParsedArgs, key: string): number | undefined {
  const v = args[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}
