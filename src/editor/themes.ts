/**
 * 主题定义。所有颜色都以 CSS 变量的形式写到 :root 上，
 * 编辑器主题与语法高亮样式只引用这些变量 —— 切换主题只需要换变量，不必重建编辑器。
 */

export interface ThemeDef {
  id: string;
  name: string;
  dark: boolean;
  /** 界面：背景层级、边框、文字、强调色 */
  ui: {
    bg: string; // 编辑器 / 主区域背景
    panel: string; // 工具栏、面板、纹理区
    panelAlt: string; // 状态栏、标签栏底色
    input: string; // 输入框、按钮
    hover: string;
    border: string;
    fg: string;
    fgDim: string;
    accent: string;
    accentFg: string;
    /** 在背景上直接作为文字使用的强调色（补全匹配字符、链接等） */
    accentText: string;
    ok: string;
    err: string;
    warn: string;
    shadow: string;
  };
  editor: {
    gutterFg: string;
    gutterActiveFg: string;
    /** 必须带透明度：选区画在行的下面，不透明的当前行底色会把这一行的选区整个盖住 */
    activeLine: string;
    selection: string;
    selectionMatch: string;
    cursor: string;
    bracketMatch: string;
    indent: string;
    indentActive: string;
    searchMatch: string;
    searchMatchActive: string;
    errorLine: string;
  };
  syntax: {
    keyword: string; // if / for / return
    qualifier: string; // uniform / const / in / out
    type: string; // float / vec3
    function: string; // 用户函数
    builtinFn: string; // sin / mix / texture
    variable: string;
    uniform: string; // iTime 等
    builtinVar: string; // gl_FragCoord
    property: string; // .xyz 分量
    number: string;
    bool: string;
    string: string;
    comment: string;
    commentStyle: "italic" | "normal";
    preprocessor: string;
    macro: string;
    operator: string;
    punctuation: string;
  };
  /** 括号配对着色的三层颜色 */
  brackets: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  {
    id: "dark-modern",
    name: "Dark Modern",
    dark: true,
    ui: {
      bg: "#1f1f1f", panel: "#181818", panelAlt: "#181818", input: "#2a2a2a", hover: "#2b2d31",
      border: "#2b2b2b", fg: "#cccccc", fgDim: "#9d9d9d", accent: "#0078d4", accentFg: "#ffffff", accentText: "#2aaaff",
      ok: "#89d185", err: "#f85149", warn: "#cca700", shadow: "rgba(0,0,0,.45)",
    },
    editor: {
      gutterFg: "#6e7681", gutterActiveFg: "#cccccc", activeLine: "#ffffff0a", selection: "#264f78",
      selectionMatch: "#add6ff26", cursor: "#aeafad", bracketMatch: "#0064001a", indent: "#404040",
      indentActive: "#707070", searchMatch: "#623315", searchMatchActive: "#9e6a03", errorLine: "#f8514914",
    },
    syntax: {
      keyword: "#c586c0", qualifier: "#569cd6", type: "#4ec9b0", function: "#dcdcaa", builtinFn: "#dcdcaa",
      variable: "#9cdcfe", uniform: "#4fc1ff", builtinVar: "#4fc1ff", property: "#9cdcfe", number: "#b5cea8",
      bool: "#569cd6", string: "#ce9178", comment: "#6a9955", commentStyle: "normal", preprocessor: "#c586c0",
      macro: "#569cd6", operator: "#d4d4d4", punctuation: "#cccccc",
    },
    brackets: ["#ffd700", "#da70d6", "#179fff"],
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    dark: true,
    ui: {
      bg: "#282c34", panel: "#21252b", panelAlt: "#21252b", input: "#1d1f23", hover: "#2c313a",
      border: "#181a1f", fg: "#abb2bf", fgDim: "#7f848e", accent: "#4d78cc", accentFg: "#ffffff", accentText: "#61afef",
      ok: "#98c379", err: "#e06c75", warn: "#e5c07b", shadow: "rgba(0,0,0,.5)",
    },
    editor: {
      gutterFg: "#495162", gutterActiveFg: "#abb2bf", activeLine: "#99bbff0a", selection: "#67769680",
      selectionMatch: "#3e445180", cursor: "#528bff", bracketMatch: "#515a6b", indent: "#3b4048",
      indentActive: "#c8c8c859", searchMatch: "#42557b", searchMatchActive: "#314365", errorLine: "#e06c7514",
    },
    syntax: {
      keyword: "#c678dd", qualifier: "#c678dd", type: "#e5c07b", function: "#61afef", builtinFn: "#56b6c2",
      variable: "#e06c75", uniform: "#d19a66", builtinVar: "#e5c07b", property: "#e06c75", number: "#d19a66",
      bool: "#d19a66", string: "#98c379", comment: "#7f848e", commentStyle: "italic", preprocessor: "#c678dd",
      macro: "#61afef", operator: "#56b6c2", punctuation: "#abb2bf",
    },
    brackets: ["#d19a66", "#c678dd", "#56b6c2"],
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    dark: true,
    ui: {
      bg: "#1a1b26", panel: "#16161e", panelAlt: "#16161e", input: "#14141b", hover: "#1f2030",
      border: "#101014", fg: "#a9b1d6", fgDim: "#787c99", accent: "#3d59a1", accentFg: "#ffffff", accentText: "#7aa2f7",
      ok: "#9ece6a", err: "#f7768e", warn: "#e0af68", shadow: "rgba(0,0,0,.5)",
    },
    editor: {
      gutterFg: "#363b54", gutterActiveFg: "#737aa2", activeLine: "#c0caf508", selection: "#515c7e99",
      selectionMatch: "#3d59a14d", cursor: "#c0caf5", bracketMatch: "#3b4261", indent: "#292e42",
      indentActive: "#3b4261", searchMatch: "#3d59a166", searchMatchActive: "#e0af6855", errorLine: "#f7768e14",
    },
    syntax: {
      keyword: "#bb9af7", qualifier: "#9d7cd8", type: "#2ac3de", function: "#7aa2f7", builtinFn: "#7dcfff",
      variable: "#c0caf5", uniform: "#e0af68", builtinVar: "#e0af68", property: "#73daca", number: "#ff9e64",
      bool: "#ff9e64", string: "#9ece6a", comment: "#565f89", commentStyle: "italic", preprocessor: "#bb9af7",
      macro: "#7dcfff", operator: "#89ddff", punctuation: "#a9b1d6",
    },
    brackets: ["#698cd6", "#68b3de", "#9a7ecc"],
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    dark: true,
    ui: {
      bg: "#1e1e2e", panel: "#181825", panelAlt: "#11111b", input: "#313244", hover: "#313244",
      border: "#11111b", fg: "#cdd6f4", fgDim: "#9399b2", accent: "#cba6f7", accentFg: "#11111b", accentText: "#cba6f7",
      ok: "#a6e3a1", err: "#f38ba8", warn: "#f9e2af", shadow: "rgba(0,0,0,.5)",
    },
    editor: {
      gutterFg: "#7f849c", gutterActiveFg: "#b4befe", activeLine: "#cdd6f40d", selection: "#9399b266",
      selectionMatch: "#9399b226", cursor: "#f5e0dc", bracketMatch: "#7f849c40", indent: "#313244",
      indentActive: "#585b70", searchMatch: "#89b4fa33", searchMatchActive: "#f9e2af40", errorLine: "#f38ba814",
    },
    syntax: {
      keyword: "#cba6f7", qualifier: "#cba6f7", type: "#f9e2af", function: "#89b4fa", builtinFn: "#89dceb",
      variable: "#cdd6f4", uniform: "#fab387", builtinVar: "#f38ba8", property: "#b4befe", number: "#fab387",
      bool: "#fab387", string: "#a6e3a1", comment: "#9399b2", commentStyle: "italic", preprocessor: "#f5c2e7",
      macro: "#89dceb", operator: "#89dceb", punctuation: "#9399b2",
    },
    brackets: ["#f38ba8", "#fab387", "#f9e2af"],
  },
  {
    id: "light-modern",
    name: "Light Modern",
    dark: false,
    ui: {
      bg: "#ffffff", panel: "#f8f8f8", panelAlt: "#f8f8f8", input: "#ffffff", hover: "#e8e8e8",
      border: "#e5e5e5", fg: "#3b3b3b", fgDim: "#767676", accent: "#005fb8", accentFg: "#ffffff", accentText: "#0066bf",
      ok: "#388a34", err: "#e51400", warn: "#bf8803", shadow: "rgba(0,0,0,.16)",
    },
    editor: {
      gutterFg: "#6e7681", gutterActiveFg: "#171184", activeLine: "#0000000a", selection: "#add6ff",
      selectionMatch: "#add6ff80", cursor: "#000000", bracketMatch: "#0064001a", indent: "#d3d3d3",
      indentActive: "#939393", searchMatch: "#ea5c0055", searchMatchActive: "#a8ac94", errorLine: "#e5140010",
    },
    syntax: {
      keyword: "#af00db", qualifier: "#0000ff", type: "#267f99", function: "#795e26", builtinFn: "#795e26",
      variable: "#001080", uniform: "#0070c1", builtinVar: "#0070c1", property: "#001080", number: "#098658",
      bool: "#0000ff", string: "#a31515", comment: "#008000", commentStyle: "normal", preprocessor: "#af00db",
      macro: "#0000ff", operator: "#000000", punctuation: "#3b3b3b",
    },
    brackets: ["#0431fa", "#319331", "#7b3814"],
  },
];

export const DEFAULT_THEME_ID = "dark-modern";

export function findTheme(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/** 把主题写成 :root 上的 CSS 变量。 */
export function applyThemeVariables(theme: ThemeDef, root: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string) => root.style.setProperty(name, value);
  for (const [k, v] of Object.entries(theme.ui)) set(`--ui-${kebab(k)}`, v);
  for (const [k, v] of Object.entries(theme.editor)) set(`--ed-${kebab(k)}`, v);
  for (const [k, v] of Object.entries(theme.syntax)) set(`--syn-${kebab(k)}`, v);
  theme.brackets.forEach((c, i) => set(`--bk-${i}`, c));
  root.dataset.themeKind = theme.dark ? "dark" : "light";
  root.style.colorScheme = theme.dark ? "dark" : "light";
}
