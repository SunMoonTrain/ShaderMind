/**
 * GLSL ES 3.00 的词表与内置函数文档，供语法高亮、自动补全和悬停提示共用。
 */

export const KEYWORDS = [
  "if", "else", "for", "while", "do", "switch", "case", "default",
  "break", "continue", "return", "discard", "struct",
];

export const QUALIFIERS = [
  "const", "uniform", "in", "out", "inout", "centroid", "flat", "smooth",
  "invariant", "layout", "highp", "mediump", "lowp", "precision",
];

export const TYPES = [
  "void", "bool", "int", "uint", "float",
  "vec2", "vec3", "vec4", "bvec2", "bvec3", "bvec4",
  "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4",
  "mat2", "mat3", "mat4", "mat2x2", "mat2x3", "mat2x4",
  "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4",
  "sampler2D", "sampler3D", "samplerCube", "sampler2DShadow", "samplerCubeShadow",
  "sampler2DArray", "sampler2DArrayShadow",
  "isampler2D", "isampler3D", "isamplerCube", "isampler2DArray",
  "usampler2D", "usampler3D", "usamplerCube", "usampler2DArray",
];

export const BOOLEANS = ["true", "false"];

export interface SymbolDoc {
  /** 展示在补全列表右侧和悬停提示第一行的签名。 */
  signature: string;
  /** 中文说明。 */
  doc: string;
}

/** 本应用注入的 uniform 与输出变量（与 Shadertoy 一致）。 */
export const APP_SYMBOLS: Record<string, SymbolDoc> = {
  iResolution: {
    signature: "uniform vec3 iResolution",
    doc: "画布的像素尺寸（已乘设备像素比），z 为像素宽高比，恒为 1.0。",
  },
  iTime: { signature: "uniform float iTime", doc: "运行秒数，受工具栏的暂停 / 归零控制。" },
  iTimeDelta: { signature: "uniform float iTimeDelta", doc: "上一帧耗时（秒）；暂停时为 0。" },
  iFrameRate: { signature: "uniform float iFrameRate", doc: "当前帧率。" },
  iFrame: { signature: "uniform int iFrame", doc: "帧序号，从 0 开始；时间归零时一起归零。" },
  iChannelTime: { signature: "uniform float iChannelTime[4]", doc: "各纹理槽的播放时间；图片槽位等于 iTime。" },
  iChannelResolution: {
    signature: "uniform vec3 iChannelResolution[4]",
    doc: "四个纹理槽各自的像素尺寸；空槽为 vec3(1.0)。",
  },
  iMouse: {
    signature: "uniform vec4 iMouse",
    doc: "鼠标像素坐标，原点在左下角。xy：按住左键时的当前位置（松开后保持）；zw：按下的位置，按住时 z 为正，w 只在按下那一帧为正。",
  },
  iDate: { signature: "uniform vec4 iDate", doc: "本地日期：年、月（0 起）、日、当天已过秒数。" },
  iSampleRate: { signature: "uniform float iSampleRate", doc: "音频采样率，固定 44100。" },
  iChannel0: { signature: "uniform sampler2D iChannel0", doc: "纹理槽 0。空槽是 1×1 黑色纹理。" },
  iChannel1: { signature: "uniform sampler2D iChannel1", doc: "纹理槽 1。空槽是 1×1 黑色纹理。" },
  iChannel2: { signature: "uniform sampler2D iChannel2", doc: "纹理槽 2。空槽是 1×1 黑色纹理。" },
  iChannel3: { signature: "uniform sampler2D iChannel3", doc: "纹理槽 3。空槽是 1×1 黑色纹理。" },
  fragColor: {
    signature: "out vec4 fragColor",
    doc: "片段着色器的输出颜色。写 mainImage() 时它是参数；直接写 main() 时写入这个全局输出。",
  },
};

