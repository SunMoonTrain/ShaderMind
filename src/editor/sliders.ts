import { Prec, StateEffect, StateField, Transaction, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";

import { formatFloat, numberAt } from "./decorations";

/**
 * 仿 The Book of Shaders 编辑器的数值调节器：
 * - 单击数字字面量，下方弹出滑条；
 * - 单击 `vec2(x, y)` 的 vec2 或括号，弹出二维调节板；
 * - 单击分量全在 0..1 之内的 `vec3(…)` / `vec4(…)`（或它前面的色块），弹出取色板，vec4 带透明度。
 * 拖动时直接改写源码（userEvent 为 input.slider），调用方据此立即重编译。
 */

interface SliderState {
  kind: "number" | "vec2" | "color";
  /** 被调节的文本范围：数字本身，或 vecN 括号内的参数列表 */
  from: number;
  to: number;
  /** 同一个弹窗期间保持不变，CodeMirror 据此复用 tooltip 的 DOM，拖动不会中断 */
  create: Tooltip["create"];
}

const openSlider = StateEffect.define<Omit<SliderState, "create">>();
const closeSlider = StateEffect.define<null>();

const sliderField = StateField.define<SliderState | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(closeSlider)) return null;
      if (e.is(openSlider)) return { ...e.value, create: (view) => createSliderView(view) };
    }
    if (!value) return value;
    if (tr.docChanged) {
      // 别处的编辑会让弹窗对应的文本失效，直接关掉
      if (!tr.isUserEvent("input.slider")) return null;
      return { ...value, from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) };
    }
    if (tr.selection) {
      // 留出 "vecN(" 的 5 个字符，单击类型名本身不算移开
      const head = tr.state.selection.main.head;
      if (head < value.from - 5 || head > value.to + 1) return null;
    }
    return value;
  },
  provide: (f) =>
    showTooltip.from(f, (s): Tooltip | null =>
      s ? { pos: s.from, above: false, strictSide: false, arrow: true, create: s.create } : null,
    ),
});

// ------------------------------------------------------------------ 定位

const NUM = String.raw`-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?`;
const VEC2_RE = new RegExp(String.raw`\bvec2\s*\(\s*(${NUM})\s*,\s*(${NUM})\s*\)`, "g");

/** pos 所在的 `vec2(数字, 数字)`，返回括号内参数列表的范围。 */
function vec2Around(state: EditorState, pos: number): { word: number; from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  VEC2_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VEC2_RE.exec(line.text))) {
    const start = line.from + m.index;
    const end = start + m[0].length;
    if (pos < start || pos > end) continue;
    const open = m[0].indexOf("(");
    const close = m[0].lastIndexOf(")");
    return { word: start, from: start + open + 1, to: start + close };
  }
  return null;
}

const COLOR_RE = new RegExp(String.raw`\bvec([34])\s*\(\s*(${NUM}(?:\s*,\s*${NUM}){0,3})\s*\)`, "g");

interface ColorLiteral {
  from: number;
  to: number;
  /** 3 或 4；4 表示带透明度 */
  size: number;
  rgb: [number, number, number];
  alpha: number | null;
}

/** pos 所在的 `vec3(…)` / `vec4(…)`：参数是 1 个或 N 个数字，且全部在 0..1 之内才算颜色。 */
export function colorLiteralAt(state: EditorState, pos: number): ColorLiteral | null {
  const line = state.doc.lineAt(pos);
  COLOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COLOR_RE.exec(line.text))) {
    const start = line.from + m.index;
    if (pos < start || pos > start + m[0].length) continue;
    const size = Number(m[1]);
    const nums = m[2].split(",").map((s) => Number(s.trim()));
    if (nums.length !== 1 && nums.length !== size) return null;
    if (nums.some((n) => !(n >= 0 && n <= 1))) return null;
    const all = (i: number) => (nums.length === 1 ? nums[0] : nums[i]);
    const argsStart = start + m[0].indexOf("(") + 1;
    return {
      from: argsStart,
      to: start + m[0].lastIndexOf(")"),
      size,
      rgb: [all(0), all(1), all(2)],
      alpha: size === 4 ? all(3) : null,
    };
  }
  return null;
}

