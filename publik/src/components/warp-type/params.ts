import { FOLD, FOLD_CENTRES, FOLD_GAIN, GATHER, GATHER_SCALE, ROTATE, SORT, TRAIL, TRAIL_PAD, WAVE, WAVE_WIDTH } from "./tables";

export { FOLD, FOLD_CENTRES, FOLD_GAIN, GATHER, GATHER_SCALE, ROTATE, SORT, TRAIL, TRAIL_PAD, WAVE, WAVE_WIDTH } from "./tables";
export type { TrailLayer } from "./tables";

export const TRAIL_OPAQUE = false;

export const FRAME_MS = 40;
export const FRAMES = 75;
export const LOOP_MS = FRAMES * FRAME_MS;
export const STILL_FRAME = 12;

export const SCENE_W = 1080;
export const SCENE_H = 608;

export const GROUND = "#0b1a1f";
export const INK = "#d9f5ea";

export const FONT_VAR = "--font-sans";
export const FONT_WEIGHT = 500;
export const FONT_SIZE = 106;
export const SORT_BASE = [305, 403] as const;
export const CAP = 76;

export type Phrases = readonly (readonly string[])[];
export const DEFAULT_PHRASES: Phrases = [
  ["Design", "demands courage"],
  ["Design", "echoes intent"],
  ["Design", "carries", "weight"],
  ["Design", "turns heads"],
  ["Design", "bends habits"],
  ["Design", "sorts chaos"],
];

export const CUTS = [0, 13, 25, 38, 50, 63, 75] as const;
export const SCENE_NAMES = ["wave", "trail", "gather", "rotate", "fold", "sort"] as const;

export function keyAt(ms: number): number {
  const m = ((ms % LOOP_MS) + LOOP_MS) % LOOP_MS;
  return m / FRAME_MS;
}

export function frameAt(ms: number): number {
  return Math.floor(keyAt(ms));
}

export function sceneAt(key: number): { scene: number; local: number } {
  const f = ((key % FRAMES) + FRAMES) % FRAMES;
  let s = 0;
  while (s + 1 < CUTS.length - 1 && f >= CUTS[s + 1]) s++;
  return { scene: s, local: f - CUTS[s] };
}

export interface Measurer {
  width(text: string): number;
  ink(ch: string): readonly [number, number, number, number];
}

export interface Line {
  text: string;
  pens: readonly number[];
  adv: readonly number[];
  ink: readonly (readonly [number, number, number, number] | null)[];
  width: number;
}

export function layoutLine(text: string, m: Measurer): Line {
  const pens: number[] = [];
  const adv: number[] = [];
  const ink: (readonly [number, number, number, number] | null)[] = [];
  for (let i = 0; i < text.length; i++) {
    const a = m.width(text[i]);
    const pen = m.width(text.slice(0, i + 1)) - a;
    pens.push(pen);
    adv.push(a);
    if (text[i] === " ") {
      ink.push(null);
      continue;
    }
    const b = m.ink(text[i]);
    ink.push([pen + b[0], pen + b[1], b[2], b[3]]);
  }
  return { text, pens, adv, ink, width: m.width(text) };
}

export interface Layouts {
  scenes: readonly (readonly Line[])[];
  sortStart: readonly Line[];
  swaps: readonly Swap[];
}

export function buildLayouts(phrases: Phrases, m: Measurer): Layouts {
  const swaps = deriveSwaps(phrases[5]);
  const start = phrases[5].map((text, li) => {
    const a = text.split("");
    for (const sw of swaps) if (sw.line === li) [a[sw.at], a[sw.at + 1]] = [a[sw.at + 1], a[sw.at]];
    return layoutLine(a.join(""), m);
  });
  return { scenes: phrases.map((lines) => lines.map((t) => layoutLine(t, m))), sortStart: start, swaps };
}

export const REST_BASE = [305, 403] as const;

export function inkExtent(line: Line, from = 0, to = line.text.length): [number, number, number, number] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = from; i < to; i++) {
    const b = line.ink[i];
    if (!b) continue;
    x0 = Math.min(x0, b[0]);
    x1 = Math.max(x1, b[1]);
    y0 = Math.min(y0, b[2]);
    y1 = Math.max(y1, b[3]);
  }
  return [x0, x1, y0, y1];
}