/** GLSL 内置变量。 */
export const BUILTIN_VARIABLES: Record<string, SymbolDoc> = {
  gl_FragCoord: { signature: "in highp vec4 gl_FragCoord", doc: "当前片段的窗口坐标，xy 为像素中心（如 0.5, 0.5），原点在左下角。" },
  gl_FrontFacing: { signature: "in bool gl_FrontFacing", doc: "片段是否属于正面图元。" },
  gl_PointCoord: { signature: "in mediump vec2 gl_PointCoord", doc: "点精灵内的坐标，范围 [0,1]。" },
  gl_FragDepth: { signature: "out highp float gl_FragDepth", doc: "写入片段深度值。" },
};

const G = "genType";

/** 内置函数。genType 表示 float / vec2 / vec3 / vec4 均可。 */
export const BUILTIN_FUNCTIONS: Record<string, SymbolDoc> = {
  // 角度与三角函数
  radians: { signature: `${G} radians(${G} degrees)`, doc: "角度转弧度。" },
  degrees: { signature: `${G} degrees(${G} radians)`, doc: "弧度转角度。" },
  sin: { signature: `${G} sin(${G} x)`, doc: "正弦。" },
  cos: { signature: `${G} cos(${G} x)`, doc: "余弦。" },
  tan: { signature: `${G} tan(${G} x)`, doc: "正切。" },
  asin: { signature: `${G} asin(${G} x)`, doc: "反正弦，结果范围 [-π/2, π/2]。" },
  acos: { signature: `${G} acos(${G} x)`, doc: "反余弦，结果范围 [0, π]。" },
  atan: { signature: `${G} atan(${G} y, ${G} x)\n${G} atan(${G} y_over_x)`, doc: "反正切。双参数版本按 y、x 的象限返回 [-π, π]，常用于求极角。" },
  sinh: { signature: `${G} sinh(${G} x)`, doc: "双曲正弦。" },
  cosh: { signature: `${G} cosh(${G} x)`, doc: "双曲余弦。" },
  tanh: { signature: `${G} tanh(${G} x)`, doc: "双曲正切。" },
  asinh: { signature: `${G} asinh(${G} x)`, doc: "反双曲正弦。" },
  acosh: { signature: `${G} acosh(${G} x)`, doc: "反双曲余弦。" },
  atanh: { signature: `${G} atanh(${G} x)`, doc: "反双曲正切。" },

  // 指数
  pow: { signature: `${G} pow(${G} x, ${G} y)`, doc: "x 的 y 次方。x < 0 时结果未定义。" },
  exp: { signature: `${G} exp(${G} x)`, doc: "e 的 x 次方。" },
  log: { signature: `${G} log(${G} x)`, doc: "自然对数。" },
  exp2: { signature: `${G} exp2(${G} x)`, doc: "2 的 x 次方。" },
  log2: { signature: `${G} log2(${G} x)`, doc: "以 2 为底的对数。" },
  sqrt: { signature: `${G} sqrt(${G} x)`, doc: "平方根。" },
  inversesqrt: { signature: `${G} inversesqrt(${G} x)`, doc: "平方根的倒数 1/√x。" },

  // 常用
  abs: { signature: `${G} abs(${G} x)`, doc: "绝对值。" },
  sign: { signature: `${G} sign(${G} x)`, doc: "符号：x>0 为 1，x<0 为 -1，否则为 0。" },
  floor: { signature: `${G} floor(${G} x)`, doc: "向下取整。" },
  ceil: { signature: `${G} ceil(${G} x)`, doc: "向上取整。" },
  trunc: { signature: `${G} trunc(${G} x)`, doc: "向零取整。" },
  round: { signature: `${G} round(${G} x)`, doc: "四舍五入到最近整数。" },
  roundEven: { signature: `${G} roundEven(${G} x)`, doc: "四舍五入，0.5 时取偶数。" },
  fract: { signature: `${G} fract(${G} x)`, doc: "小数部分 x - floor(x)。常用于平铺和哈希。" },
  mod: { signature: `${G} mod(${G} x, ${G} y)\n${G} mod(${G} x, float y)`, doc: "取模 x - y·floor(x/y)，结果与 y 同号。" },
  modf: { signature: `${G} modf(${G} x, out ${G} i)`, doc: "拆分整数与小数部分，整数部分写入 i。" },
  min: { signature: `${G} min(${G} x, ${G} y)`, doc: "较小值。" },
  max: { signature: `${G} max(${G} x, ${G} y)`, doc: "较大值。" },
  clamp: { signature: `${G} clamp(${G} x, ${G} minVal, ${G} maxVal)`, doc: "把 x 限制在 [minVal, maxVal]。" },
  mix: { signature: `${G} mix(${G} x, ${G} y, ${G} a)\n${G} mix(${G} x, ${G} y, bvec a)`, doc: "线性插值 x·(1-a) + y·a。" },
  step: { signature: `${G} step(${G} edge, ${G} x)`, doc: "x < edge 返回 0，否则返回 1。" },
  smoothstep: { signature: `${G} smoothstep(${G} edge0, ${G} edge1, ${G} x)`, doc: "在 edge0 与 edge1 之间做 Hermite 平滑插值，结果在 [0,1]。常用于抗锯齿边缘。" },
  isnan: { signature: `bvec isnan(${G} x)`, doc: "是否为 NaN。" },
  isinf: { signature: `bvec isinf(${G} x)`, doc: "是否为无穷大。" },
  floatBitsToInt: { signature: "genIType floatBitsToInt(genType value)", doc: "按位把 float 解释为 int。" },
  floatBitsToUint: { signature: "genUType floatBitsToUint(genType value)", doc: "按位把 float 解释为 uint。常用于哈希。" },
  intBitsToFloat: { signature: "genType intBitsToFloat(genIType value)", doc: "按位把 int 解释为 float。" },
  uintBitsToFloat: { signature: "genType uintBitsToFloat(genUType value)", doc: "按位把 uint 解释为 float。" },

  // 几何
  length: { signature: `float length(${G} x)`, doc: "向量长度。" },
  distance: { signature: `float distance(${G} p0, ${G} p1)`, doc: "两点间距离。" },
  dot: { signature: `float dot(${G} x, ${G} y)`, doc: "点积。" },
  cross: { signature: "vec3 cross(vec3 x, vec3 y)", doc: "叉积。" },
  normalize: { signature: `${G} normalize(${G} x)`, doc: "单位化向量。" },
  faceforward: { signature: `${G} faceforward(${G} N, ${G} I, ${G} Nref)`, doc: "若 dot(Nref, I) < 0 返回 N，否则返回 -N。" },
  reflect: { signature: `${G} reflect(${G} I, ${G} N)`, doc: "按法线 N 反射入射方向 I（N 需单位化）。" },
  refract: { signature: `${G} refract(${G} I, ${G} N, float eta)`, doc: "按折射率比 eta 计算折射方向。" },

  // 矩阵
  matrixCompMult: { signature: "mat matrixCompMult(mat x, mat y)", doc: "矩阵逐分量相乘。" },
  outerProduct: { signature: "mat outerProduct(vec c, vec r)", doc: "外积。" },
  transpose: { signature: "mat transpose(mat m)", doc: "转置。" },
  determinant: { signature: "float determinant(mat m)", doc: "行列式。" },
  inverse: { signature: "mat inverse(mat m)", doc: "逆矩阵。" },

  // 向量比较
  lessThan: { signature: "bvec lessThan(vec x, vec y)", doc: "逐分量 x < y。" },
  lessThanEqual: { signature: "bvec lessThanEqual(vec x, vec y)", doc: "逐分量 x <= y。" },
  greaterThan: { signature: "bvec greaterThan(vec x, vec y)", doc: "逐分量 x > y。" },
  greaterThanEqual: { signature: "bvec greaterThanEqual(vec x, vec y)", doc: "逐分量 x >= y。" },
  equal: { signature: "bvec equal(vec x, vec y)", doc: "逐分量相等。" },
  notEqual: { signature: "bvec notEqual(vec x, vec y)", doc: "逐分量不等。" },
  any: { signature: "bool any(bvec x)", doc: "任一分量为真。" },
  all: { signature: "bool all(bvec x)", doc: "所有分量为真。" },
  not: { signature: "bvec not(bvec x)", doc: "逐分量取反。" },

  // 纹理
  texture: { signature: "vec4 texture(sampler2D s, vec2 uv)\nvec4 texture(sampler2D s, vec2 uv, float bias)", doc: "按归一化坐标采样纹理，uv 范围 [0,1]，受槽位的 wrap / filter 设置影响。" },
  textureLod: { signature: "vec4 textureLod(sampler2D s, vec2 uv, float lod)", doc: "指定 mipmap 层级采样。" },
  textureOffset: { signature: "vec4 textureOffset(sampler2D s, vec2 uv, ivec2 offset)", doc: "带整数纹素偏移的采样。" },
  textureGrad: { signature: "vec4 textureGrad(sampler2D s, vec2 uv, vec2 dPdx, vec2 dPdy)", doc: "显式给出导数的采样。" },
  textureProj: { signature: "vec4 textureProj(sampler2D s, vec3 p)", doc: "投影采样，uv = p.xy / p.z。" },
  textureSize: { signature: "ivec2 textureSize(sampler2D s, int lod)", doc: "纹理在指定层级的尺寸（纹素）。" },
  texelFetch: { signature: "vec4 texelFetch(sampler2D s, ivec2 p, int lod)", doc: "按整数纹素坐标直接读取，不经过过滤与环绕。" },
  texelFetchOffset: { signature: "vec4 texelFetchOffset(sampler2D s, ivec2 p, int lod, ivec2 offset)", doc: "带偏移的 texelFetch。" },

  // 导数
  dFdx: { signature: `${G} dFdx(${G} p)`, doc: "屏幕空间 x 方向的偏导数。" },
  dFdy: { signature: `${G} dFdy(${G} p)`, doc: "屏幕空间 y 方向的偏导数。" },
  fwidth: { signature: `${G} fwidth(${G} p)`, doc: "abs(dFdx(p)) + abs(dFdy(p))，常用于与分辨率无关的抗锯齿。" },

  // 打包
  packSnorm2x16: { signature: "uint packSnorm2x16(vec2 v)", doc: "把两个 [-1,1] 的值打包成 uint。" },
  unpackSnorm2x16: { signature: "vec2 unpackSnorm2x16(uint p)", doc: "packSnorm2x16 的逆操作。" },
  packUnorm2x16: { signature: "uint packUnorm2x16(vec2 v)", doc: "把两个 [0,1] 的值打包成 uint。" },
  unpackUnorm2x16: { signature: "vec2 unpackUnorm2x16(uint p)", doc: "packUnorm2x16 的逆操作。" },
  packHalf2x16: { signature: "uint packHalf2x16(vec2 v)", doc: "把两个 float 打包为半精度。" },
  unpackHalf2x16: { signature: "vec2 unpackHalf2x16(uint p)", doc: "packHalf2x16 的逆操作。" },
};

