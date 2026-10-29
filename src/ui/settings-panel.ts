import { THEMES } from "../editor/themes";
import {
  DEFAULT_SETTINGS,
  FONT_PRESETS,
  FONT_SIZE_RANGE,
  fontStack,
  isFontAvailable,
  type EditorSettings,
} from "../settings";
import { icon } from "./icons";

type Change = Partial<EditorSettings>;

const TOGGLES: { key: keyof EditorSettings; label: string; hint: string }[] = [
  { key: "autocomplete", label: "自动补全", hint: "输入时提示内置函数、uniform、代码片段和你自己定义的函数" },
  { key: "wordWrap", label: "自动换行", hint: "长行在编辑区宽度处折行显示" },
  { key: "lineNumbers", label: "行号", hint: "在左侧显示行号" },
  { key: "highlightActiveLine", label: "高亮当前行", hint: "给光标所在行加一层底色" },
  { key: "bracketColors", label: "括号配对着色", hint: "按嵌套层级给括号上不同颜色" },
  { key: "indentGuides", label: "缩进参考线", hint: "显示每层缩进的竖线" },
  { key: "colorSwatches", label: "颜色色块", hint: "在 vec3(…) / vec4(…) 颜色字面量前显示色块，点击可取色" },
  { key: "valueSliders", label: "数值滑条", hint: "单击数字弹出滑条，单击 vec2(…) 弹出二维调节板，拖动时画面实时更新" },
];

export const SHORTCUTS: [string, string][] = [
  ["Ctrl+Shift+P / F1", "命令面板"],
  ["Ctrl+,", "设置"],
  ["Ctrl+S / Ctrl+Shift+S", "保存 / 另存为"],
  ["Ctrl+O", "打开文件"],
  ["Ctrl+D", "选中下一个相同内容（多光标）"],
  ["Ctrl+Shift+L", "选中所有相同内容"],
  ["Alt+单击", "添加光标"],
  ["Ctrl+Alt+↑ / ↓", "在上 / 下一行添加光标"],
  ["Shift+Alt+拖动", "列选择"],
  ["Alt+拖动数字", "左右拖动调整数值（再按 Shift 精调）"],
  ["Alt+↑ / ↓", "上下移动行"],
  ["Shift+Alt+↑ / ↓", "向上 / 下复制行"],
  ["Ctrl+Shift+K", "删除行"],
  ["Ctrl+/", "切换注释"],
  ["Ctrl+] / Ctrl+[", "增加 / 减少缩进"],
  ["Ctrl+F / Ctrl+H", "查找 / 替换"],
  ["Ctrl+G", "跳转到行"],
  ["Ctrl+Shift+[ / ]", "折叠 / 展开代码块"],
  ["Ctrl+Space", "手动触发补全"],
  ["Ctrl+= / Ctrl+- / Ctrl+0", "放大 / 缩小 / 重置字号（也可 Ctrl+滚轮）"],
  ["F8", "跳到下一个错误"],
  ["空格（焦点不在编辑器）", "暂停 / 继续时间"],
  ["Ctrl+R", "时间归零"],
];

