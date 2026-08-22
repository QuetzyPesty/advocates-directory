// ============================================================================
// A small PDF text extractor. No dependencies — node:zlib and a scanner.
//
// Court PDFs (the AoR list, daily cause lists) embed subsetted TrueType fonts
// whose character codes are arbitrary: byte 0x01 might be "a". The mapping back
// to real text lives in each font's /ToUnicode CMap, so that is what this reads.
// Without it you get mojibake, which is what a naive stream dump produces.
//
// Scope, honestly stated: this handles the flat, uncompressed-xref, single
// -byte-encoding PDFs that Indian court sites publish. It does not implement
// PDF properly — no encryption, no CID fonts, no object streams. If a document
// comes back as gibberish, that is the reason, and the caller should say so
// rather than importing the mess.
// ============================================================================

import zlib from 'node:zlib';

/** Index every "N G obj … endobj" body by object number. */
function indexObjects(buf) {
  const latin = buf.toString('latin1');
  const objs = new Map();
  const re = /(?<![0-9])(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const end = latin.indexOf('endobj', m.index);
    objs.set(Number(m[1]), { start: m.index + m[0].length, end: end < 0 ? latin.length : end });
  }
  return { latin, objs };
}

function objectBody({ latin, objs }, n) {
  const o = objs.get(n);
  return o ? latin.slice(o.start, o.end) : '';
}

/** Inflate an object's stream, if it has one. */
function objectStream(doc, buf, n) {
  const o = doc.objs.get(n);
  if (!o) return null;
  const body = doc.latin.slice(o.start, o.end);
  const sIdx = body.indexOf('stream');
  if (sIdx < 0) return null;
  let p = o.start + sIdx + 6;
  if (buf[p] === 0x0d) p++;
  if (buf[p] === 0x0a) p++;
  const eIdx = doc.latin.indexOf('endstream', p);
  if (eIdx < 0) return null;
  const raw = buf.subarray(p, eIdx);
  if (!/\/FlateDecode/.test(body.slice(0, sIdx))) return raw;
  try { return zlib.inflateSync(raw); } catch { return null; }
}

/**
 * Parse a /ToUnicode CMap into a code -> string map, plus how many bytes a code
 * occupies. The AoR roll uses single-byte codes; the daily cause lists use
 * two-byte CID codes. Reading one as the other yields NUL-interleaved mojibake,
 * so the codespace range has to be honoured rather than assumed.
 */
function parseToUnicode(text) {
  const map = new Map();
  const cs = text.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>/);
  const bytes = cs ? Math.max(1, Math.round(cs[1].length / 2)) : 1;
  const hexToStr = h => {
    let s = '';
    for (let i = 0; i + 3 < h.length + 1; i += 4) {
      const cp = parseInt(h.substr(i, 4), 16);
      if (!Number.isNaN(cp)) s += String.fromCharCode(cp);
    }
    return s;
  };
  for (const block of text.match(/beginbfchar[\s\S]*?endbfchar/g) || []) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(m[1], 16), hexToStr(m[2]));
    }
  }
  for (const block of text.match(/beginbfrange[\s\S]*?endbfrange/g) || []) {
    for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), dst = parseInt(m[3], 16);
      for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(dst + (c - lo)));
    }
  }
  return { map, bytes };
}

/**
 * Resource-name -> decoding map, collected across every /Font dictionary in the
 * file. Court PDFs share one resource dictionary across all pages, so a global
 * table is accurate here; where a name is reused for two different fonts the
 * first wins and the caller is told.
 */
function fontMaps(doc, buf) {
  const maps = new Map();
  const conflicts = [];
  for (const m of doc.latin.matchAll(/\/Font\s*(?:(\d+)\s+\d+\s+R|<<([\s\S]*?)>>)/g)) {
    const dict = m[1] ? objectBody(doc, Number(m[1])) : m[2];
    for (const f of dict.matchAll(/\/(\w+)\s+(\d+)\s+\d+\s+R/g)) {
      const name = f[1], fontObj = Number(f[2]);
      const tu = objectBody(doc, fontObj).match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
      if (!tu) continue;
      const cmap = objectStream(doc, buf, Number(tu[1]));
      if (!cmap) continue;
      const parsed = parseToUnicode(cmap.toString('latin1'));
      if (maps.has(name) && maps.get(name).obj !== fontObj) { conflicts.push(name); continue; }
      maps.set(name, { obj: fontObj, map: parsed.map, bytes: parsed.bytes });
    }
  }
  return { maps, conflicts };
}

