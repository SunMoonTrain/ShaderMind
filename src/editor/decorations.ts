import { EditorSelection, Transaction, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  RectangleMarker,
  ViewPlugin,
  WidgetType,
  layer,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { openColorEditor } from "./sliders";

// ================================================================== 括号配对着色

const OPEN = "([{";
const CLOSE = ")]}";
const depthMarks = [0, 1, 2].map((i) => Decoration.mark({ class: `cm-bk cm-bk-${i}` }));
const unmatchedMark = Decoration.mark({ class: "cm-bk cm-bk-bad" });

/**
 * 扫描全文计算括号深度（跳过注释和字符串），只给可见范围内的括号加装饰。
 * 着色器源码通常只有几百行，全文扫描的开销可以忽略。
 */
function computeBrackets(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  if (text.length > 400_000) return Decoration.none;

  const marks: Range<Decoration>[] = [];
  const stack: { ch: string; pos: number }[] = [];
  const visible = view.visibleRanges;
  const isVisible = (pos: number) => visible.some((r) => pos >= r.from && pos < r.to);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (c === '"') {
      const end = text.indexOf('"', i + 1);
      i = end < 0 ? text.length : end;
      continue;
    }

    const open = OPEN.indexOf(c);
    if (open >= 0) {
      stack.push({ ch: c, pos: i });
      if (isVisible(i)) marks.push(depthMarks[(stack.length - 1) % 3].range(i, i + 1));
      continue;
    }
    const close = CLOSE.indexOf(c);
    if (close >= 0) {
      const top = stack[stack.length - 1];
      if (top && top.ch === OPEN[close]) {
        stack.pop();
        if (isVisible(i)) marks.push(depthMarks[stack.length % 3].range(i, i + 1));
      } else if (isVisible(i)) {
        marks.push(unmatchedMark.range(i, i + 1));
      }
    }
  }
  // 没闭合的左括号
  for (const s of stack) {
    if (!isVisible(s.pos)) continue;
    const idx = marks.findIndex((m) => m.from === s.pos);
    if (idx >= 0) marks[idx] = unmatchedMark.range(s.pos, s.pos + 1);
  }
  return Decoration.set(marks, true);
}

