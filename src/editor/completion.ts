import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import {
  APP_SYMBOLS,
  BOOLEANS,
  BUILTIN_FUNCTIONS,
  BUILTIN_VARIABLES,
  KEYWORDS,
  QUALIFIERS,
  SNIPPETS,
  TYPE_DOCS,
  TYPES,
  lookupSymbol,
  type SymbolDoc,
} from "./glsl-data";

// ------------------------------------------------------------------ 签名着色

const typeWords = new Set([...TYPES, "genType", "genIType", "genUType", "genBType", "vec", "bvec", "ivec", "mat"]);
const qualifierWords = new Set(QUALIFIERS);

/** 给签名做一个轻量的着色：类型、函数名、限定符分别上色。 */
function renderSignature(signature: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "sm-sig";
  for (const line of signature.split("\n")) {
    const row = document.createElement("div");
    const re = /([A-Za-z_]\w*)(\s*\()?|[^A-Za-z_]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const span = document.createElement("span");
      const word = m[1];
      if (word) {
        span.textContent = word;
        if (m[2]) span.className = "sm-tok-fn";
        else if (typeWords.has(word)) span.className = "sm-tok-type";
        else if (qualifierWords.has(word)) span.className = "sm-tok-qual";
        else span.className = "sm-tok-param";
        row.appendChild(span);
        if (m[2]) row.appendChild(document.createTextNode(m[2]));
      } else {
        span.textContent = m[0];
        row.appendChild(span);
      }
    }
    box.appendChild(row);
  }
  return box;
}

export function renderSymbolInfo(kind: string, doc: SymbolDoc, extra?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "sm-info";
  el.appendChild(renderSignature(doc.signature));
  if (doc.doc) {
    const d = document.createElement("div");
    d.className = "sm-doc";
    d.textContent = doc.doc;
    el.appendChild(d);
  }
  const k = document.createElement("div");
  k.className = "sm-kind";
  k.textContent = extra ? `${kind} · ${extra}` : kind;
  el.appendChild(k);
  return el;
}

// ------------------------------------------------------------------ 用户符号

interface UserSymbol {
  name: string;
  kind: "function" | "variable" | "constant" | "struct";
  signature: string;
  line: number;
}

