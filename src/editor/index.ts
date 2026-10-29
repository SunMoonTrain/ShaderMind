import { autocompletion, closeBrackets } from "@codemirror/autocomplete";
import { history } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput, indentUnit } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, search } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  countColumn,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
  type DecorationSet,
} from "@codemirror/view";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

import type { ShaderDiagnostic } from "../glsl";
import { fontStack, type EditorSettings } from "../settings";
import { glslCompletionSource, glslHover } from "./completion";
import { bracketColors, colorSwatches, numberScrub, wrapIndent } from "./decorations";
import { glsl } from "./glsl-language";
import { valueSliders } from "./sliders";
import { vscodeKeymap } from "./keymap";
import { findTheme } from "./themes";

// ------------------------------------------------------------------ 出错行底色

const setErrorLines = StateEffect.define<number[]>();
const errorLineMark = Decoration.line({ class: "cm-error-line" });

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setErrorLines)) continue;
      const ranges = [...new Set(effect.value)]
        .filter((n) => n >= 1 && n <= tr.state.doc.lines)
        .sort((a, b) => a - b)
        .map((n) => errorLineMark.range(tr.state.doc.line(n).from));
      value = Decoration.set(ranges);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ------------------------------------------------------------------ 静态外观

/** 颜色全部引用 CSS 变量（见 themes.ts），切主题不需要重建这里。 */
const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--ui-fg)",
    backgroundColor: "var(--ui-bg)",
    "--indent-marker-bg-color": "var(--ed-indent)",
    "--indent-marker-active-bg-color": "var(--ed-indent-active)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflowX: "auto" },
  ".cm-content": { caretColor: "var(--ed-cursor)", padding: "8px 0" },
  ".cm-line": { padding: "0 16px 0 6px" },
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--ed-cursor)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--ed-selection)",
  },
  ".cm-content ::selection": { backgroundColor: "transparent" },
  ".cm-activeLine": { backgroundColor: "var(--ed-active-line)" },
  ".cm-gutters": {
    backgroundColor: "var(--ui-bg)",
    color: "var(--ed-gutter-fg)",
    border: "none",
    paddingLeft: "4px",
  },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ed-gutter-active-fg)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 12px", minWidth: "36px" },
  ".cm-foldGutter .cm-gutterElement": {
    width: "18px",
    color: "var(--ui-fg-dim)",
    opacity: "0",
    transition: "opacity .15s",
    cursor: "pointer",
    textAlign: "center",
  },
  ".cm-gutters:hover .cm-foldGutter .cm-gutterElement": { opacity: "1" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--ui-input)",
    border: "1px solid var(--ui-border)",
    color: "var(--ui-fg-dim)",
    borderRadius: "4px",
    padding: "0 6px",
    margin: "0 4px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "var(--ed-bracket-match)",
    outline: "1px solid var(--ed-indent-active)",
    borderRadius: "2px",
  },
  ".cm-nonmatchingBracket": { color: "var(--ui-err) !important" },
  ".cm-selectionMatch": { backgroundColor: "var(--ed-selection-match)" },
  ".cm-searchMatch": { backgroundColor: "var(--ed-search-match)", outline: "none" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--ed-search-match-active)" },
  ".cm-error-line": { backgroundColor: "var(--ed-error-line)" },

  // 括号配对着色
  ".cm-bk-0": { color: "var(--bk-0)" },
  ".cm-bk-1": { color: "var(--bk-1)" },
  ".cm-bk-2": { color: "var(--bk-2)" },
  ".cm-bk-bad": { color: "var(--ui-err)" },

  // 诊断波浪线
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--ui-err)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--ui-warn)",
    textUnderlineOffset: "3px",
  },
  ".cm-lint-marker": { width: "0.9em", height: "0.9em" },
  ".cm-diagnostic": { padding: "6px 10px", borderLeft: "3px solid var(--ui-err)", fontFamily: "var(--ui-font)" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--ui-err)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--ui-warn)" },

  // 浮层
  ".cm-tooltip": {
    backgroundColor: "var(--ui-panel)",
    color: "var(--ui-fg)",
    border: "1px solid var(--ui-border)",
    borderRadius: "6px",
    boxShadow: "0 6px 20px var(--ui-shadow)",
  },
  // 补全说明浮窗是挂在补全列表里、定位到列表外面的，所以列表本身不能裁剪
  ".cm-tooltip-autocomplete": { overflow: "visible" },
  ".cm-tooltip.cm-tooltip-hover": { maxWidth: "520px" },
  ".cm-tooltip-autocomplete > ul": { maxHeight: "18em", padding: "3px", borderRadius: "6px" },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: "1px 8px 1px 4px !important",
    borderRadius: "4px",
    lineHeight: "1.7",
    display: "flex",
    alignItems: "center",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--ed-selection)",
    color: "var(--ui-fg)",
  },
  ".cm-completionLabel": { flex: "1" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--ui-accent-text)", fontWeight: "600" },
  ".cm-completionDetail": {
    marginLeft: "18px",
    fontStyle: "normal",
    color: "var(--ui-fg-dim)",
    fontSize: "0.88em",
    fontFamily: "var(--ui-font)",
  },
  ".cm-tooltip.cm-completionInfo": { padding: "0", maxWidth: "420px", marginLeft: "4px" },

  // 查找 / 跳转面板
  ".cm-panels": { backgroundColor: "var(--ui-panel)", color: "var(--ui-fg)", fontFamily: "var(--ui-font)" },
  ".cm-panels-top": { borderBottom: "1px solid var(--ui-border)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--ui-border)" },
  ".cm-panel.cm-search": { padding: "6px 30px 6px 10px", fontSize: "12px" },
  ".cm-panel.cm-search label": { fontSize: "12px", color: "var(--ui-fg-dim)" },
  ".cm-panel.cm-search input[type=checkbox]": { accentColor: "var(--ui-accent)", verticalAlign: "-2px" },
  ".cm-panel.cm-search [name=close]": { color: "var(--ui-fg-dim)", fontSize: "16px", right: "8px", top: "4px" },
  ".cm-textfield": {
    backgroundColor: "var(--ui-input)",
    color: "var(--ui-fg)",
    border: "1px solid var(--ui-border)",
    borderRadius: "4px",
    padding: "3px 6px",
    fontSize: "12px",
    outline: "none",
  },
  ".cm-textfield:focus": { borderColor: "var(--ui-accent)" },
  ".cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--ui-input)",
    color: "var(--ui-fg)",
    border: "1px solid var(--ui-border)",
    borderRadius: "4px",
    padding: "2px 8px",
    fontSize: "12px",
  },
  ".cm-button:hover": { backgroundColor: "var(--ui-hover)" },
  ".cm-panel.cm-gotoLine": { padding: "6px 10px", fontSize: "12px" },
});