function inComment(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  const slash = line.text.indexOf("//");
  if (slash >= 0 && line.from + slash < pos) return true;
  const before = state.sliceDoc(Math.max(0, pos - 20_000), pos);
  return before.lastIndexOf("/*") > before.lastIndexOf("*/");
}

/** 单击后决定弹出哪种调节器；数字优先，其次 vec2、颜色。 */
function sliderFor(state: EditorState, pos: number): Omit<SliderState, "create"> | null {
  if (inComment(state, pos)) return null;
  const num = numberAt(state, pos);
  if (num) return { kind: "number", from: num.from, to: num.to };
  const vec = vec2Around(state, pos);
  if (vec) return { kind: "vec2", from: vec.from, to: vec.to };
  const color = colorLiteralAt(state, pos);
  if (color) return { kind: "color", from: color.from, to: color.to };
  return null;
}

/**
 * 给色块用：打开 pos 处颜色字面量的取色板。
 * 没启用数值滑条（字段不存在）或不是合法颜色时返回 false，由调用方退回系统取色器。
 */
export function openColorEditor(view: EditorView, pos: number): boolean {
  // 字段不存在时返回 undefined；存在但没有弹窗时值是 null
  if (view.state.field(sliderField, false) === undefined) return false;
  const color = colorLiteralAt(view.state, pos);
  if (!color) return false;
  view.dispatch({ effects: openSlider.of({ kind: "color", from: color.from, to: color.to }) });
  return true;
}

// ------------------------------------------------------------------ 数值范围

/** 不小于 x 的 1 / 2 / 5 × 10^k。 */
function niceCeil(x: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(x)));
  for (const f of [1, 2, 5, 10]) if (f * exp >= x) return f * exp;
  return 10 * exp;
}

/** 滑条范围：0..1 和 -1..1 之内的值直接用这两个区间，其余按数量级放大。 */
function rangeFor(value: number, isInt: boolean): [number, number] {
  if (isInt) {
    const r = niceCeil(Math.max(10, Math.abs(value) * 2));
    return value < 0 ? [-r, 0] : [0, r];
  }
  if (value >= 0 && value <= 1) return [0, 1];
  if (value >= -1 && value <= 1) return [-1, 1];
  const r = niceCeil(Math.abs(value) * 1.5);
  return value < 0 ? [-r, 0] : [0, r];
}

function decimalsFor(text: string, span: number): number {
  const dot = text.indexOf(".");
  const own = dot < 0 ? 0 : text.replace(/[eE].*$/, "").length - dot - 1;
  return Math.min(Math.max(own, 3 - Math.floor(Math.log10(span)), 1), 6);
}

function formatValue(v: number, isInt: boolean, decimals: number): string {
  return isInt ? String(Math.round(v)) : formatFloat(v, decimals);
}

// ------------------------------------------------------------------ 写回源码

function write(view: EditorView, text: string): void {
  const s = view.state.field(sliderField, false);
  if (!s) return;
  // 负数紧跟在 + / - 后面会变成 -- 或 +-，加个空格
  if (text.startsWith("-") && /[+-]$/.test(view.state.sliceDoc(s.from - 1, s.from))) text = " " + text;
  if (text === view.state.sliceDoc(s.from, s.to)) return;
  view.dispatch({
    changes: { from: s.from, to: s.to, insert: text },
    annotations: Transaction.userEvent.of("input.slider"),
  });
}

function close(view: EditorView): void {
  view.dispatch({ effects: closeSlider.of(null) });
  view.focus();
}

// ------------------------------------------------------------------ 弹窗

function createSliderView(view: EditorView) {
  const s = view.state.field(sliderField)!;
  const dom = document.createElement("div");
  dom.className = "sm-slider";
  dom.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      close(view);
    }
  });
  // 不让 mousedown 冒泡到编辑器，否则会移动光标、关掉弹窗
  dom.addEventListener("mousedown", (e) => e.stopPropagation());

  if (s.kind === "number") buildNumber(view, dom, view.state.sliceDoc(s.from, s.to).trim());
  else if (s.kind === "vec2") buildVec2(view, dom, view.state.sliceDoc(s.from, s.to));
  else buildColor(view, dom, colorLiteralAt(view.state, s.from)!);
  return { dom };
}