export function centredOrigin(line: Line, cx: number): number {
  const [x0, x1] = inkExtent(line);
  return cx - (x0 + x1) / 2;
}

export type Mat = [number, number, number, number, number, number];
export const ID: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy: number): Mat => [sx, 0, 0, sy, 0, 0];

export function rotate(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export const skewX = (deg: number): Mat => [1, 0, -Math.tan((deg * Math.PI) / 180), 1, 0, 0];

export function about(px: number, py: number, m: Mat): Mat {
  return mul(translate(px, py), mul(m, translate(-px, -py)));
}

export function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

type Nested = number | readonly Nested[] | { readonly [k: string]: Nested };

function lerpNested(a: Nested, b: Nested, t: number): Nested {
  if (typeof a === "number") return a + ((b as number) - a) * t;
  if (Array.isArray(a)) return (a as readonly Nested[]).map((v, i) => lerpNested(v, (b as readonly Nested[])[i], t));
  const o: { [k: string]: Nested } = {};
  const bo = b as { readonly [k: string]: Nested };
  for (const k of Object.keys(a as object)) o[k] = lerpNested((a as { readonly [k: string]: Nested })[k], bo[k], t);
  return o;
}

export function row<T extends Nested>(table: readonly T[], local: number): T {
  const n = table.length;
  if (local <= 0) return table[0];
  if (local >= n - 1) return table[n - 1];
  const i = Math.floor(local);
  const t = local - i;
  return t === 0 ? table[i] : (lerpNested(table[i], table[i + 1], t) as T);
}

export interface Glyph {
  scene: number;
  line: number;
  slot: number;
  ch: string;
  m: Mat;
  box?: readonly [number, number, number, number];
}

function place(
  line: Line,
  ox: number,
  base: number,
  scene: number,
  li: number,
  out: Glyph[],
  per: (i: number, ax: number, ay: number) => Mat | null,
) {
  for (let i = 0; i < line.text.length; i++) {
    const ch = line.text[i];
    if (ch === " ") continue;
    const b = line.ink[i];
    const ax = ox + (b ? (b[0] + b[1]) / 2 : line.pens[i]);
    const ay = base - (b ? (b[2] + b[3]) / 2 : 0);
    const m = per(i, ax, ay);
    if (!m) continue;
    out.push({ scene, line: li, slot: i, ch, m: mul(m, translate(ox + line.pens[i], base)) });
  }
}

export function poly(c: readonly number[], u: number): number {
  let v = 0;
  let p = 1;
  for (const k of c) {
    v += k * p;
    p *= u;
  }
  return v;
}

function waveGlyphs(local: number, L: Layouts, out: Glyph[]) {
  const lines = L.scenes[0];
  const cur = row(WAVE, local);
  for (let li = 0; li < Math.min(2, lines.length); li++) {
    const line = lines[li];
    const [x0, x1] = inkExtent(line);
    const ox = centredOrigin(line, 540.5);
    const base = REST_BASE[li];
    const c = cur[li];
    const wscale = (x1 - x0) / WAVE_WIDTH[li];
    place(line, ox, base, 0, li, out, (_i, ax) => {
      const u = (ax - ox - x0) / (x1 - x0);
      const sx = poly(c[0], u);
      const sy = poly(c[1], u);
      const rot = poly(c[2], u);
      const sk = poly(c[3], u);
      const ux = poly(c[4], u) * wscale;
      const uy = poly(c[5], u);
      const t = Math.tan((sk * Math.PI) / 180);
      const shape: Mat = [sx, 0, sy * t, sy, 0, 0];
      return mul(translate(ax + ux, base + uy), mul(rotate(rot), mul(shape, translate(-ax, -base))));
    });
  }
}

function trailGlyphs(local: number, L: Layouts, out: Glyph[]) {
  const rows = row(TRAIL, local);
  const [first, big] = L.scenes[1];
  const space = big.text.lastIndexOf(" ");
  const w0 = space + 1;
  const layers: [Line, number, number][] = [
    [first, 0, first.text.length],
    [big, w0, big.text.length],
    [big, w0, big.text.length],
    [big, w0, big.text.length],
    [big, w0, big.text.length],
    [big, 0, space < 0 ? big.text.length : space],
    [big, w0, big.text.length],
  ];
  for (let k = 0; k < layers.length; k++) {
    const [line, from, to] = layers[k];
    if (from >= to) continue;
    const [sx, sy, lean, turn, tx, ty] = rows[k];
    const p0 = line.pens[from];
    const x = k === 6 ? rows[5][4] + p0 * rows[5][0] + tx : tx;
    const m = mul(translate(x, ty), mul(rotate(turn), mul(skewX(lean), scale(sx, sy))));
    const [x0, x1, y0, y1] = inkExtent(line, from, to);
    if (TRAIL_OPAQUE) {
      out.push({
        scene: 1,
        line: k,
        slot: -1,
        ch: "",
        m,
        box: [x0 - p0 - TRAIL_PAD[0], -y1 - TRAIL_PAD[1], x1 - p0 + TRAIL_PAD[2], -y0 + TRAIL_PAD[3]],
      });
    }
    for (let i = from; i < to; i++) {
      const ch = line.text[i];
      if (ch === " ") continue;
      out.push({ scene: 1, line: k, slot: i, ch, m: mul(m, translate(line.pens[i] - p0, 0)) });
    }
  }
}

function gatherGlyphs(local: number, L: Layouts, out: Glyph[]) {
  const rows = row(GATHER, local);
  const lines = L.scenes[2];
  for (let li = 0; li < Math.min(3, lines.length); li++) {
    const line = lines[li];
    const [cx, cy, deg] = rows[Math.min(li, rows.length - 1)];
    const s = GATHER_SCALE[Math.min(li, GATHER_SCALE.length - 1)];
    const [, , y0, y1] = inkExtent(line);
    const ox = centredOrigin(line, cx);
    const base = cy + (y0 + y1) / 2;
    place(line, ox, base, 2, li, out, () => about(cx, cy, mul(rotate(deg), scale(s, s))));
  }
}

function rotateGlyphs(local: number, L: Layouts, out: Glyph[]) {
  const rows = row(ROTATE, local);
  const lines = L.scenes[3];
  for (let li = 0; li < Math.min(2, lines.length); li++) {
    const line = lines[li];
    const [cx, cy, deg] = rows[li];
    const [, , y0, y1] = inkExtent(line);
    const ox = centredOrigin(line, cx);
    const base = cy + (y0 + y1) / 2;
    place(line, ox, base, 3, li, out, () => about(cx, cy, rotate(deg)));
  }
}

function foldGlyphs(local: number, L: Layouts, out: Glyph[]) {
  const rows = row(FOLD, local);
  const lines = L.scenes[4];
  for (let li = 0; li < Math.min(2, lines.length); li++) {
    const line = lines[li];
    const [cx, cy] = FOLD_CENTRES[li];
    const [, , y0, y1] = inkExtent(line);
    const ox = centredOrigin(line, cx);
    const base = cy + (y0 + y1) / 2;
    const space = li === 0 ? -1 : line.text.indexOf(" ");
    const centre = (from: number, to: number): [number, number] => {
      const [x0, x1, wy0, wy1] = inkExtent(line, from, to);
      return [ox + (x0 + x1) / 2, base - (wy0 + wy1) / 2];
    };
    const words: [number, number][] = space < 0 ? [centre(0, line.text.length)] : [centre(0, space), centre(space + 1, line.text.length)];
    place(line, ox, base, 4, li, out, (i) => {
      const w = li === 0 ? 0 : space < 0 || i < space ? 1 : 2;
      const [deg, dx, dy] = rows[Math.min(w, rows.length - 1)];
      const [wcx, wcy] = words[li === 0 ? 0 : Math.min(w - 1, words.length - 1)];
      return mul(translate(dx * FOLD_GAIN.drift, dy * FOLD_GAIN.drift), about(wcx, wcy, rotate(deg * FOLD_GAIN.turn)));
    });
  }
}

export interface Swap {
  line: number;
  at: number;
  round: number;
  hop: 0 | 1;
}

export function deriveSwaps(lines: readonly string[]): Swap[] {
  const out: Swap[] = [];
  lines.forEach((text, li) => {
    let start = 0;
    let k = 0;
    text.split(" ").forEach((w) => {
      let n = 0;
      for (let i = 0; i + 1 < w.length && n < 3; i += 2) {
        if (w[i] === w[i + 1]) continue;
        if (w[i] !== w[i].toLowerCase() || w[i + 1] !== w[i + 1].toLowerCase()) continue;
        out.push({ line: li, at: start + i, round: k % 3, hop: li === 0 ? 0 : 1 });
        n++;
        k++;
      }
      start += w.length + 1;
    });
  });
  return out;
}

function at(arr: readonly number[], k: number): number {
  const n = arr.length;
  if (k <= 0) return arr[0];
  if (k >= n - 1) return arr[n - 1];
  const i = Math.floor(k);
  const t = k - i;
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}

function sortGlyphs(local: number, L: Layouts, out: Glyph[]) {
  const lines = L.scenes[5];
  for (let li = 0; li < Math.min(2, lines.length); li++) {
    const sorted = lines[li];
    const start = L.sortStart[li];
    const ox = centredOrigin(sorted, 540.5);
    const sox = centredOrigin(start, 540.5);
    const base = SORT_BASE[li];
    const from: number[] = [];
    for (let i = 0; i < sorted.text.length; i++) from[i] = i;
    for (const sw of L.swaps) {
      if (sw.line === li) {
        from[sw.at] = sw.at + 1;
        from[sw.at + 1] = sw.at;
      }
    }
    for (let i = 0; i < sorted.text.length; i++) {
      const ch = sorted.text[i];
      if (ch === " ") continue;
      const b = sorted.ink[i]!;
      const dest = ox + sorted.pens[i];
      const origin = sox + start.pens[from[i]];
      const sw = L.swaps.find((s) => s.line === li && (s.at === i || s.at + 1 === i));
      const push = (x: number, s: number) => {
        const cx = x - sorted.pens[i] + (b[0] + b[1]) / 2;
        const cy = base - (b[2] + b[3]) / 2;
        out.push({
          scene: 5,
          line: li,
          slot: i,
          ch,
          m: mul(s === 1 ? ID : about(cx, cy, scale(s, s)), translate(x, base)),
        });
      };
      if (!sw) {
        push(dest, 1);
        continue;
      }
      const R = SORT.firstRound + sw.round * SORT.roundEvery;
      const k = local - R;
      const isHopper = (from[i] === sw.at) === (sw.hop === 0);
      const dir = Math.sign(dest - origin) || 1;
      if (!isHopper) {
        push(origin + (dest - origin) * at(SORT.slide, k + 4), 1);
        continue;
      }
      if (k <= -4) {
        push(origin, 1);
        continue;
      }
      if (k >= 3) {
        push(dest, 1);
        continue;
      }
      const s = at(SORT.shrink, k + 4);
      if (k < 0) {
        push(origin - dir * at(SORT.drift, k + 4), s);
        continue;
      }
      if (k < 1) {
        push(origin - dir * SORT.drift[4], s);
        push(dest + dir * SORT.overshoot[0], s);
        continue;
      }
      push(dest + dir * at(SORT.overshoot, k), s);
    }
  }
}

export function glyphsAt(key: number, L: Layouts): Glyph[] {
  const { scene, local } = sceneAt(key);
  const out: Glyph[] = [];
  if (scene === 0) waveGlyphs(local, L, out);
  else if (scene === 1) trailGlyphs(local, L, out);
  else if (scene === 2) gatherGlyphs(local, L, out);
  else if (scene === 3) rotateGlyphs(local, L, out);
  else if (scene === 4) foldGlyphs(local, L, out);
  else sortGlyphs(local, L, out);
  return out;
}
