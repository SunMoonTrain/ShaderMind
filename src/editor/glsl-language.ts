import {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
  foldService,
  matchBrackets,
  syntaxHighlighting,
  type StreamParser,
} from "@codemirror/language";
import { Tag, tags as t } from "@lezer/highlight";
import {
  APP_SYMBOLS,
  BOOLEANS,
  BUILTIN_FUNCTIONS,
  BUILTIN_VARIABLES,
  KEYWORDS,
  QUALIFIERS,
  TYPES,
} from "./glsl-data";

const keywordSet = new Set(KEYWORDS);
const qualifierSet = new Set(QUALIFIERS);
const typeSet = new Set(TYPES);
const boolSet = new Set(BOOLEANS);

interface GlslState {
  inBlockComment: boolean;
  /** 未闭合的 ( [ { 数量，用来算缩进 */
  depth: number;
  /** 上一个有效 token 是 "."，下一个标识符按分量 / 成员着色 */
  afterDot: boolean;
  /** 刚读到 #define，下一个标识符是宏名 */
  afterDefine: boolean;
}

/**
 * 括号用一个独立的 tag，不挂在 punctuation 下面：高亮样式不给它上色，
 * 颜色完全交给括号配对着色（decorations.ts）。节点类型统一，括号匹配照常工作。
 */
const bracketTag = Tag.define();

const NUMBER = /^(?:0[xX][0-9a-fA-F]+[uU]?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fFuU]?)/;
const OPERATOR = /^(?:<<=|>>=|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||\^\^|[-+*/%&|^]=|[-+*/%<>=!~&|^?:])/;

/**
 * 分词器返回的名字通过 tokenTable 映射到 lezer 的高亮 tag。
 * 名字同时也是语法树节点名，补全里用它判断光标是否在注释中。
 */
const parser: StreamParser<GlslState> = {
  name: "glsl",

  startState: () => ({ inBlockComment: false, depth: 0, afterDot: false, afterDefine: false }),

  copyState: (s) => ({ ...s }),

  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo("*/")) {
        stream.pos += 2;
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "blockComment";
    }

    if (stream.sol()) state.afterDefine = false;
    if (stream.eatSpace()) return null;

    if (stream.match("//")) {
      stream.skipToEnd();
      return "lineComment";
    }
    if (stream.match("/*")) {
      state.inBlockComment = true;
      if (stream.skipTo("*/")) {
        stream.pos += 2;
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }
      return "blockComment";
    }

    // 预处理指令只在行首（允许前导空白）出现
    if (stream.peek() === "#" && stream.string.slice(0, stream.pos).trim() === "") {
      const m = stream.match(/^#\s*[A-Za-z_]*/) as RegExpMatchArray | null;
      state.afterDefine = !!m && /define$/.test(m[0]);
      return "preprocessor";
    }

    if (stream.match(NUMBER)) {
      state.afterDot = false;
      return "number";
    }

    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current();
      const wasAfterDot = state.afterDot;
      state.afterDot = false;

      if (state.afterDefine) {
        state.afterDefine = false;
        return "macro";
      }
      if (wasAfterDot) return "property";
      if (keywordSet.has(word)) return word === "struct" ? "definitionKeyword" : "keyword";
      if (qualifierSet.has(word)) return "qualifier";
      if (typeSet.has(word)) return "type";
      if (boolSet.has(word)) return "bool";
      if (word in APP_SYMBOLS) return "uniform";
      if (word in BUILTIN_VARIABLES || word.startsWith("gl_")) return "builtinVar";

      const isCall = stream.match(/^\s*\(/, false);
      if (isCall) return word in BUILTIN_FUNCTIONS ? "builtinFunction" : "function";
      if (/^[A-Z][A-Z0-9_]+$/.test(word)) return "constant";
      return "variable";
    }

    const ch = stream.next()!;
    if (ch === ".") {
      state.afterDot = true;
      return "punctuation";
    }
    state.afterDot = false;

    if (ch === "(" || ch === "[" || ch === "{") {
      state.depth++;
      return "bracket";
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      state.depth = Math.max(0, state.depth - 1);
      return "bracket";
    }
    if (ch === '"') {
      stream.skipTo('"') ? stream.next() : stream.skipToEnd();
      return "string";
    }
    if (ch === ";" || ch === ",") return "punctuation";

    stream.backUp(1);
    if (stream.match(OPERATOR)) return "operator";
    stream.next();
    return null;
  },

  indent(state, textAfter, cx) {
    const closing = /^\s*[}\])]/.test(textAfter) ? 1 : 0;
    return Math.max(0, state.depth - closing) * cx.unit;
  },

  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"'] },
    indentOnInput: /^\s*[}\])]$/,
  },

  tokenTable: {
    keyword: t.controlKeyword,
    definitionKeyword: t.definitionKeyword,
    qualifier: t.modifier,
    type: t.typeName,
    bool: t.bool,
    uniform: t.special(t.variableName),
    builtinVar: t.standard(t.variableName),
    builtinFunction: t.standard(t.function(t.variableName)),
    function: t.function(t.variableName),
    variable: t.variableName,
    constant: t.constant(t.variableName),
    macro: t.macroName,
    property: t.propertyName,
    number: t.number,
    string: t.string,
    lineComment: t.lineComment,
    blockComment: t.blockComment,
    preprocessor: t.processingInstruction,
    operator: t.operator,
    punctuation: t.punctuation,
    bracket: bracketTag,
  },
};

