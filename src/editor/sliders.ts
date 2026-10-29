import { Prec, StateEffect, StateField, Transaction, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";

import { formatFloat, numberAt } from "./decorations";

/**
 * 仿 The Book of Shaders 编辑器的数值调节器：
 * - 单击数字字面量，下方弹出滑条；
 * - 单击 `vec2(x, y)` 的 vec2 或括号，弹出二维调节板。
 * 拖动时直接改写源码（userEvent 为 input.slider），调用方据此立即重编译。
 */

interface SliderState {
  kind: "number" | "vec2";
  /** 被调节的文本范围：数字本身，或 vec2 括号内的参数列表 */
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
      const head = tr.state.selection.main.head;
      const { from, to } = value.kind === "vec2" ? vec2Around(tr.state, value.from) ?? value : value;
      if (head < from - 5 || head > to + 1) return null;
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

function inComment(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  const slash = line.text.indexOf("//");
  if (slash >= 0 && line.from + slash < pos) return true;
  const before = state.sliceDoc(Math.max(0, pos - 20_000), pos);
  return before.lastIndexOf("/*") > before.lastIndexOf("*/");
}

/** 单击后决定弹出哪种调节器；数字优先于 vec2。 */
function sliderFor(state: EditorState, pos: number): Omit<SliderState, "create"> | null {
  if (inComment(state, pos)) return null;
  const num = numberAt(state, pos);
  if (num) return { kind: "number", from: num.from, to: num.to };
  const vec = vec2Around(state, pos);
  if (vec) return { kind: "vec2", from: vec.from, to: vec.to };
  return null;
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
  else buildVec2(view, dom, view.state.sliceDoc(s.from, s.to));
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

// ------------------------------------------------------------------ 扩展

export const valueSliders: Extension = [
  sliderField,
  EditorView.domEventHandlers({
    mouseup(event, view) {
      if (event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return false;
      if (!(event.target as HTMLElement).closest(".cm-content")) return false;
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
