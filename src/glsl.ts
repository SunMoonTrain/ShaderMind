/**
 * GLSL 相关的常量与纯函数：内置顶点着色器、片段着色器头部、
 * 默认示例代码，以及把驱动的编译日志翻译成编辑器行号。
 */

/**
 * 内置顶点着色器：无属性，用 gl_VertexID 生成一个铺满屏幕的三角形。
 * 三个顶点的 p 是 (0,0) (2,0) (0,2)，插值到画布范围内正好是 0..1，直接当作 vUV 输出。
 */
export const VERTEX_SHADER = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * 拼接在用户代码前面的片段着色器头部，uniform 与 Shadertoy 一致。
 * 注意：这里不使用 `#line` 指令（各驱动实现不一致），而是在解析错误日志时
 * 固定减去 HEADER_LINES，保证行号映射是确定的。
 */
export const FRAGMENT_HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
#define HW_PERFORMANCE 1

uniform vec3  iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform int   iFrame;
uniform float iChannelTime[4];
uniform vec3  iChannelResolution[4];
uniform vec4  iMouse;
uniform vec4  iDate;
uniform float iSampleRate;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;

in vec2 vUV;
out vec4 fragColor;
`;

/** 头部占用的行数 —— 用户代码的第 1 行在完整源码里是第 HEADER_LINES + 1 行。 */
export const HEADER_LINES = FRAGMENT_HEADER.split("\n").length - 1;

/**
 * 用户代码写的是 Shadertoy 的 mainImage() 时，接在末尾的入口。
 * 拼在末尾不影响用户代码的行号。alpha 固定为 1，和 Shadertoy 的显示效果一致。
 */
const MAIN_IMAGE_FOOTER = `
void main() {
  vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(color, gl_FragCoord.xy);
  fragColor = vec4(color.rgb, 1.0);
}
`;

/**
 * 用户可能从别处粘贴带 `#version` 的代码，而 `#version` 必须在第一行。
 * 把它替换成空行（保留行数，行号才不会错位）。
 */
export function stripVersionDirective(source: string): string {
  return source.replace(/^[ \t]*#version[^\n]*/m, "");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
}

/**
 * 两种写法都支持：
 * - Shadertoy 风格：定义 `mainImage(out vec4, in vec2)`，入口由 MAIN_IMAGE_FOOTER 补上；
 * - 直接写 `main()`，把颜色写进 `fragColor`。
 */
export function buildFragmentSource(userSource: string): string {
  const code = stripComments(userSource);
  const hasMainImage = /\bvoid\s+mainImage\s*\(/.test(code);
  const hasMain = /\bvoid\s+main\s*\(/.test(code);
  const footer = hasMainImage && !hasMain ? MAIN_IMAGE_FOOTER : "";
  return FRAGMENT_HEADER + stripVersionDirective(userSource) + footer;
}

export type Severity = "error" | "warning";

export interface ShaderDiagnostic {
  severity: Severity;
  /** 编辑器中的行号（1 起）；无法定位时为 null。 */
  line: number | null;
  message: string;
  raw: string;
}

// 形如: "ERROR: 0:23: 'foo' : undeclared identifier"
const LOG_LINE = /^\s*(ERROR|WARNING)\s*:\s*(\d+)\s*:\s*(\d+)\s*:\s*([\s\S]*)$/i;

/**
 * 解析 getShaderInfoLog / getProgramInfoLog 的输出。
 * @param log 驱动返回的日志
 * @param headerLines 若日志来自带头部的片段着色器，传入头部行数以便把行号换算回编辑器行号
 * @param totalUserLines 用户代码总行数，用于把越界行号夹到有效范围
 */
export function parseShaderLog(
  log: string,
  headerLines = 0,
  totalUserLines = Number.MAX_SAFE_INTEGER,
): ShaderDiagnostic[] {
  const out: ShaderDiagnostic[] = [];
  for (const raw of log.split("\n")) {
    const text = raw.replace(/\0/g, "").trimEnd();
    if (!text.trim()) continue;

    const m = LOG_LINE.exec(text);
    if (m) {
      const reported = Number(m[3]);
      const mapped = Math.min(Math.max(reported - headerLines, 1), Math.max(totalUserLines, 1));
      out.push({
        severity: m[1].toUpperCase() === "WARNING" ? "warning" : "error",
        line: mapped,
        message: m[4].trim(),
        raw: text,
      });
      continue;
    }

    out.push({
      severity: /warning/i.test(text) ? "warning" : "error",
      line: null,
      message: text.replace(/^\s*(ERROR|WARNING)\s*:\s*/i, "").trim(),
      raw: text,
    });
  }
  return out;
}

/** 打开应用时的初始内容。 */
export const DEFAULT_SHADER = `// ShaderMind — 示例着色器
//
// 与 Shadertoy 兼容：直接写 mainImage()，Shadertoy 上的代码可以原样粘贴进来。
// 内置 uniform（声明已经拼在代码前面）:
//   vec3      iResolution;           画布像素尺寸，z 为像素宽高比（1.0）
//   float     iTime;                 运行秒数
//   float     iTimeDelta;            上一帧耗时（秒）
//   int       iFrame;                帧序号
//   vec4      iMouse;                xy: 按住时的鼠标像素坐标；zw: 点击位置（松开后为负）
//   vec4      iDate;                 年、月（0 起）、日、当天秒数
//   vec2      vUV;                   画布 uv，0..1，左下角为原点（ShaderMind 扩展）
//   sampler2D iChannel0 .. iChannel3 下方四个纹理槽位
//   vec3      iChannelResolution[4]; 各槽位的像素尺寸

vec3 palette(float t) {
    return 0.55 + 0.45 * cos(6.28318 * (t + vec3(0.00, 0.28, 0.55)));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // 居中并按短边归一化，保证不同窗口比例下图形不变形
    float scale = min(iResolution.x, iResolution.y);
    vec2 uv = (fragCoord * 2.0 - iResolution.xy) / scale;

    // 按住鼠标拖动，图案中心跟随
    if (iMouse.z > 0.0 || iMouse.xy != vec2(0.0)) {
        uv -= (iMouse.xy * 2.0 - iResolution.xy) / scale;
    }

    float r = length(uv);
    float a = atan(uv.y, uv.x);

    float spiral = sin(a * 5.0 + r * 9.0 - iTime * 1.6);   // 旋臂
    float rings  = sin(r * 18.0 - iTime * 2.4);            // 同心波纹
    float field  = spiral * 0.6 + rings * 0.4;

    vec3 col = palette(field * 0.25 + r * 0.35 + iTime * 0.08);

    col *= 1.0 - 0.55 * smoothstep(0.4, 1.6, r);  // 边缘压暗
    col += 0.06 / (r + 0.08);                     // 中心辉光
    col = pow(col, vec3(0.85));

    // 想用纹理时，把下面这行取消注释，并往槽位 0 拖一张图片：
    // col = mix(col, texture(iChannel0, fragCoord / iChannelResolution[0].xy).rgb, 0.5);

    fragColor = vec4(col, 1.0);
}
`;