const OCTAL = /\\([0-7]{1,3})/g;
function unescapePdfString(s) {
  return s
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b').replace(/\\f/g, '\f')
    .replace(OCTAL, (_, o) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\([()\\])/g, '$1');
}

/**
 * Extract text from a PDF buffer.
 *
 * Returns { text, pages, fonts, decoded } where `decoded` is the share of
 * characters that resolved through a ToUnicode map. A low number means the
 * document used an encoding this extractor does not implement — check it before
 * trusting anything parsed out of `text`.
 *
 * `lineGap` is the vertical move, in text-space units, that counts as a new
 * line rather than a same-row column jump. Court tables put columns on the same
 * baseline, so keeping a row together is what makes them parseable.
 */
export function extractText(buf, { lineGap = 2 } = {}) {
  const doc = indexObjects(buf);
  const { maps, conflicts } = fontMaps(doc, buf);

  const contents = [];
  for (const n of doc.objs.keys()) {
    const body = objectBody(doc, n);
    if (!/\/FlateDecode/.test(body)) continue;
    if (/\/Type\s*\/(XObject|Font|Metadata)/.test(body)) continue;
    const s = objectStream(doc, buf, n);
    if (!s) continue;
    const t = s.toString('latin1');
    if (/\bTJ\b|\bTj\b/.test(t)) contents.push(t);
  }

  let total = 0, viaMap = 0;
  const pages = [];

  for (const stream of contents) {
    const lines = [];
    let row = '', font = null, y = null;
    const flush = () => { if (row.trim()) lines.push(row.replace(/[ \t]+/g, ' ').trim()); row = ''; };

    const show = raw => {
      const width = font?.bytes || 1;
      const bytes = [];
      if (raw[0] === '(') {
        const s = unescapePdfString(raw.slice(1, -1));
        for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
      } else {
        const hex = raw.slice(1, -1).replace(/\s/g, '');
        for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
      }
      for (let i = 0; i + width <= bytes.length; i += width) {
        let c = 0;
        for (let b = 0; b < width; b++) c = (c << 8) | bytes[i + b];
        total++;
        const mapped = font?.map.get(c);
        if (mapped !== undefined) { row += mapped; viaMap++; }
        else if (width === 1 && c >= 32 && c < 127) row += String.fromCharCode(c);
      }
    };

    const tok = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\/(\w+)\s+[\d.]+\s+Tf|(-?[\d.]+)|(T[dDmJj*]|BT|ET|'|")/g;
    let m; const nums = [];
    while ((m = tok.exec(stream)) !== null) {
      const t = m[0];
      if (m[1]) { font = maps.get(m[1]) || null; nums.length = 0; continue; }
      if (m[2] !== undefined) { nums.push(Number(m[2])); if (nums.length > 6) nums.shift(); continue; }
      if (t[0] === '(' || (t[0] === '<' && t[1] !== '<')) { show(t); nums.length = 0; continue; }

      if (t === 'TJ' || t === 'Tj') { nums.length = 0; continue; }
      if (t === 'Td' || t === 'TD' || t === 'Tm' || t === 'T*' || t === "'" || t === '"') {
        // Only a real vertical move starts a new line; a horizontal-only move is
        // the next column of the same table row.
        const ty = t === 'Tm' ? nums[nums.length - 1] : nums[nums.length - 1];
        const dy = t === 'T*' ? Infinity
          : (t === 'Tm' ? (y === null ? Infinity : Math.abs(ty - y)) : Math.abs(ty ?? 0));
        if (dy > lineGap) flush(); else row += ' ';
        y = t === 'Tm' ? ty : (y ?? 0) + (ty ?? 0);
        nums.length = 0;
        continue;
      }
      if (t === 'ET') { flush(); nums.length = 0; }
    }
    flush();
    pages.push(lines.join('\n'));
  }

  return {
    text: pages.join('\n'),
    pages: pages.length,
    fonts: [...maps.keys()],
    conflicts,
    decoded: total ? viaMap / total : 0,
  };
}
