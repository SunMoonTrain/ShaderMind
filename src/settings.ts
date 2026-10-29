import { DEFAULT_THEME_ID, THEMES } from "./editor/themes";

export interface EditorSettings {
  theme: string;
  /** 字体名（预设 id 或用户自填的任意字体名） */
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** 连字：让 <= != -> 等显示成一个字形（需要字体支持） */
  ligatures: boolean;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  highlightActiveLine: boolean;
  bracketColors: boolean;
  indentGuides: boolean;
  colorSwatches: boolean;
  /** 单击数字弹出滑条、单击 vec2 弹出二维调节板 */
  valueSliders: boolean;
  autocomplete: boolean;
  /** 停止输入后多久重新编译（毫秒） */
  compileDelay: number;
}

export interface FontPreset {
  id: string;
  /** 实际写进 font-family 的名字 */
  css: string;
  /** 随应用内置，任何机器上都可用 */
  bundled?: boolean;
  ligatures: boolean;
}

export const FONT_PRESETS: FontPreset[] = [
  { id: "JetBrains Mono", css: '"JetBrains Mono Variable", "JetBrains Mono"', bundled: true, ligatures: true },
  { id: "Cascadia Code", css: '"Cascadia Code"', ligatures: true },
  { id: "Cascadia Mono", css: '"Cascadia Mono"', ligatures: false },
  { id: "Fira Code", css: '"Fira Code"', ligatures: true },
  { id: "Source Code Pro", css: '"Source Code Pro"', ligatures: false },
  { id: "Consolas", css: "Consolas", ligatures: false },
  { id: "Sarasa Mono SC", css: '"Sarasa Mono SC", "等距更纱黑体 SC"', ligatures: true },
  { id: "Maple Mono", css: '"Maple Mono", "Maple Mono NF CN"', ligatures: true },
];

export const DEFAULT_SETTINGS: EditorSettings = {
  theme: DEFAULT_THEME_ID,
  fontFamily: "JetBrains Mono",
  fontSize: 14,
  lineHeight: 1.6,
  ligatures: true,
  tabSize: 4,
  wordWrap: true,
  lineNumbers: true,
  highlightActiveLine: true,
  bracketColors: true,
  indentGuides: true,
  colorSwatches: true,
  valueSliders: true,
  autocomplete: true,
  compileDelay: 300,
};

export const FONT_SIZE_RANGE = { min: 9, max: 32 };

/** 中文注释用的回退字体放在最后，保证等宽英文 + 清晰的中文。 */
const FALLBACK_STACK = '"Cascadia Mono", Consolas, "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", monospace';

export function fontStack(family: string): string {
  const preset = FONT_PRESETS.find((p) => p.id === family);
  const primary = preset ? preset.css : family.includes(",") ? family : `"${family.replace(/"/g, "")}"`;
  return `${primary}, ${FALLBACK_STACK}`;
}

/**
 * 判断系统里是否装了某个字体：分别用 "目标字体, 基准字体" 和纯基准字体量同一段文字，
 * 宽度不同说明目标字体生效了。内置字体直接视为可用。
 */
export function isFontAvailable(family: string): boolean {
  const preset = FONT_PRESETS.find((p) => p.id === family);
  if (preset?.bundled) return true;
  const names = (preset ? preset.css : `"${family}"`).split(",").map((s) => s.trim());
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const sample = "mmmmmmmmmmlli10OO@#==>";
  return ["monospace", "serif", "sans-serif"].some((base) => {
    ctx.font = `72px ${base}`;
    const baseline = ctx.measureText(sample).width;
    return names.some((name) => {
      ctx.font = `72px ${name}, ${base}`;
      return ctx.measureText(sample).width !== baseline;
    });
  });
}

const clampNum = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export function sanitizeSettings(value: unknown): EditorSettings {
  const d = DEFAULT_SETTINGS;
  if (!value || typeof value !== "object") return { ...d };
  const r = value as Record<string, unknown>;
  return {
    theme: typeof r.theme === "string" && THEMES.some((t) => t.id === r.theme) ? r.theme : d.theme,
    fontFamily: typeof r.fontFamily === "string" && r.fontFamily.trim() ? r.fontFamily.trim() : d.fontFamily,
    fontSize: Math.round(clampNum(r.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, d.fontSize)),
    lineHeight: Math.round(clampNum(r.lineHeight, 1.1, 2.4, d.lineHeight) * 10) / 10,
    ligatures: bool(r.ligatures, d.ligatures),
    tabSize: [2, 4, 8].includes(r.tabSize as number) ? (r.tabSize as number) : d.tabSize,
    wordWrap: bool(r.wordWrap, d.wordWrap),
    lineNumbers: bool(r.lineNumbers, d.lineNumbers),
    highlightActiveLine: bool(r.highlightActiveLine, d.highlightActiveLine),
    bracketColors: bool(r.bracketColors, d.bracketColors),
    indentGuides: bool(r.indentGuides, d.indentGuides),
    colorSwatches: bool(r.colorSwatches, d.colorSwatches),
    valueSliders: bool(r.valueSliders, d.valueSliders),
    autocomplete: bool(r.autocomplete, d.autocomplete),
    compileDelay: Math.round(clampNum(r.compileDelay, 50, 3000, d.compileDelay)),
  };
}