export const bracketColors: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeBrackets(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = computeBrackets(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ================================================================== 颜色色块

const NUM_SRC = String.raw`-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?`;
const COLOR_RE = new RegExp(String.raw`\bvec([34])\s*\(\s*(${NUM_SRC}(?:\s*,\s*${NUM_SRC}){0,3})\s*\)`, "g");

function toHex(v: number): string {
  return Math.round(Math.min(Math.max(v, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** GLSL 的 float 字面量必须带小数点。 */
export function formatFloat(v: number, decimals = 3): string {
  let s = v.toFixed(decimals);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, ".0");
  if (s === "-0.0") s = "0.0";
  return s;
}

interface ColorLiteral {
  /** 参数列表（括号内）在文档中的范围 */
  from: number;
  to: number;
  rgb: [number, number, number];
  alpha: string | null;
}

function parseArgs(args: string, components: number): Pick<ColorLiteral, "rgb" | "alpha"> | null {
  const parts = args.split(",").map((s) => s.trim());
  const nums = parts.map(Number);
  // 只把分量全在 0..1 之内的当作颜色，超出范围的（比如位置、HDR 强度）不显示色块
  if (nums.some((n) => !(n >= 0 && n <= 1))) return null;
  if (parts.length === 1) return { rgb: [nums[0], nums[0], nums[0]], alpha: components === 4 ? parts[0] : null };
  if (components === 3 && parts.length === 3) return { rgb: [nums[0], nums[1], nums[2]], alpha: null };
  if (components === 4 && parts.length === 4) return { rgb: [nums[0], nums[1], nums[2]], alpha: parts[3] };
  return null;
}

let picker: HTMLInputElement | null = null;

function openPicker(view: EditorView, literal: ColorLiteral, anchor: HTMLElement): void {
  picker?.remove();
  const input = document.createElement("input");
  input.type = "color";
  input.className = "cm-color-picker";
  input.value = "#" + literal.rgb.map(toHex).join("");
  const rect = anchor.getBoundingClientRect();
  input.style.left = `${rect.left}px`;
  input.style.top = `${rect.bottom}px`;
  document.body.appendChild(input);
  picker = input;

  const from = literal.from;
  let to = literal.to;
  const suffix = literal.alpha !== null ? `, ${literal.alpha}` : "";

  input.addEventListener("input", () => {
    const hex = input.value;
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const text = rgb.map((v) => formatFloat(v)).join(", ") + suffix;
    // 用户可能在拾色期间改了别处，确认原位置还是一组合法参数再替换
    if (!/^[-\d.eE,\s]+$/.test(view.state.sliceDoc(from, to))) return;
    view.dispatch({
      changes: { from, to, insert: text },
      annotations: Transaction.userEvent.of("input.color"),
    });
    to = from + text.length;
  });
  const cleanup = () => {
    input.remove();
    if (picker === input) picker = null;
  };
  input.addEventListener("change", cleanup);
  input.addEventListener("blur", cleanup);

  // 必须在同一个用户手势里触发，浏览器才会弹出拾色器
  try {
    input.showPicker();
  } catch {
    input.click();
  }
}

class SwatchWidget extends WidgetType {
  constructor(readonly literal: ColorLiteral) {
    super();
  }
  eq(other: SwatchWidget) {
    const a = this.literal;
    const b = other.literal;
    return a.from === b.from && a.to === b.to && a.alpha === b.alpha && a.rgb.every((v, i) => v === b.rgb[i]);
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-color-swatch";
    el.title = "点击编辑颜色";
    el.style.setProperty("--swatch", "#" + this.literal.rgb.map(toHex).join(""));
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 优先用编辑器内的取色板（带透明度、拖动实时生效）；没开数值滑条时退回系统取色器
      if (!openColorEditor(view, this.literal.from)) openPicker(view, this.literal, el);
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function computeSwatches(view: EditorView): DecorationSet {
  const widgets: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    COLOR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = COLOR_RE.exec(text))) {
      const parsed = parseArgs(m[2], Number(m[1]));
      if (!parsed) continue;
      const argsStart = from + m.index + m[0].indexOf(m[2]);
      const literal: ColorLiteral = { from: argsStart, to: argsStart + m[2].length, ...parsed };
      widgets.push(Decoration.widget({ widget: new SwatchWidget(literal), side: -1 }).range(from + m.index));
    }
  }
  return Decoration.set(widgets, true);
}

export const colorSwatches: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeSwatches(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = computeSwatches(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ================================================================== 数字拖动调值

interface NumberHit {
  from: number;
  to: number;
  text: string;
}

/** 找到 pos 所在的数字字面量；标识符里的数字（vec3 的 3）不算。 */
export function numberAt(state: EditorState, pos: number): NumberHit | null {
  const line = state.doc.lineAt(pos);
  const re = /(\d+\.\d*|\.\d+|\d+)(?![\w.])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line.text))) {
    let start = m.index;
    const end = m.index + m[0].length;
    if (start > 0 && /[A-Za-z_\d]/.test(line.text[start - 1])) continue;
    if (pos < line.from + start || pos > line.from + end) continue;
    // 一元负号：前面（跳过空白）是运算符、括号、逗号或行首
    if (line.text[start - 1] === "-") {
      const before = line.text.slice(0, start - 1).trimEnd();
      if (before === "" || /[(,=+\-*/<>?:[{!&|]$/.test(before)) start -= 1;
    }
    return { from: line.from + start, to: line.from + end, text: line.text.slice(start, end) };
  }
  return null;
}

function decimalsOf(text: string): number {
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : Math.max(1, text.length - dot - 1);
}

/**
 * Alt + 左右拖动数字即可调值（Shift 同时按住为精调）。
 * Alt + 单击（不拖动）仍然是添加光标，和 VS Code 一致。
 */
export const numberScrub: Extension = [
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.altKey || event.button !== 0 || event.shiftKey) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const hit = numberAt(view.state, pos);
      if (!hit) return false;

      event.preventDefault();
      const isFloat = hit.text.includes(".");
      let decimals = decimalsOf(hit.text);
      const from = hit.from;
      let to = hit.to;
      let base = Number(hit.text);
      let baseX = event.clientX;
      let fine = false;
      let dragging = false;

      const onMove = (e: MouseEvent) => {
        const dx = e.clientX - baseX;
        if (!dragging && Math.abs(dx) < 3) return;
        if (!dragging) {
          dragging = true;
          view.dom.classList.add("cm-scrubbing");
        }
        if (e.shiftKey !== fine) {
          // 切换精调时以当前值为新的起点，避免数值跳变；精调 = 多一位小数
          base = Number(view.state.sliceDoc(from, to));
          baseX = e.clientX;
          fine = e.shiftKey;
          if (fine && isFloat) decimals += 1;
          return;
        }
        // 每 2 像素变化一个最小单位（最后一位小数）
        const step = isFloat ? Math.pow(10, -decimals) : 1;
        const value = base + Math.round(dx / 2) * step;
        const text = isFloat ? value.toFixed(decimals) : String(Math.round(value));
        if (text === view.state.sliceDoc(from, to)) return;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          annotations: Transaction.userEvent.of("input.scrub"),
        });
        to = from + text.length;
      };
      const onUp = (e: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        view.dom.classList.remove("cm-scrubbing");
        if (!dragging) {
          // 没拖动：当作 Alt+单击添加光标
          const p = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? pos;
          view.dispatch({ selection: view.state.selection.addRange(EditorSelection.cursor(p)) });
        }
        view.focus();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return true;
    },
    mousemove(event, view) {
      const hover = event.altKey && !event.shiftKey;
      let onNumber = false;
      if (hover) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        onNumber = pos !== null && numberAt(view.state, pos) !== null;
      }
      view.dom.classList.toggle("cm-scrub-hover", onNumber);
      return false;
    },
  }),
];