/** 把注释替换成等长空白，保持偏移和行号不变。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

const TYPE_ALT = TYPES.join("|");
const FN_DEF = new RegExp(`\\b(${TYPE_ALT}|[A-Z]\\w*)\\s+([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{`, "g");
const VAR_DECL = new RegExp(`\\b(?:(const)\\s+)?(${TYPE_ALT})\\s+([A-Za-z_]\\w*)(?!\\s*\\()`, "g");
const DEFINE = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)(.*)$/gm;
const STRUCT = /\bstruct\s+([A-Za-z_]\w*)/g;

let cacheSource = "";
let cacheSymbols: UserSymbol[] = [];

function lineOf(src: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

export function collectUserSymbols(source: string): UserSymbol[] {
  if (source === cacheSource) return cacheSymbols;
  const src = stripComments(source);
  const seen = new Map<string, UserSymbol>();
  const add = (s: UserSymbol) => {
    if (!seen.has(s.name) && !(s.name in BUILTIN_FUNCTIONS) && s.name !== "main") seen.set(s.name, s);
  };
  let m: RegExpExecArray | null;

  for (FN_DEF.lastIndex = 0; (m = FN_DEF.exec(src)); ) {
    const params = m[3].replace(/\s+/g, " ").trim();
    add({ name: m[2], kind: "function", signature: `${m[1]} ${m[2]}(${params})`, line: lineOf(src, m.index) });
  }
  for (DEFINE.lastIndex = 0; (m = DEFINE.exec(src)); ) {
    add({ name: m[1], kind: "constant", signature: `#define ${m[1]}${m[2].trimEnd()}`, line: lineOf(src, m.index) });
  }
  for (STRUCT.lastIndex = 0; (m = STRUCT.exec(src)); ) {
    add({ name: m[1], kind: "struct", signature: `struct ${m[1]}`, line: lineOf(src, m.index) });
  }
  for (VAR_DECL.lastIndex = 0; (m = VAR_DECL.exec(src)); ) {
    const sig = `${m[1] ? "const " : ""}${m[2]} ${m[3]}`;
    add({ name: m[3], kind: "variable", signature: sig, line: lineOf(src, m.index) });
  }

  cacheSource = source;
  cacheSymbols = [...seen.values()];
  return cacheSymbols;
}

// ------------------------------------------------------------------ 补全

function infoFor(kind: string, doc: SymbolDoc, extra?: string) {
  return () => renderSymbolInfo(kind, doc, extra);
}

const staticOptions: Completion[] = [
  ...KEYWORDS.map((label) => ({ label, type: "keyword", boost: -1 })),
  ...QUALIFIERS.map((label) => ({ label, type: "keyword", detail: "限定符", boost: -2 })),
  ...BOOLEANS.map((label) => ({ label, type: "constant", boost: -1 })),
  ...TYPES.map((label) => ({
    label,
    type: "type",
    info: TYPE_DOCS[label] ? infoFor("类型", { signature: label, doc: TYPE_DOCS[label] }) : undefined,
  })),
  ...Object.entries(BUILTIN_FUNCTIONS).map(([label, doc]) => ({
    label,
    type: "function",
    detail: "内置",
    info: infoFor("内置函数", doc),
  })),
  ...Object.entries(APP_SYMBOLS).map(([label, doc]) => ({
    label,
    type: "variable",
    detail: doc.signature.split(" ").slice(-2, -1)[0],
    boost: 3,
    info: infoFor("内置 uniform", doc),
  })),
  ...Object.entries(BUILTIN_VARIABLES).map(([label, doc]) => ({
    label,
    type: "variable",
    detail: "内置",
    boost: 1,
    info: infoFor("内置变量", doc),
  })),
  ...SNIPPETS.map((s) =>
    snippetCompletion(s.template, { label: s.label, detail: s.detail, type: "snippet", boost: -3 }),
  ),
];

const SWIZZLES = [
  "x", "y", "z", "w", "xy", "xz", "yz", "yx", "zy", "xyz", "xxx",
  "r", "g", "b", "a", "rg", "rgb", "rgba", "bgr", "st",
];

const PREPROCESSOR = ["define", "undef", "if", "ifdef", "ifndef", "else", "elif", "endif", "error", "pragma", "extension", "line"];

function isInCommentOrString(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1);
  return /comment|string/i.test(node.name);
}

export function glslCompletionSource(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context;
  if (isInCommentOrString(state, pos)) return null;

  // 行首 # 之后：预处理指令
  const pp = context.matchBefore(/^\s*#\s*\w*/);
  if (pp) {
    const word = context.matchBefore(/\w*/)!;
    return {
      from: word.from,
      options: PREPROCESSOR.map((label) => ({ label, type: "keyword", detail: "预处理" })),
      validFor: /^\w*$/,
    };
  }

  // 点号之后：向量分量
  // 数字里的小数点（1.5）不算：点号前必须是标识符或右括号
  const member = context.matchBefore(/(?:[A-Za-z_]\w*|[)\]])\.\w*/);
  if (member) {
    const from = state.sliceDoc(member.from, member.to).indexOf(".") + member.from + 1;
    return {
      from,
      options: SWIZZLES.map((label, i) => ({ label, type: "property", boost: -i })),
      validFor: /^[xyzwrgbastpq]*$/,
    };
  }

  const word = context.matchBefore(/[A-Za-z_]\w*/);
  if (!word && !context.explicit) return null;
  if (word && /\d/.test(state.sliceDoc(word.from - 1, word.from))) return null;

  const user = collectUserSymbols(state.doc.toString()).map<Completion>((s) => ({
    label: s.name,
    type: s.kind === "struct" ? "type" : s.kind,
    detail: s.kind === "function" ? "函数" : s.kind === "constant" ? "宏" : s.signature.split(" ").slice(-2, -1)[0],
    boost: 2,
    info: () =>
      renderSymbolInfo(
        s.kind === "function" ? "用户函数" : s.kind === "constant" ? "宏" : s.kind === "struct" ? "结构体" : "变量",
        { signature: s.signature, doc: "" },
        `第 ${s.line} 行`,
      ),
  }));

  return {
    from: word ? word.from : pos,
    options: [...user, ...staticOptions],
    validFor: /^\w*$/,
  };
}

// ------------------------------------------------------------------ 悬停

export const glslHover = hoverTooltip(
  (view, pos, side) => {
    const line = view.state.doc.lineAt(pos);
    let start = pos;
    let end = pos;
    while (start > line.from && /\w/.test(line.text[start - line.from - 1])) start--;
    while (end < line.to && /\w/.test(line.text[end - line.from])) end++;
    if ((start === pos && side < 0) || (end === pos && side > 0) || start === end) return null;

    const word = line.text.slice(start - line.from, end - line.from);
    if (!/^[A-Za-z_]/.test(word)) return null;
    if (/comment/i.test(syntaxTree(view.state).resolveInner(pos, 1).name)) return null;
    // 分量访问（.xy）不提示
    if (line.text[start - line.from - 1] === ".") return null;

    let dom: HTMLElement | null = null;
    const builtin = lookupSymbol(word);
    if (builtin) {
      dom = renderSymbolInfo(builtin.kind, builtin.doc);
    } else {
      const user = collectUserSymbols(view.state.doc.toString()).find((s) => s.name === word);
      if (user) {
        const kind = { function: "用户函数", variable: "变量", constant: "宏", struct: "结构体" }[user.kind];
        dom = renderSymbolInfo(kind, { signature: user.signature, doc: "" }, `第 ${user.line} 行`);
      }
    }
    if (!dom) return null;
    const content = dom;
    return { pos: start, end, above: true, create: () => ({ dom: content }) };
  },
  { hoverTime: 350 },
);