const chinesePhrases = EditorState.phrases.of({
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  "by word": "全字匹配",
  regexp: "正则",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭",
  "current match": "当前匹配",
  "replaced $ matches": "已替换 $ 处",
  "replaced match on line $": "已替换第 $ 行的匹配",
  "on line": "行",
  "Go to line": "跳转到行",
  go: "跳转",
  "Folded lines": "已折叠",
  "Unfold line": "展开",
  "Fold line": "折叠",
  unfold: "展开",
  Diagnostics: "问题",
  "No diagnostics": "没有问题",
  "Control character": "控制字符",
  Completions: "补全",
});

// ------------------------------------------------------------------ 可切换的部分

const compartments = {
  dark: new Compartment(),
  font: new Compartment(),
  tab: new Compartment(),
  wrap: new Compartment(),
  gutters: new Compartment(),
  activeLine: new Compartment(),
  brackets: new Compartment(),
  indentGuides: new Compartment(),
  swatches: new Compartment(),
  sliders: new Compartment(),
  completion: new Compartment(),
};

function fontTheme(s: EditorSettings): Extension {
  const family = fontStack(s.fontFamily);
  const ligatures = s.ligatures ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0';
  return EditorView.theme({
    "&": { fontSize: `${s.fontSize}px` },
    ".cm-scroller": {
      fontFamily: family,
      lineHeight: String(s.lineHeight),
      fontFeatureSettings: ligatures,
    },
    ".cm-tooltip-autocomplete > ul": { fontFamily: `${family} !important`, fontSize: `${Math.max(11, s.fontSize - 1)}px` },
    ".sm-sig": { fontFamily: family },
  });
}

function reconfigure(s: EditorSettings): Record<keyof typeof compartments, Extension> {
  return {
    dark: EditorView.darkTheme.of(findTheme(s.theme).dark),
    font: fontTheme(s),
    tab: [EditorState.tabSize.of(s.tabSize), indentUnit.of(" ".repeat(s.tabSize))],
    wrap: s.wordWrap ? [EditorView.lineWrapping, wrapIndent] : [],
    gutters: [
      s.lineNumbers ? lineNumbers() : [],
      foldGutter({
        markerDOM(open) {
          const el = document.createElement("span");
          el.className = open ? "cm-fold-open" : "cm-fold-closed";
          el.textContent = open ? "⌄" : "›";
          return el;
        },
      }),
      lintGutter({ hoverTime: 200 }),
    ],
    activeLine: s.highlightActiveLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
    brackets: s.bracketColors ? bracketColors : [],
    indentGuides: s.indentGuides
      ? indentationMarkers({ highlightActiveBlock: true, markerType: "fullScope", thickness: 1, activeThickness: 1 })
      : [],
    swatches: s.colorSwatches ? colorSwatches : [],
    sliders: s.valueSliders ? valueSliders : [],
    completion: s.autocomplete
      ? autocompletion({ override: [glslCompletionSource], icons: true, maxRenderedOptions: 60, defaultKeymap: false })
      : [],
  };
}