const PREVIEW = `// 字体预览：连字 != >= -> 与中文注释
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * 设置面板：所有修改即时生效（通过 onChange 回调），无需"应用"按钮。
 */
export class SettingsPanel {
  private root: HTMLElement | null = null;
  private settings: EditorSettings = { ...DEFAULT_SETTINGS };
  private fontAvailability = new Map<string, boolean>();
  private restoreFocus: HTMLElement | null = null;

  constructor(private readonly onChange: (change: Change) => void) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(settings: EditorSettings): void {
    this.settings = { ...settings };
    if (this.root) return this.render();
    this.restoreFocus = document.activeElement as HTMLElement | null;

    const root = el("div", "overlay settings-overlay");
    root.addEventListener("mousedown", (e) => {
      if (e.target === root) this.close();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    document.body.appendChild(root);
    this.root = root;
    this.render();
    root.querySelector<HTMLElement>(".settings")?.focus();
  }

  /** 外部（比如 Ctrl+= 缩放字号）改了设置时同步面板显示 */
  sync(settings: EditorSettings): void {
    this.settings = { ...settings };
    if (this.root) this.render();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.restoreFocus?.focus?.();
  }

  private change(change: Change): void {
    Object.assign(this.settings, change);
    this.onChange(change);
    this.render();
  }

  private fontOk(id: string): boolean {
    if (!this.fontAvailability.has(id)) this.fontAvailability.set(id, isFontAvailable(id));
    return this.fontAvailability.get(id)!;
  }

  private render(): void {
    const root = this.root!;
    const scrollTop = root.querySelector(".settings-body")?.scrollTop ?? 0;
    const s = this.settings;
    root.innerHTML = "";

    const panel = el("div", "settings");
    panel.tabIndex = -1;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "设置");

    const header = el("div", "settings-header");
    header.append(el("h2", "", "设置"));
    const closeBtn = el("button", "icon-btn");
    closeBtn.title = "关闭 (Esc)";
    closeBtn.innerHTML = icon("close");
    closeBtn.addEventListener("click", () => this.close());
    header.append(closeBtn);

    const body = el("div", "settings-body");
    body.append(
      this.themeSection(s),
      this.fontSection(s),
      this.editingSection(s),
      this.compileSection(s),
      this.shortcutSection(),
    );

    const footer = el("div", "settings-footer");
    const reset = el("button", "btn", "恢复默认设置");
    reset.addEventListener("click", () => this.change({ ...DEFAULT_SETTINGS }));
    const done = el("button", "btn primary", "完成");
    done.addEventListener("click", () => this.close());
    footer.append(el("span", "settings-note", "修改即时生效并自动保存"), reset, done);

    panel.append(header, body, footer);
    root.append(panel);
    body.scrollTop = scrollTop;
  }

  private section(title: string): HTMLElement {
    const sec = el("section", "settings-section");
    sec.append(el("h3", "", title));
    return sec;
  }

  private row(label: string, hint: string | null, control: HTMLElement): HTMLElement {
    const row = el("div", "settings-row");
    const text = el("div", "settings-label");
    text.append(el("div", "settings-title", label));
    if (hint) text.append(el("div", "settings-hint", hint));
    row.append(text, control);
    return row;
  }

  private toggle(value: boolean, onToggle: (v: boolean) => void, disabled = false): HTMLElement {
    const btn = el("button", "switch" + (value ? " on" : ""));
    btn.setAttribute("role", "switch");
    btn.setAttribute("aria-checked", String(value));
    btn.disabled = disabled;
    btn.append(el("span", "switch-knob"));
    btn.addEventListener("click", () => onToggle(!value));
    return btn;
  }

  private slider(value: number, min: number, max: number, step: number, fmt: (v: number) => string, onInput: (v: number) => void): HTMLElement {
    const wrap = el("div", "slider");
    const range = el("input") as HTMLInputElement;
    range.type = "range";
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.value = String(value);
    const out = el("span", "slider-value", fmt(value));
    range.addEventListener("input", () => {
      out.textContent = fmt(Number(range.value));
      range.style.setProperty("--p", `${((Number(range.value) - min) / (max - min)) * 100}%`);
    });
    range.addEventListener("change", () => onInput(Number(range.value)));
    range.style.setProperty("--p", `${((value - min) / (max - min)) * 100}%`);
    wrap.append(range, out);
    return wrap;
  }

  private themeSection(s: EditorSettings): HTMLElement {
    const sec = this.section("配色主题");
    const grid = el("div", "theme-grid");
    for (const theme of THEMES) {
      const card = el("button", "theme-card" + (theme.id === s.theme ? " selected" : ""));
      const prev = el("div", "theme-preview");
      prev.style.background = theme.ui.bg;
      const lines: [string, number][][] = [
        [[theme.syntax.keyword, 22], [theme.syntax.type, 26], [theme.syntax.function, 30]],
        [[theme.syntax.qualifier, 18], [theme.syntax.variable, 34], [theme.syntax.number, 14]],
        [[theme.syntax.comment, 60]],
        [[theme.syntax.builtinFn, 26], [theme.syntax.uniform, 22], [theme.syntax.string, 18]],
      ];
      lines.forEach((segs, i) => {
        const line = el("div", "tp-line");
        line.style.paddingLeft = `${i % 2 ? 10 : 0}px`;
        for (const [color, w] of segs) {
          const bar = el("span");
          bar.style.background = color;
          bar.style.width = `${w}%`;
          line.append(bar);
        }
        prev.append(line);
      });
      const name = el("div", "theme-name");
      name.append(el("span", "", theme.name));
      if (theme.id === s.theme) name.insertAdjacentHTML("beforeend", icon("check", 14));
      card.append(prev, name);
      card.addEventListener("click", () => this.change({ theme: theme.id }));
      grid.append(card);
    }
    sec.append(grid);
    return sec;
  }

  private fontSection(s: EditorSettings): HTMLElement {
    const sec = this.section("字体");

    // 字体选择：预设 + 自定义
    const isPreset = FONT_PRESETS.some((p) => p.id === s.fontFamily);
    const fontBox = el("div", "font-picker");
    const select = el("select", "select") as HTMLSelectElement;
    for (const p of FONT_PRESETS) {
      const ok = this.fontOk(p.id);
      const opt = el("option", "", p.id + (p.bundled ? "（内置）" : ok ? "" : "（未安装）")) as HTMLOptionElement;
      opt.value = p.id;
      opt.selected = p.id === s.fontFamily;
      select.append(opt);
    }
    const custom = el("option", "", "自定义…") as HTMLOptionElement;
    custom.value = "__custom";
    custom.selected = !isPreset;
    select.append(custom);
    fontBox.append(select);

    const customInput = el("input", "text-input") as HTMLInputElement;
    customInput.placeholder = "输入字体名，如 Monaspace Neon";
    customInput.value = isPreset ? "" : s.fontFamily;
    customInput.hidden = isPreset;
    customInput.addEventListener("change", () => {
      const v = customInput.value.trim();
      if (v) this.change({ fontFamily: v });
    });
    fontBox.append(customInput);

    select.addEventListener("change", () => {
      if (select.value === "__custom") {
        customInput.hidden = false;
        customInput.focus();
      } else {
        const preset = FONT_PRESETS.find((p) => p.id === select.value)!;
        // 换到不带连字的字体时顺手关掉连字开关的意义不大，保留用户选择
        this.change({ fontFamily: preset.id });
      }
    });

    const status = el("div", "settings-hint");
    const ok = this.fontOk(s.fontFamily);
    status.textContent = ok ? "" : `系统里没有找到「${s.fontFamily}」，正在使用回退字体。`;
    status.classList.toggle("warn", !ok);
    fontBox.append(status);
    sec.append(this.row("字体", "中文会自动回退到微软雅黑", fontBox));

    // 字号
    const sizeBox = el("div", "stepper");
    const dec = el("button", "icon-btn");
    dec.innerHTML = icon("minus", 14);
    dec.title = "缩小 (Ctrl+-)";
    dec.addEventListener("click", () => this.change({ fontSize: Math.max(FONT_SIZE_RANGE.min, s.fontSize - 1) }));
    const val = el("span", "stepper-value", `${s.fontSize}px`);
    const inc = el("button", "icon-btn");
    inc.innerHTML = icon("plus", 14);
    inc.title = "放大 (Ctrl+=)";
    inc.addEventListener("click", () => this.change({ fontSize: Math.min(FONT_SIZE_RANGE.max, s.fontSize + 1) }));
    sizeBox.append(dec, val, inc);
    sec.append(this.row("字号", "也可以用 Ctrl+滚轮 或 Ctrl+= / Ctrl+-", sizeBox));

    sec.append(
      this.row(
        "行高",
        null,
        this.slider(s.lineHeight, 1.1, 2.4, 0.1, (v) => v.toFixed(1), (v) => this.change({ lineHeight: Math.round(v * 10) / 10 })),
      ),
    );

    const preset = FONT_PRESETS.find((p) => p.id === s.fontFamily);
    sec.append(
      this.row(
        "连字",
        preset && !preset.ligatures ? "当前字体不含连字字形，开了也没有效果" : "把 != >= -> 等组合显示为一个字形",
        this.toggle(s.ligatures, (v) => this.change({ ligatures: v })),
      ),
    );

    const preview = el("pre", "font-preview", PREVIEW);
    preview.style.fontFamily = fontStack(s.fontFamily);
    preview.style.fontSize = `${s.fontSize}px`;
    preview.style.lineHeight = String(s.lineHeight);
    preview.style.fontFeatureSettings = s.ligatures ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0';
    sec.append(preview);
    return sec;
  }

  private editingSection(s: EditorSettings): HTMLElement {
    const sec = this.section("编辑");
    const seg = el("div", "segmented");
    for (const n of [2, 4, 8]) {
      const b = el("button", n === s.tabSize ? "on" : "", String(n));
      b.addEventListener("click", () => this.change({ tabSize: n }));
      seg.append(b);
    }
    sec.append(this.row("缩进宽度", "按 Tab 时插入的空格数", seg));
    for (const t of TOGGLES) {
      sec.append(this.row(t.label, t.hint, this.toggle(s[t.key] as boolean, (v) => this.change({ [t.key]: v }))));
    }
    return sec;
  }

  private compileSection(s: EditorSettings): HTMLElement {
    const sec = this.section("编译");
    sec.append(
      this.row(
        "自动编译延迟",
        "停止输入多久之后重新编译",
        this.slider(s.compileDelay, 50, 2000, 50, (v) => `${v} ms`, (v) => this.change({ compileDelay: v })),
      ),
    );
    return sec;
  }

  private shortcutSection(): HTMLElement {
    const sec = this.section("键盘快捷键");
    const table = el("div", "shortcut-table");
    for (const [keys, desc] of SHORTCUTS) {
      const k = el("div", "shortcut-keys");
      keys.split(" / ").forEach((combo, i) => {
        if (i) k.append(el("span", "shortcut-sep", "/"));
        combo.split("+").forEach((part, j) => {
          if (j) k.append(el("span", "shortcut-plus", "+"));
          k.append(el("kbd", "", part));
        });
      });
      table.append(k, el("div", "shortcut-desc", desc));
    }
    sec.append(table);
    return sec;
  }
}