function buildNumber(view: EditorView, dom: HTMLElement, text: string): void {
  const isInt = !/[.eE]/.test(text);
  const value = Number(text);
  const [lo, hi] = rangeFor(value, isInt);
  const decimals = decimalsFor(text, hi - lo);

  const input = document.createElement("input");
  input.type = "range";
  input.className = "sm-slider-range";
  input.min = String(lo);
  input.max = String(hi);
  input.step = isInt ? "1" : String(Math.pow(10, -decimals));
  input.value = String(value);

  const labels = document.createElement("div");
  labels.className = "sm-slider-labels";
  const [loEl, valEl, hiEl] = ["span", "span", "span"].map((t) => labels.appendChild(document.createElement(t)));
  loEl.textContent = formatValue(lo, isInt, 1);
  hiEl.textContent = formatValue(hi, isInt, 1);
  valEl.className = "sm-slider-value";
  valEl.textContent = text;

  input.addEventListener("input", () => {
    const out = formatValue(Number(input.value), isInt, decimals);
    valEl.textContent = out;
    write(view, out);
  });
  dom.append(input, labels);
  requestAnimationFrame(() => input.focus({ preventScroll: true }));
}

function buildVec2(view: EditorView, dom: HTMLElement, args: string): void {
  const parts = args.split(",").map((p) => p.trim());
  let x = Number(parts[0]);
  let y = Number(parts[1]);
  const r = Math.max(1, niceCeil(Math.max(Math.abs(x), Math.abs(y), 1e-6) * 1.5));
  const decimals = Math.max(decimalsFor(parts[0], 2 * r), decimalsFor(parts[1], 2 * r));

  const pad = document.createElement("div");
  pad.className = "sm-pad";
  pad.tabIndex = 0;
  const dot = pad.appendChild(document.createElement("div"));
  dot.className = "sm-pad-dot";
  const readout = document.createElement("div");
  readout.className = "sm-slider-labels";
  const [loEl, valEl, hiEl] = ["span", "span", "span"].map((t) => readout.appendChild(document.createElement(t)));
  loEl.textContent = formatFloat(-r, 1);
  hiEl.textContent = formatFloat(r, 1);
  valEl.className = "sm-slider-value";

  const render = () => {
    dot.style.left = `${((x + r) / (2 * r)) * 100}%`;
    dot.style.top = `${((r - y) / (2 * r)) * 100}%`;
    valEl.textContent = `${formatFloat(x, decimals)}, ${formatFloat(y, decimals)}`;
  };
  const commit = () => {
    render();
    write(view, valEl.textContent!);
  };
  render();

  const fromEvent = (e: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    const fx = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const fy = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
    x = (fx * 2 - 1) * r;
    y = (1 - fy * 2) * r;
    commit();
  };
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    pad.focus({ preventScroll: true });
    fromEvent(e);
  });
  pad.addEventListener("pointermove", (e) => {
    if (pad.hasPointerCapture(e.pointerId)) fromEvent(e);
  });
  // 方向键微调，Shift 加大步长
  pad.addEventListener("keydown", (e) => {
    const step = Math.pow(10, -decimals) * (e.shiftKey ? 10 : 1);
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!delta) return;
    e.preventDefault();
    x = Math.min(Math.max(x + delta[0] * step, -r), r);
    y = Math.min(Math.max(y + delta[1] * step, -r), r);
    commit();
  });
  dom.append(pad, readout);
  requestAnimationFrame(() => pad.focus({ preventScroll: true }));
}

// ------------------------------------------------------------------ 取色板