export const glslLanguage = StreamLanguage.define(parser);

/** 语法高亮只引用 CSS 变量，具体颜色由 themes.ts 写到 :root。 */
export const glslHighlightStyle = HighlightStyle.define([
  { tag: [t.controlKeyword, t.definitionKeyword], color: "var(--syn-keyword)" },
  { tag: t.modifier, color: "var(--syn-qualifier)" },
  { tag: t.typeName, color: "var(--syn-type)" },
  { tag: t.bool, color: "var(--syn-bool)" },
  { tag: t.special(t.variableName), color: "var(--syn-uniform)" },
  { tag: t.standard(t.variableName), color: "var(--syn-builtin-var)" },
  { tag: t.standard(t.function(t.variableName)), color: "var(--syn-builtin-fn)" },
  { tag: t.function(t.variableName), color: "var(--syn-function)" },
  { tag: t.variableName, color: "var(--syn-variable)" },
  { tag: [t.constant(t.variableName), t.macroName], color: "var(--syn-macro)" },
  { tag: t.propertyName, color: "var(--syn-property)" },
  { tag: t.number, color: "var(--syn-number)" },
  { tag: t.string, color: "var(--syn-string)" },
  { tag: [t.lineComment, t.blockComment], color: "var(--syn-comment)", fontStyle: "var(--syn-comment-style)" },
  { tag: t.processingInstruction, color: "var(--syn-preprocessor)" },
  { tag: t.operator, color: "var(--syn-operator)" },
  { tag: t.punctuation, color: "var(--syn-punctuation)" },
]);

/** 以花括号为单位折叠：行里最后一个不在注释里的 "{" 到与之配对的 "}"。 */
const braceFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const commentAt = line.text.indexOf("//");
  const code = commentAt >= 0 ? line.text.slice(0, commentAt) : line.text;
  const open = code.lastIndexOf("{");
  if (open < 0) return null;

  const pos = line.from + open;
  const match = matchBrackets(state, pos, 1);
  if (!match || !match.matched || !match.end) return null;
  if (state.doc.lineAt(match.end.from).number <= line.number) return null;
  return { from: pos + 1, to: match.end.from };
});

export function glsl(): LanguageSupport {
  return new LanguageSupport(glslLanguage, [syntaxHighlighting(glslHighlightStyle), braceFolding]);
}
