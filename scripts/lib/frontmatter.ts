/**
 * 轻量级 front matter 解析
 *
 * 仅支持 Hugo/PaperMod 中实际用到的 YAML 子集：
 * - 标量字符串、数字、布尔、null
 * - 简单数组
 * - 一级嵌套对象（如 cover: { image, alt, hidden }）
 */

export interface FrontMatter {
  [key: string]: unknown;
}

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
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: FrontMatter = {};
  const lines = m[1]!.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith('#')) { i++; continue; }
    const kv = line.match(/^(\w[\w.-]*):\s*(.*)$/);
    if (!kv) { i++; continue; }
    const key = kv[1]!;
    const rawVal = kv[2]!.trim();
    if (rawVal === '') {
      const nested: Record<string, unknown> = {};
      i++;
      while (i < lines.length) {
        const nl = lines[i]!;
        if (!nl.startsWith('  ') && !nl.startsWith('\t')) break;
        const nkv = nl.trim().match(/^(\w[\w.-]*):\s*(.*)$/);
        if (nkv) nested[nkv[1]!] = parseScalar(nkv[2]!.trim());
        i++;
      }
      out[key] = nested;
      continue;
    }
    out[key] = parseScalar(rawVal);
    i++;
  }
  return out;
}

/** 从文件内容中提取 front matter 文本块 */
export function extractFrontMatterBlock(raw: string): string | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[0]! : null;
}