function rgbToHsv([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h / 6, max > 0 ? d / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

const toCss = (rgb: number[], a = 1) => `rgba(${rgb.map((c) => Math.round(c * 255)).join(", ")}, ${a})`;

/** 在元素上按住拖动，回调拿到 0..1 的相对坐标（y 向下）。 */
function dragArea(area: HTMLElement, onMove: (fx: number, fy: number) => void): void {
  const handle = (e: PointerEvent) => {
    const rect = area.getBoundingClientRect();
    onMove(
      Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    );
  };
  area.addEventListener("pointerdown", (e) => {
    area.setPointerCapture(e.pointerId);
    handle(e);
  });
  area.addEventListener("pointermove", (e) => {
    if (area.hasPointerCapture(e.pointerId)) handle(e);
  });
}

function buildColor(view: EditorView, dom: HTMLElement, literal: ColorLiteral): void {
  // 灰色（饱和度为 0）时色相无意义，单独记住，拖饱和度时不会跳回红色
  let [h, s, v] = rgbToHsv(literal.rgb);
  let alpha = literal.alpha;

  const el = (cls: string, parent: HTMLElement = dom) => {
    const node = parent.appendChild(document.createElement("div"));
    node.className = cls;
    return node;
  };
  const sv = el("sm-sv");
  sv.tabIndex = 0;
  const svDot = el("sm-sv-dot", sv);
  const hue = el("sm-strip sm-hue");
  const hueThumb = el("sm-strip-thumb", hue);
  const alphaStrip = alpha !== null ? el("sm-strip sm-alpha") : null;
  const alphaThumb = alphaStrip ? el("sm-strip-thumb", alphaStrip) : null;

  const info = el("sm-slider-labels sm-color-info");
  const chip = info.appendChild(document.createElement("span"));
  chip.className = "sm-color-chip";
  const valEl = info.appendChild(document.createElement("span"));
  valEl.className = "sm-slider-value";

  const text = () => {
    const parts = hsvToRgb(h, s, v).map((c) => formatFloat(c, 3));
    if (alpha !== null) parts.push(formatFloat(alpha, 3));
    return parts.join(", ");
  };
  const render = () => {
    const rgb = hsvToRgb(h, s, v);
    sv.style.setProperty("--hue", toCss(hsvToRgb(h, 1, 1)));
    svDot.style.left = `${s * 100}%`;
    svDot.style.top = `${(1 - v) * 100}%`;
    hueThumb.style.left = `${h * 100}%`;
    if (alphaStrip && alphaThumb && alpha !== null) {
      alphaStrip.style.setProperty("--opaque", toCss(rgb));
      alphaThumb.style.left = `${alpha * 100}%`;
    }
    chip.style.setProperty("--chip", toCss(rgb, alpha ?? 1));
    valEl.textContent = text();
  };
  const commit = () => {
    render();
    write(view, text());
  };
  render();

  dragArea(sv, (fx, fy) => {
    s = fx;
    v = 1 - fy;
    commit();
  });
  dragArea(hue, (fx) => {
    h = Math.min(fx, 0.9999);
    commit();
  });
  if (alphaStrip) {
    dragArea(alphaStrip, (fx) => {
      alpha = fx;
      commit();
    });
  }
  requestAnimationFrame(() => sv.focus({ preventScroll: true }));
}

// ------------------------------------------------------------------ 扩展

export const valueSliders: Extension = [
  sliderField,
  EditorView.domEventHandlers({
    mouseup(event, view) {
      if (event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false;
      const node = event.target as HTMLElement;
      // 色块自己会打开取色板（mousedown 时），这里不要再按光标位置把它关掉
      if (!node.closest(".cm-content") || node.closest(".cm-color-swatch")) return false;
      const sel = view.state.selection;
      if (sel.ranges.length !== 1 || !sel.main.empty) return false;
      const target = sliderFor(view.state, sel.main.head);
      const current = view.state.field(sliderField);
      if (target && current && target.from === current.from && target.kind === current.kind) return false;
      view.dispatch({ effects: target ? openSlider.of(target) : closeSlider.of(null) });
      return false;
    },
  }),
  Prec.high(
    keymap.of([
      {
        key: "Escape",
        run(view) {
          if (!view.state.field(sliderField)) return false;
          view.dispatch({ effects: closeSlider.of(null) });
          return true;
        },
      },
    ]),
  ),
];
