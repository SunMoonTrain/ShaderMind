import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { startCompletion } from "@codemirror/autocomplete";
import { foldAll, unfoldAll } from "@codemirror/language";
import { nextDiagnostic } from "@codemirror/lint";
import { gotoLine, openSearchPanel, selectSelectionMatches } from "@codemirror/search";
import { toggleComment } from "@codemirror/commands";
import type { Command } from "@codemirror/view";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";

import { ChannelPanel } from "./channels";
import {
  baseName,
  loadConfig,
  readTextFile,
  saveConfig,
  writeTextFile,
  type AppConfig,
} from "./config";
import { createEditor } from "./editor";
import { THEMES, applyThemeVariables, findTheme } from "./editor/themes";
import { DEFAULT_SHADER, type ShaderDiagnostic } from "./glsl";
import { CHANNEL_COUNT, Renderer } from "./renderer";
import { FONT_SIZE_RANGE, sanitizeSettings, type EditorSettings } from "./settings";
import { icon } from "./ui/icons";
import { CommandPalette, type PaletteCommand } from "./ui/palette";
import { SettingsPanel } from "./ui/settings-panel";

const CONFIG_DEBOUNCE_MS = 600;
const GLSL_EXTENSIONS = ["glsl", "frag", "fs", "fsh", "txt"];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const el = {
  editor: $("editor"),
  problems: $("problems"),
  problemsCount: $("problems-count"),
  errors: $("errors"),
  canvas: $<HTMLCanvasElement>("gl"),
  previewBadge: $("preview-badge"),
  workspace: document.querySelector<HTMLElement>(".workspace")!,
  splitter: $("splitter"),
  channels: $("channels"),
  btnOpen: $<HTMLButtonElement>("btn-open"),
  btnSave: $<HTMLButtonElement>("btn-save"),
  btnSaveAs: $<HTMLButtonElement>("btn-save-as"),
  btnPause: $<HTMLButtonElement>("btn-pause"),
  btnReset: $<HTMLButtonElement>("btn-reset"),
  btnPalette: $<HTMLButtonElement>("btn-palette"),
  btnSettings: $<HTMLButtonElement>("btn-settings"),
  winMin: $<HTMLButtonElement>("win-min"),
  winMax: $<HTMLButtonElement>("win-max"),
  winClose: $<HTMLButtonElement>("win-close"),
  ccText: $("cc-text"),
  tab: $("tab"),
  tabName: $("tab-name"),
  sbProblems: $<HTMLButtonElement>("sb-problems"),
  sbErrors: $("sb-errors"),
  sbWarnings: $("sb-warnings"),
  sbPath: $("sb-path"),
  sbCursor: $<HTMLButtonElement>("sb-cursor"),
  sbSelection: $("sb-selection"),
  sbIndent: $<HTMLButtonElement>("sb-indent"),
  sbFont: $<HTMLButtonElement>("sb-font"),
  statTime: $("stat-time"),
  statRes: $("stat-res"),
  statFps: $("stat-fps"),
};

/** 把 data-icon 占位替换成 SVG 图标（插在元素最前面）。 */
function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach((node) => {
    node.querySelector(":scope > svg.icon")?.remove();
    node.insertAdjacentHTML("afterbegin", icon(node.dataset.icon!, node.classList.contains("tab-icon") ? 15 : 16));
  });
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: () => number) {
  let timer = 0;
  return (...args: A) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms());
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("input, select, textarea, .cm-editor, .overlay");
}