/** 类型构造函数的简短说明，悬停在 vec3 等类型上时显示。 */
export const TYPE_DOCS: Record<string, string> = {
  float: "32 位浮点数。", int: "有符号整数。", uint: "无符号整数。", bool: "布尔值。", void: "无返回值。",
  vec2: "2 分量浮点向量。可用 .xy / .rg / .st 访问。",
  vec3: "3 分量浮点向量。常用于颜色 RGB 或 3D 位置。",
  vec4: "4 分量浮点向量。常用于 RGBA 颜色。",
  mat2: "2×2 浮点矩阵，按列存储。", mat3: "3×3 浮点矩阵，按列存储。", mat4: "4×4 浮点矩阵，按列存储。",
  sampler2D: "2D 纹理采样器，配合 texture() 使用。",
};

export interface SnippetDef {
  label: string;
  detail: string;
  /** 使用 CodeMirror snippet 语法：${1:占位} 表示可跳转字段。 */
  template: string;
}

export const SNIPPETS: SnippetDef[] = [
  {
    label: "mainImage",
    detail: "Shadertoy 入口",
    template:
      "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n\tvec2 uv = fragCoord / iResolution.xy;\n\t${}\n\tfragColor = vec4(${uv, 0.0}, 1.0);\n}",
  },
  {
    label: "uv",
    detail: "居中并按短边归一化的坐标",
    template: "vec2 ${uv} = (fragCoord * 2.0 - iResolution.xy) / min(iResolution.x, iResolution.y);",
  },
  {
    label: "for",
    detail: "for 循环",
    template: "for (int ${1:i} = 0; ${1:i} < ${2:8}; ${1:i}++) {\n\t${0}\n}",
  },
  {
    label: "if",
    detail: "if 语句",
    template: "if (${condition}) {\n\t${}\n}",
  },
  {
    label: "func",
    detail: "函数定义",
    template: "${float} ${name}(${vec2 p}) {\n\t${}\n\treturn ${0.0};\n}",
  },
  {
    label: "rot2d",
    detail: "2D 旋转矩阵",
    template: "mat2 rot2d(float a) {\n\tfloat c = cos(a), s = sin(a);\n\treturn mat2(c, -s, s, c);\n}",
  },
  {
    label: "palette",
    detail: "余弦调色板",
    template:
      "vec3 palette(float t) {\n\tvec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0);\n\tvec3 d = vec3(${0.0, 0.33, 0.67});\n\treturn a + b * cos(6.28318 * (c * t + d));\n}",
  },
  {
    label: "hash21",
    detail: "vec2 → float 伪随机",
    template: "float hash21(vec2 p) {\n\tp = fract(p * vec2(123.34, 456.21));\n\tp += dot(p, p + 45.32);\n\treturn fract(p.x * p.y);\n}",
  },
  {
    label: "noise",
    detail: "2D 值噪声（需要 hash21）",
    template:
      "float noise(vec2 p) {\n\tvec2 i = floor(p), f = fract(p);\n\tvec2 u = f * f * (3.0 - 2.0 * f);\n\treturn mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),\n\t           mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);\n}",
  },
  {
    label: "sdCircle",
    detail: "圆的有向距离场",
    template: "float sdCircle(vec2 p, float r) {\n\treturn length(p) - r;\n}",
  },
  {
    label: "sdBox",
    detail: "矩形的有向距离场",
    template: "float sdBox(vec2 p, vec2 b) {\n\tvec2 d = abs(p) - b;\n\treturn length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);\n}",
  },
  {
    label: "smin",
    detail: "平滑最小值（SDF 融合）",
    template: "float smin(float a, float b, float k) {\n\tfloat h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);\n\treturn mix(b, a, h) - k * h * (1.0 - h);\n}",
  },
  {
    label: "tex",
    detail: "按画布坐标采样纹理槽",
    template: "texture(iChannel${1:0}, fragCoord / iResolution.xy).rgb",
  },
];

export function lookupSymbol(word: string): { kind: string; doc: SymbolDoc } | null {
  if (APP_SYMBOLS[word]) return { kind: "内置 uniform", doc: APP_SYMBOLS[word] };
  if (BUILTIN_VARIABLES[word]) return { kind: "内置变量", doc: BUILTIN_VARIABLES[word] };
  if (BUILTIN_FUNCTIONS[word]) return { kind: "内置函数", doc: BUILTIN_FUNCTIONS[word] };
  if (TYPE_DOCS[word]) return { kind: "类型", doc: { signature: word, doc: TYPE_DOCS[word] } };
  return null;
}
