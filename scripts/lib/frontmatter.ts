/**
 * 轻量级 front matter 解析
 *
 * 仅支持 Hugo/hugo-paper 中实际用到的 YAML 子集：
 * - 标量字符串、数字、布尔、null
 * - 数组：inline（`tags: [a, b]`）与块式（`aliases:` + `  - /a/`）
 * - 一级嵌套对象（如 { image: ..., alt: ... }）
 */

interface FrontMatter {
  [key: string]: unknown;
}

/** front matter 块的整体匹配（`---` 开头、`---` 结尾，不含尾部换行） */
const FRONT_MATTER_REGEX = /^---\n([\s\S]*?)\n---/;

function parseScalar(s: string): unknown {
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((x) => unquote(x.trim()));
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return unquote(s);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseFrontMatter(raw: string): FrontMatter {
  const m = raw.match(FRONT_MATTER_REGEX);
  if (!m) return {};
  const out: FrontMatter = {};
  const lines = m[1]!.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const kv = line.match(/^(\w[\w.-]*):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1]!;
    const rawVal = kv[2]!.trim();
    if (rawVal === '') {
      i++;
      // 缩进行可能是嵌套对象（`  image: x`）或块式数组（`  - /a/`）——两者不会混用
      const nested: Record<string, unknown> = {};
      const list: unknown[] = [];
      while (i < lines.length) {
        const nl = lines[i]!;
        if (!nl.startsWith('  ') && !nl.startsWith('\t')) break;
        const trimmed = nl.trim();
        const nkv = trimmed.match(/^(\w[\w.-]*):\s*(.*)$/);
        if (nkv) {
          nested[nkv[1]!] = parseScalar(nkv[2]!.trim());
        } else {
          const item = trimmed.match(/^-\s*(.*)$/);
          if (item) list.push(parseScalar(item[1]!.trim()));
        }
        i++;
      }
      // 注意：空值 + 空缩进块仍然给 {}（历史行为，测试依赖它）
      out[key] = list.length > 0 ? list : nested;
      continue;
    }
    out[key] = parseScalar(rawVal);
    i++;
  }
  return out;
}

/** 从文件内容中提取 front matter 文本块 */
export function extractFrontMatterBlock(raw: string): string | null {
  const m = raw.match(FRONT_MATTER_REGEX);
  return m ? m[0]! : null;
}

/**
 * 把 front matter 的 `date` 值归一成 `YYYYMMDD`；不是合法日期则返回 null。
 *
 * 只接受以 `YYYY-MM-DD` 开头的值（`2025-05-04`、`"2022-11-08"`、
 * `2020-05-09T13:00:00Z`），月日做**真实日历校验**，所以 `2026-02-31` 也会被拒。
 *
 * 与 checkTitleAndDate 一起被 validate-posts / rename-posts 共用 —— 曾经用
 * `Date.parse`，它既接受 `2026/01/01` / `Jan 1 2026`（于是校验通过），也接受
 * `2026-02-31`（JS 会滚到 3/3），出现过「校验说合法、rename-posts 静默跳过」。
 */
export function toYyyymmdd(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  const sameDay = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d;
  if (!sameDay) return null;
  return `${m[1]}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

/**
 * title / date 的问题清单（空数组 = 没问题）。
 *
 * validate-posts 与 rename-posts 共用同一份判据 **与同一套措辞**：两边各写一份时
 * 「date 是否合法」的定义漂移过（一边 `Date.parse`、一边正则），报错文案也不一致。
 */
export function checkTitleAndDate(meta: FrontMatter): string[] {
  const issues: string[] = [];

  if (typeof meta.title !== 'string' || meta.title.trim() === '') {
    issues.push('缺少 title 或 title 为空');
  }

  if (meta.date === undefined) {
    issues.push('缺少 date 字段');
  } else if (!toYyyymmdd(meta.date)) {
    issues.push(`date 格式无效: ${String(meta.date)}`);
  }

  return issues;
}