async function main(): Promise<void> {
  const config = await loadConfig();
  let settings: EditorSettings = config.settings;
  applyThemeVariables(findTheme(settings.theme));
  hydrateIcons();

  let renderer: Renderer;
  try {
    renderer = new Renderer(el.canvas);
  } catch (err) {
    el.problems.hidden = false;
    el.errors.textContent = String(err);
    return;
  }

  // ------------------------------------------------------------ 应用状态

  let shaderPath: string | null = config.shaderPath;
  /** 编辑器内容与磁盘上的文件是否一致。 */
  let dirty = false;
  let editorRatio = config.editorRatio;
  /** 是否编译成功过：决定出错时预览区的提示文字 */
  let everCompiled = false;
  let firstErrorLine: number | null = null;

  const editor = createEditor({
    parent: el.editor,
    doc: config.source || DEFAULT_SHADER,
    settings,
    onChange: (_source, live) => {
      dirty = true;
      updateFileLabel();
      if (live) compileNextFrame();
      else scheduleCompile();
      scheduleSave();
    },
    onCursor: (info) => {
      el.sbCursor.textContent = `行 ${info.line}，列 ${info.col}`;
      el.sbSelection.hidden = info.selectedChars === 0 && info.selections === 1;
      el.sbSelection.textContent =
        info.selections > 1 ? `${info.selections} 个光标（已选 ${info.selectedChars}）` : `已选 ${info.selectedChars}`;
    },
  });

  const channels = new ChannelPanel(el.channels, renderer, () => scheduleSave());

  // ------------------------------------------------------------ 持久化

  function snapshot(): AppConfig {
    return {
      source: editor.getSource(),
      shaderPath,
      channels: channels.toConfig(),
      paused: renderer.isPaused(),
      editorRatio,
      settings,
    };
  }

  const scheduleSave = debounce(() => void saveConfig(snapshot()), () => CONFIG_DEBOUNCE_MS);

  // ------------------------------------------------------------ 设置

  const settingsPanel = new SettingsPanel((change) => updateSettings(change, false));

  function updateSettings(change: Partial<EditorSettings>, syncPanel = true): void {
    const next = sanitizeSettings({ ...settings, ...change });
    if (next.theme !== settings.theme) applyThemeVariables(findTheme(next.theme));
    settings = next;
    editor.applySettings(settings);
    renderSettingsStatus();
    if (syncPanel) settingsPanel.sync(settings);
    scheduleSave();
  }

  function renderSettingsStatus(): void {
    el.sbIndent.textContent = `空格: ${settings.tabSize}`;
    el.sbFont.textContent = `${settings.fontSize}px`;
  }

  function zoomFont(delta: number): void {
    const size = delta === 0 ? 14 : settings.fontSize + delta;
    updateSettings({ fontSize: Math.min(Math.max(size, FONT_SIZE_RANGE.min), FONT_SIZE_RANGE.max) });
  }

  // ------------------------------------------------------------ 编译

  function showDiagnostics(diagnostics: ShaderDiagnostic[]): void {
    const errors = diagnostics.filter((d) => d.severity === "error");
    const warnings = diagnostics.length - errors.length;
    firstErrorLine = errors.find((d) => d.line !== null)?.line ?? null;

    editor.setProblems(diagnostics);
    el.sbErrors.textContent = String(errors.length);
    el.sbWarnings.textContent = String(warnings);
    el.sbProblems.classList.toggle("has-errors", errors.length > 0);
    el.previewBadge.hidden = errors.length === 0;
    el.previewBadge.lastElementChild!.textContent = everCompiled
      ? "编译失败，显示的是上一次成功的画面"
      : "编译失败";

    el.errors.innerHTML = "";
    el.problems.hidden = diagnostics.length === 0;
    el.problemsCount.textContent = String(diagnostics.length);
    for (const d of diagnostics) {
      const row = document.createElement("div");
      row.className = d.severity === "warning" ? "err-row warn" : "err-row";

      const iconEl = document.createElement("span");
      iconEl.dataset.icon = d.severity === "warning" ? "warning" : "error";
      const msgEl = document.createElement("span");
      msgEl.className = "err-msg";
      msgEl.textContent = d.message;
      const lineEl = document.createElement("span");
      lineEl.className = "err-line";
      lineEl.textContent = d.line === null ? "" : `[行 ${d.line}]`;

      row.append(iconEl, msgEl, lineEl);
      if (d.line !== null) row.addEventListener("click", () => editor.goToLine(d.line!));
      el.errors.appendChild(row);
    }
    hydrateIcons(el.errors);
  }

  function compileNow(): void {
    const diagnostics = renderer.compile(editor.getSource());
    if (!diagnostics.some((d) => d.severity === "error")) everCompiled = true;
    showDiagnostics(diagnostics);
  }

  const scheduleCompile = debounce(compileNow, () => settings.compileDelay);

  // 拖动调值时每帧最多编译一次，画面跟手
  let compileFrame = 0;
  function compileNextFrame(): void {
    if (compileFrame) return;
    compileFrame = requestAnimationFrame(() => {
      compileFrame = 0;
      compileNow();
    });
  }

  // ------------------------------------------------------------ 文件

  function updateFileLabel(): void {
    const name = shaderPath ? baseName(shaderPath) : "未命名";
    el.tabName.textContent = name;
    el.tab.classList.toggle("dirty", dirty);
    el.tab.title = shaderPath ?? "尚未保存到文件";
    el.sbPath.textContent = shaderPath ?? "";
    el.ccText.textContent = `${name}${dirty ? " ●" : ""} — ShaderMind`;
    try {
      void getCurrentWindow().setTitle(`${dirty ? "● " : ""}${name} — ShaderMind`);
    } catch {
      // 不在 Tauri 环境里（比如直接用浏览器打开 dev server）时忽略
    }
  }

  function reportFileError(action: string, err: unknown): void {
    showDiagnostics([{ severity: "error", line: null, message: `${action}失败：${String(err)}`, raw: String(err) }]);
  }

  async function loadShaderFile(path: string): Promise<void> {
    try {
      const text = await readTextFile(path);
      shaderPath = path;
      editor.setSource(text);
      dirty = false;
      updateFileLabel();
      compileNow();
      scheduleSave();
    } catch (err) {
      reportFileError("打开", err);
    }
  }

  async function openShader(): Promise<void> {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "GLSL 片段着色器", extensions: GLSL_EXTENSIONS }],
    });
    if (typeof selected === "string") await loadShaderFile(selected);
  }

  async function saveShader(forceDialog: boolean): Promise<void> {
    let target = shaderPath;
    if (forceDialog || !target) {
      const chosen = await save({
        defaultPath: target ?? "shader.glsl",
        filters: [{ name: "GLSL 片段着色器", extensions: GLSL_EXTENSIONS }],
      });
      if (typeof chosen !== "string") return;
      target = chosen;
    }
    try {
      await writeTextFile(target, editor.getSource());
      shaderPath = target;
      dirty = false;
      updateFileLabel();
      scheduleSave();
    } catch (err) {
      reportFileError("保存", err);
    }
  }

  function newShader(): void {
    if (dirty && !window.confirm("当前内容尚未保存，确定要新建吗？")) return;
    shaderPath = null;
    editor.setSource(DEFAULT_SHADER);
    dirty = false;
    updateFileLabel();
    compileNow();
    scheduleSave();
  }

  // ------------------------------------------------------------ 播放控制

  function updatePauseButton(): void {
    const paused = renderer.isPaused();
    el.btnPause.dataset.icon = paused ? "play" : "pause";
    el.btnPause.querySelector("span")!.textContent = paused ? "继续" : "暂停";
    el.btnPause.classList.toggle("active", paused);
    hydrateIcons(el.btnPause.parentElement!);
  }

  function togglePause(): void {
    renderer.setPaused(!renderer.isPaused());
    updatePauseButton();
    scheduleSave();
  }

  // ------------------------------------------------------------ 命令

  /** 在编辑器上执行一个 CodeMirror 命令（先把焦点给编辑器） */
  const inEditor = (cmd: Command) => () => {
    editor.focus();
    cmd(editor.view);
  };

  const commands = (): PaletteCommand[] => [
    { id: "file.new", category: "文件", title: "新建（示例着色器）", aliases: "new", run: newShader },
    { id: "file.open", category: "文件", title: "打开…", keys: "Ctrl+O", aliases: "open", run: () => void openShader() },
    { id: "file.save", category: "文件", title: "保存", keys: "Ctrl+S", aliases: "save", run: () => void saveShader(false) },
    { id: "file.saveAs", category: "文件", title: "另存为…", keys: "Ctrl+Shift+S", aliases: "save as", run: () => void saveShader(true) },
    { id: "time.toggle", category: "播放", title: renderer.isPaused() ? "继续时间" : "暂停时间", keys: "空格", aliases: "pause play", run: togglePause },
    { id: "time.reset", category: "播放", title: "时间归零", keys: "Ctrl+R", aliases: "reset time", run: () => renderer.resetTime() },
    { id: "build.compile", category: "编译", title: "立即编译", aliases: "compile", run: compileNow },
    { id: "edit.find", category: "编辑", title: "查找", keys: "Ctrl+F", aliases: "find search", run: inEditor(openSearchPanel) },
    { id: "edit.replace", category: "编辑", title: "替换", keys: "Ctrl+H", aliases: "replace", run: inEditor(openSearchPanel) },
    { id: "edit.gotoLine", category: "编辑", title: "跳转到行…", keys: "Ctrl+G", aliases: "goto line", run: inEditor(gotoLine) },
    { id: "edit.comment", category: "编辑", title: "切换行注释", keys: "Ctrl+/", aliases: "comment", run: inEditor(toggleComment) },
    { id: "edit.selectAll", category: "编辑", title: "选中所有相同内容", keys: "Ctrl+Shift+L", aliases: "select occurrences", run: inEditor(selectSelectionMatches) },
    { id: "edit.complete", category: "编辑", title: "触发自动补全", keys: "Ctrl+Space", aliases: "suggest", run: inEditor(startCompletion) },
    { id: "edit.foldAll", category: "编辑", title: "折叠全部", aliases: "fold", run: inEditor(foldAll) },
    { id: "edit.unfoldAll", category: "编辑", title: "展开全部", aliases: "unfold", run: inEditor(unfoldAll) },
    { id: "edit.nextProblem", category: "编辑", title: "跳到下一个问题", keys: "F8", aliases: "error problem", run: inEditor(nextDiagnostic) },
    { id: "view.settings", category: "首选项", title: "打开设置", keys: "Ctrl+,", aliases: "settings preferences", run: () => settingsPanel.open(settings) },
    { id: "view.zoomIn", category: "视图", title: "放大字号", keys: "Ctrl+=", aliases: "zoom in font", run: () => zoomFont(1) },
    { id: "view.zoomOut", category: "视图", title: "缩小字号", keys: "Ctrl+-", aliases: "zoom out font", run: () => zoomFont(-1) },
    { id: "view.zoomReset", category: "视图", title: "重置字号", keys: "Ctrl+0", aliases: "zoom reset font", run: () => zoomFont(0) },
    { id: "view.wrap", category: "视图", title: `${settings.wordWrap ? "关闭" : "开启"}自动换行`, aliases: "word wrap", run: () => updateSettings({ wordWrap: !settings.wordWrap }) },
    { id: "view.lineNumbers", category: "视图", title: `${settings.lineNumbers ? "隐藏" : "显示"}行号`, aliases: "line numbers", run: () => updateSettings({ lineNumbers: !settings.lineNumbers }) },
    { id: "view.brackets", category: "视图", title: `${settings.bracketColors ? "关闭" : "开启"}括号配对着色`, aliases: "bracket colors", run: () => updateSettings({ bracketColors: !settings.bracketColors }) },
    { id: "view.guides", category: "视图", title: `${settings.indentGuides ? "隐藏" : "显示"}缩进参考线`, aliases: "indent guides", run: () => updateSettings({ indentGuides: !settings.indentGuides }) },
    { id: "view.ligatures", category: "视图", title: `${settings.ligatures ? "关闭" : "开启"}字体连字`, aliases: "ligatures", run: () => updateSettings({ ligatures: !settings.ligatures }) },
    ...THEMES.map((t) => ({
      id: `theme.${t.id}`,
      category: "主题",
      title: t.name + (t.id === settings.theme ? "（当前）" : ""),
      aliases: `theme color ${t.name}`,
      run: () => updateSettings({ theme: t.id }),
    })),
    ...Array.from({ length: CHANNEL_COUNT }, (_, i) => ({
      id: `channel.pick${i}`,
      category: "纹理",
      title: `为 iChannel${i} 选择图片…`,
      aliases: `texture channel ${i}`,
      run: () => void channels.pickImage(i),
    })),
    {
      id: "channel.clearAll",
      category: "纹理",
      title: "清空所有纹理槽",
      aliases: "clear textures",
      run: () => {
        for (let i = 0; i < CHANNEL_COUNT; i++) channels.clear(i);
      },
    },
  ];

  const palette = new CommandPalette(commands, (line) => editor.goToLine(line));

  // ------------------------------------------------------------ 界面事件

  el.btnOpen.addEventListener("click", () => void openShader());
  el.btnSave.addEventListener("click", () => void saveShader(false));
  el.btnSaveAs.addEventListener("click", () => void saveShader(true));
  el.btnPause.addEventListener("click", togglePause);
  el.btnReset.addEventListener("click", () => renderer.resetTime());
  el.btnPalette.addEventListener("click", () => palette.open());
  el.btnSettings.addEventListener("click", () => settingsPanel.open(settings));

  el.sbCursor.addEventListener("click", inEditor(gotoLine));
  el.sbIndent.addEventListener("click", () => {
    const sizes = [2, 4, 8];
    updateSettings({ tabSize: sizes[(sizes.indexOf(settings.tabSize) + 1) % sizes.length] });
  });
  el.sbFont.addEventListener("click", () => settingsPanel.open(settings));
  el.sbProblems.addEventListener("click", () => {
    if (firstErrorLine !== null) editor.goToLine(firstErrorLine);
  });

  window.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if ((mod && event.shiftKey && key === "p") || event.key === "F1") {
      event.preventDefault();
      palette.open();
      return;
    }
    if (mod && key === ",") {
      event.preventDefault();
      settingsPanel.open(settings);
      return;
    }
    // 字号缩放；同时拦住 WebView 自带的整页缩放
    if (mod && (key === "=" || key === "+")) {
      event.preventDefault();
      zoomFont(1);
      return;
    }
    if (mod && (key === "-" || key === "_")) {
      event.preventDefault();
      zoomFont(-1);
      return;
    }
    if (mod && key === "0") {
      event.preventDefault();
      zoomFont(0);
      return;
    }
    if (palette.isOpen || settingsPanel.isOpen) return;

    if (event.key === " " && !isTypingTarget(event.target) && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      togglePause();
      return;
    }
    if (mod && key === "r") {
      event.preventDefault();
      renderer.resetTime();
      return;
    }
    if (mod && key === "s") {
      event.preventDefault();
      void saveShader(event.shiftKey);
      return;
    }
    if (mod && key === "o") {
      event.preventDefault();
      void openShader();
    }
  });

  // Ctrl+滚轮：在编辑区缩放字号，其它地方仅阻止整页缩放
  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if ((event.target as HTMLElement).closest?.(".cm-editor")) zoomFont(event.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );

  // ------------------------------------------------------------ 鼠标

  // 和 Shadertoy 一样只在按住左键时更新 iMouse；捕获指针，拖出画布也能继续跟踪
  function canvasPoint(event: PointerEvent): [number, number] {
    const rect = el.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
    // 翻转 Y，让原点落在左下角，和 gl_FragCoord 一致
    const y = 1 - (event.clientY - rect.top) / Math.max(rect.height, 1);
    return [Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1)];
  }

  el.canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    el.canvas.setPointerCapture(event.pointerId);
    renderer.pointerDown(...canvasPoint(event));
  });
  el.canvas.addEventListener("pointermove", (event) => renderer.pointerMove(...canvasPoint(event)));
  el.canvas.addEventListener("pointerup", () => renderer.pointerUp());
  el.canvas.addEventListener("pointercancel", () => renderer.pointerUp());

  // ------------------------------------------------------------ 分隔条

  function applyRatio(ratio: number): void {
    editorRatio = Math.min(Math.max(ratio, 0.15), 0.85);
    el.workspace.style.setProperty("--editor-w", `${editorRatio * 100}%`);
  }
  applyRatio(editorRatio);

  el.splitter.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    el.splitter.setPointerCapture(event.pointerId);
    el.splitter.classList.add("dragging");

    const onMove = (move: PointerEvent) => {
      const rect = el.workspace.getBoundingClientRect();
      applyRatio((move.clientX - rect.left) / Math.max(rect.width, 1));
    };
    const onUp = () => {
      el.splitter.classList.remove("dragging");
      el.splitter.removeEventListener("pointermove", onMove);
      el.splitter.removeEventListener("pointerup", onUp);
      scheduleSave();
    };
    el.splitter.addEventListener("pointermove", onMove);
    el.splitter.addEventListener("pointerup", onUp);
  });
  el.splitter.addEventListener("dblclick", () => {
    applyRatio(0.5);
    scheduleSave();
  });

  // ------------------------------------------------------------ 拖放

  // Tauri 接管了 OS 的文件拖放，所以走 onDragDropEvent；事件里的坐标是物理像素，
  // 除以 devicePixelRatio 后就能和 DOM 的 getBoundingClientRect 对上。
  function registerDragDrop(): Promise<unknown> {
    return getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;

      if (payload.type === "leave") {
        channels.setDragTarget(null);
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const position = "position" in payload ? payload.position : null;
      const clientX = position ? position.x / dpr : -1;
      const clientY = position ? position.y / dpr : -1;

      if (payload.type === "enter" || payload.type === "over") {
        channels.setDragTarget(channels.slotIndexAt(clientX, clientY));
        return;
      }

      if (payload.type !== "drop") return;

      const slot = channels.slotIndexAt(clientX, clientY);
      channels.setDragTarget(null);

      const images = payload.paths.filter((path) => ChannelPanel.isImagePath(path));
      const others = payload.paths.filter((path) => !ChannelPanel.isImagePath(path));

      if (slot !== null && images.length > 0) {
        // 一次拖多张图：从命中的槽位开始依次填充
        images
          .slice(0, CHANNEL_COUNT - slot)
          .forEach((path, i) => void channels.loadInto(slot + i, path));
      } else if (others.length > 0) {
        // 拖进来的不是图片，就当作着色器源码打开
        void loadShaderFile(others[0]);
      } else if (images.length > 0) {
        // 图片没落在槽位上，填进第一个空槽
        const free = channels.toConfig().findIndex((entry) => entry === null);
        if (free >= 0) void channels.loadInto(free, images[0]);
      }
    });
  }

  // ------------------------------------------------------------ 启动

  renderer.onStats = (stats) => {
    el.statTime.textContent = `iTime ${stats.time.toFixed(2)}s`;
    el.statRes.textContent = `${stats.width}×${stats.height}`;
    el.statFps.textContent = `${Math.round(stats.fps)} fps`;
  };

  renderer.setPaused(config.paused);
  updatePauseButton();
  updateFileLabel();
  renderSettingsStatus();
  compileNow();
  renderer.start();
  editor.focus();

  // 下面这些都不该挡住首帧，失败了也只记日志
  void channels.restore(config.channels);
  try {
    registerDragDrop().catch((err) => console.warn("拖放事件注册失败", err));
  } catch (err) {
    console.warn("拖放事件注册失败", err);
  }
  window.addEventListener("beforeunload", () => void saveConfig(snapshot()));

  // 关窗时先拦下来把状态写完再真正销毁，否则 IPC 可能来不及跑完
  try {
    const appWindow = getCurrentWindow();
    setupWindowControls(appWindow);
    appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await saveConfig(snapshot());
        await appWindow.destroy();
      })
      .catch((err) => console.warn("关窗回调注册失败", err));
  } catch (err) {
    console.warn("不在 Tauri 环境中", err);
  }
}

/** 自绘标题栏的最小化 / 最大化 / 关闭按钮；最大化按钮随窗口状态切换图标。 */
function setupWindowControls(appWindow: ReturnType<typeof getCurrentWindow>): void {
  el.winMin.addEventListener("click", () => void appWindow.minimize());
  el.winMax.addEventListener("click", () => void appWindow.toggleMaximize());
  // close() 会走 onCloseRequested，先保存配置再销毁
  el.winClose.addEventListener("click", () => void appWindow.close());

  const syncMaximized = async () => {
    const maximized = await appWindow.isMaximized();
    el.winMax.dataset.icon = maximized ? "winRestore" : "winMax";
    el.winMax.title = maximized ? "还原" : "最大化";
    hydrateIcons(el.winMax.parentElement!);
  };
  void syncMaximized();
  appWindow.onResized(() => void syncMaximized()).catch((err) => console.warn("窗口尺寸监听注册失败", err));
}

void main();
