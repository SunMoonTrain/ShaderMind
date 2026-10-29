import { invoke } from "@tauri-apps/api/core";
import { CHANNEL_COUNT, type FilterMode, type WrapMode } from "./renderer";
import { DEFAULT_SHADER } from "./glsl";
import { DEFAULT_SETTINGS, sanitizeSettings, type EditorSettings } from "./settings";

/** 单个纹理槽的持久化内容 —— 只存路径，不存图片数据。 */
export interface ChannelConfig {
  path: string;
  wrap: WrapMode;
  filter: FilterMode;
}

export interface AppConfig {
  /** 编辑器中的着色器源码（即使没保存成文件也能恢复现场）。 */
  source: string;
  /** 最近一次打开 / 保存的 .glsl 路径。 */
  shaderPath: string | null;
  channels: (ChannelConfig | null)[];
  paused: boolean;
  /** 左侧编辑区占窗口宽度的比例，0~1。 */
  editorRatio: number;
  /** 编辑器外观与行为设置 */
  settings: EditorSettings;
}

export function defaultConfig(): AppConfig {
  return {
    source: DEFAULT_SHADER,
    shaderPath: null,
    channels: Array(CHANNEL_COUNT).fill(null),
    paused: false,
    editorRatio: 0.5,
    settings: { ...DEFAULT_SETTINGS },
  };
}

function sanitizeChannel(value: unknown): ChannelConfig | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.path !== "string" || !raw.path) return null;
  return {
    path: raw.path,
    wrap: raw.wrap === "clamp" ? "clamp" : "repeat",
    filter: raw.filter === "nearest" ? "nearest" : "linear",
  };
}

/**
 * 改成 Shadertoy 写法之前的示例代码（FNV-1a 哈希）。旧示例用的是 vec2 的 iResolution / iMouse，
 * 在新版里编译不过；没改动过的旧示例在读配置时直接换成新示例，改过的保持原样。
 */
const LEGACY_DEFAULT_HASHES = new Set(["24fa260e"]);

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function migrateSource(source: string): string {
  return LEGACY_DEFAULT_HASHES.has(fnv1a(source.replace(/\r\n/g, "\n"))) ? DEFAULT_SHADER : source;
}

/** 磁盘上的配置可能来自旧版本或被手工改坏，这里逐字段收敛到合法值。 */
function sanitize(value: unknown): AppConfig {
  const fallback = defaultConfig();
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;

  const channels: (ChannelConfig | null)[] = Array(CHANNEL_COUNT).fill(null);
  if (Array.isArray(raw.channels)) {
    for (let i = 0; i < CHANNEL_COUNT; i++) channels[i] = sanitizeChannel(raw.channels[i]);
  }

  const ratio = typeof raw.editorRatio === "number" ? raw.editorRatio : fallback.editorRatio;

  return {
    source: typeof raw.source === "string" ? migrateSource(raw.source) : fallback.source,
    shaderPath: typeof raw.shaderPath === "string" && raw.shaderPath ? raw.shaderPath : null,
    channels,
    paused: raw.paused === true,
    editorRatio: Math.min(Math.max(ratio, 0.15), 0.85),
    settings: sanitizeSettings(raw.settings),
  };
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    return sanitize(await invoke<unknown>("load_config"));
  } catch (err) {
    console.warn("读取配置失败，使用默认配置", err);
    return defaultConfig();
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  try {
    await invoke("save_config", { config });
  } catch (err) {
    console.warn("写入配置失败", err);
  }
}

/** 把本地图片读成 data URL —— 避免为任意路径开放 asset 协议。 */
export function loadImageDataUrl(path: string): Promise<string> {
  return invoke<string>("load_image", { path });
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke("write_text_file", { path, contents });
}

/** 把路径压成用于标题栏 / 槽位说明的短名字。 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