// ================================================================== 折行悬挂缩进

/**
 * 自动换行时让续行和这一行的代码对齐（VS Code 的 wrappingIndent: same）。
 * 做法：整行 padding-left 加上缩进宽度，再用负的 text-indent 把第一行拉回原位。
 */
function computeWrapIndent(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = [];
  const tabSize = view.state.tabSize;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const lead = /^[ \t]*/.exec(line.text)![0];
      if (lead.length > 0 && lead.length < line.length) {
        let cols = 0;
        for (const ch of lead) cols = ch === "\t" ? cols + tabSize - (cols % tabSize) : cols + 1;
        marks.push(
          Decoration.line({
            attributes: { style: `padding-left: ${cols}ch; text-indent: -${cols}ch` },
          }).range(line.from),
        );
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(marks);
}

export const wrapIndent: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeWrapIndent(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = computeWrapIndent(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ================================================================== 选区占满行高

/** 把文档坐标 y 吸附到最近的行边界（自动换行的一行文档会占好几个视觉行，按视觉行算）。 */
function snapToRow(view: EditorView, docY: number): number {
  const block = view.lineBlockAtHeight(docY);
  const rows = Math.max(1, Math.round(block.height / view.defaultLineHeight));
  const rowHeight = block.height / rows;
  return block.top + Math.round((docY - block.top) / rowHeight) * rowHeight;
}

/**
 * 替换 drawSelection 自带的选区层。
 * 自带的选区在“只选了一部分的行”上取的是字形框的上下沿，行高大于 1 时比行矮一截、
 * 上下各缩进去一点，和当前行底色、整行选中的部分对不齐。这里沿用它算出的矩形，
 * 只把上下边吸附到最近的行边界，选区就和行底色一样高。
 */
export const fullHeightSelection: Extension = [
  layer({
    above: false,
    class: "sm-selection-layer",
    update: (u) => u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged,
    markers(view) {
      // 标记的 top 相对于滚动容器的内容原点（和 CodeMirror 内部的 getBase 一致），换算成文档坐标再吸附
      const scroller = view.scrollDOM.getBoundingClientRect();
      const baseTop = scroller.top - view.scrollDOM.scrollTop * view.scaleY;
      const toDoc = (y: number) => (y + baseTop - view.documentTop) / view.scaleY;
      const fromDoc = (y: number) => y * view.scaleY + view.documentTop - baseTop;

      const markers: RectangleMarker[] = [];
      for (const range of view.state.selection.ranges) {
        if (range.empty) continue;
        for (const m of RectangleMarker.forRange(view, "cm-selectionBackground", range)) {
          const top = fromDoc(snapToRow(view, toDoc(m.top)));
          const bottom = fromDoc(snapToRow(view, toDoc(m.top + m.height)));
          if (bottom > top) markers.push(new RectangleMarker("cm-selectionBackground", m.left, top, m.width, bottom - top));
        }
      }
      return markers;
    },
  }),
  // 隐藏 drawSelection 自带的那一层（光标层不受影响）
  EditorView.theme({ ".cm-selectionLayer": { display: "none" } }),
];