// ------------------------------------------------------------------ 对外接口

export interface CursorInfo {
  line: number;
  col: number;
  selections: number;
  selectedChars: number;
}

export interface EditorHandle {
  view: EditorView;
  getSource(): string;
  setSource(source: string): void;
  setProblems(diagnostics: ShaderDiagnostic[]): void;
  applySettings(settings: EditorSettings): void;
  goToLine(line: number): void;
  focus(): void;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  settings: EditorSettings;
  /**
   * 每次文档变化时调用（未做防抖，防抖在调用方）。
   * live 为 true 表示改动来自拖动调值 / 滑条 / 取色，调用方应立即重编译。
   */
  onChange(source: string, live: boolean): void;
  onCursor(info: CursorInfo): void;
}

function cursorInfo(state: EditorState): CursorInfo {
  const main = state.selection.main;
  const line = state.doc.lineAt(main.head);
  return {
    line: line.number,
    col: countColumn(line.text.slice(0, main.head - line.from), state.tabSize) + 1,
    selections: state.selection.ranges.length,
    selectedChars: state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0),
  };
}

/** 编译器报的错没有列号：优先定位到消息里用引号标出的记号，否则标整行（去掉缩进）。 */
function toLintDiagnostics(state: EditorState, list: ShaderDiagnostic[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const d of list) {
    if (d.line === null) continue;
    const line = state.doc.line(Math.min(Math.max(d.line, 1), state.doc.lines));
    let from = line.from + (line.text.length - line.text.trimStart().length);
    let to = line.to;
    const quoted = /'([^']+)'/.exec(d.message)?.[1]?.trim();
    if (quoted) {
      const idx = /^\w+$/.test(quoted)
        ? line.text.search(new RegExp(`\\b${quoted}\\b`))
        : line.text.indexOf(quoted);
      if (idx >= 0) {
        from = line.from + idx;
        to = from + quoted.length;
      }
    }
    out.push({ from, to: Math.max(from, to), severity: d.severity, message: d.message, source: "GLSL" });
  }
  return out;
}

/** 这些来源的改动需要立即看到画面变化，不走防抖。 */
const LIVE_EVENTS = ["input.scrub", "input.slider", "input.color"];

export function createEditor(options: EditorOptions): EditorHandle {
  const initial = reconfigure(options.settings);
  const dynamic = (Object.keys(compartments) as (keyof typeof compartments)[]).map((k) =>
    compartments[k].of(initial[k]),
  );

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        ...dynamic,
        EditorState.allowMultipleSelections.of(true),
        // Alt+单击 添加光标、Shift+Alt+拖动 列选择 —— 与 VS Code 一致
        EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
        rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
        highlightSpecialChars(),
        history(),
        drawSelection({ cursorBlinkRate: 1100 }),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches({ highlightWordAroundCursor: true, minSelectionLength: 2 }),
        search({ top: true }),
        scrollPastEnd(),
        glsl(),
        glslHover,
        numberScrub,
        errorLineField,
        keymap.of(vscodeKeymap()),
        baseTheme,
        chinesePhrases,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const live = update.transactions.some((tr) =>
              LIVE_EVENTS.some((event) => tr.isUserEvent(event)),
            );
            options.onChange(update.state.doc.toString(), live);
          }
          if (update.docChanged || update.selectionSet) options.onCursor(cursorInfo(update.state));
        }),
      ],
    }),
  });
  options.onCursor(cursorInfo(view.state));

  return {
    view,
    getSource: () => view.state.doc.toString(),
    setSource(source) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    },
    setProblems(list) {
      view.dispatch(setDiagnostics(view.state, toLintDiagnostics(view.state, list)));
      view.dispatch({
        effects: setErrorLines.of(
          list.filter((d) => d.severity === "error" && d.line !== null).map((d) => d.line!),
        ),
      });
    },
    applySettings(settings) {
      const next = reconfigure(settings);
      view.dispatch({
        effects: (Object.keys(compartments) as (keyof typeof compartments)[]).map((k) =>
          compartments[k].reconfigure(next[k]),
        ),
      });
    },
    goToLine(line) {
      const clamped = Math.min(Math.max(line, 1), view.state.doc.lines);
      const pos = view.state.doc.line(clamped).from;
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      view.focus();
    },
    focus: () => view.focus(),
  };
}
