// 渲染应用图标。默认是 A 版（小白核 + 八道光线的星星，硬边，没有底盘，规格见 shadeA 上方的注释），
// 另外保留了两版早先的试验风格（bigbang / ripple），配色都是示例着色器的余弦调色板。
// 在 CPU 上逐像素求值（超采样抗锯齿），不依赖任何第三方包。
//
//   node scripts/render-icon.mjs
//
// 一条命令导出全部：
//   1. 先用 1024 的图跑一次 `tauri icon`，刷新 icns、Square*Logo 等其它平台的文件；
//   2. 再把 16 / 32 / 48 / 64 / 128 / 256 / 512 / 1024 每个尺寸单独按规格绘制，覆盖进 src-tauri/icons/，
//      icon.ico 用单独绘制的 256 / 48 / 32 / 16 打包（256 在最前，见下方注释）—— 都不从大图缩小；
//   3. 标题栏用的 src/assets/app-icon.svg（矢量，任何缩放都清晰）。
//
// 预览单张：node scripts/render-icon.mjs --style=bigbang out.png 256
import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 示例着色器里的 palette()。 */
function palette(t) {
  return [0, 0.28, 0.55].map((d) => 0.55 + 0.45 * Math.cos(TAU * (t + d)));
}

// ---------------------------------------------------------------- A 版：小白核 + 八道光线
//
// 坐标：中心为原点，半径 1 = 边长的一半；角度以正上方为 0°，顺时针增加。
// 图层（从下往上，全部硬边，只有抗锯齿；光线和白核以外全部透明，不画底盘）：
//   1. 八道光线 i = 0..7：方向 i × 45°，三角形；底边两点在半径 0.2、方向 ± 0.32 弧度，
//      尖端半径偶数 0.98、奇数 0.68；颜色 palette(i / 8)，截断到 [0, 1]
//   2. 中心白核：半径 0.15，#FFFFFF
// （最初的规格是白核 0.11、底边 0.16 / ±0.2、尖端 0.828 / 0.558，后来整体加粗加大到现在的数值）

const A_CORE_R = 0.15;
const A_RAY_BASE_R = 0.2;
const A_RAY_HALF_WIDTH = 0.32;
const A_RAY_TIP = [0.98, 0.68];

/** 极坐标（角度从正上方顺时针）转成 y 朝上的平面坐标。 */
const polar = (radius, angle) => [radius * Math.sin(angle), radius * Math.cos(angle)];

const A_RAYS = Array.from({ length: 8 }, (_, i) => {
  const dir = (i * Math.PI) / 4;
  return {
    points: [
      polar(A_RAY_BASE_R, dir - A_RAY_HALF_WIDTH),
      polar(A_RAY_TIP[i % 2], dir),
      polar(A_RAY_BASE_R, dir + A_RAY_HALF_WIDTH),
    ],
    color: palette(i / 8).map(clamp01),
  };
});

function inTriangle(x, y, [[ax, ay], [bx, by], [cx, cy]]) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function shadeA(x, y) {
  if (Math.hypot(x, y) <= A_CORE_R) return [1, 1, 1, 1];
  for (const ray of A_RAYS) if (inTriangle(x, y, ray.points)) return [...ray.color, 1];
  return [0, 0, 0, 0];
}

/** 同一套几何的 SVG（标题栏用）。viewBox 是 [-1, 1]，SVG 的 y 朝下，所以翻一下 y。 */
function svgA() {
  const hex = (rgb) => "#" + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
  const pt = ([x, y]) => `${+x.toFixed(5)},${+(-y).toFixed(5)}`;
  const rays = A_RAYS.map((ray) => `  <polygon points="${ray.points.map(pt).join(" ")}" fill="${hex(ray.color)}"/>`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2">`,
    `  <!-- 由 scripts/render-icon.mjs 生成，不要手改 -->`,
    ...rays,
    `  <circle r="${A_CORE_R}" fill="#ffffff"/>`,
    `</svg>`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- 试验风格：涟漪

/** 涟漪风格：一个采样点的颜色（rgb + alpha）。x、y 在 [-1, 1]，y 朝上。 */
function shadeRipple(x, y) {
  // 圆形图标，圆外完全透明
  const r = Math.hypot(x, y);
  if (r > 1) return [0, 0, 0, 0];
  const a = Math.atan2(y, x);

  // 向外扩散的同心圆环：只有三圈左右，越往外越疏、越暗；纯余弦明暗，环与环之间是平滑过渡
  const phase = r * 4 - Math.pow(r, 1.6) * 0.9;
  const wave = 0.5 + 0.5 * Math.cos(TAU * phase);
  const ring = wave * Math.exp(-r * 0.8);

  // 颜色沿半径和角度一起流动；环少了，靠更大的半径跨度保证色彩够丰富
  let col = palette(r * 1.35 + phase * 0.1 + 0.06 * Math.sin(a * 3));

  // 环亮、环间暗，中心发光，边缘压暗
  const glow = 0.05 / (r + 0.06);
  const vignette = 1 - 0.65 * smoothstep(0.55, 1.45, r);
  col = col.map((c) => (c * (0.42 + 1.1 * ring) + glow) * vignette);

  // 底色：深紫黑，让暗处也带颜色
  const base = [0.05, 0.035, 0.09];
  col = col.map((c, i) => base[i] + c);
  return [...col.map((c) => Math.pow(clamp01(c), 0.9)), 1];
}

// ---------------------------------------------------------------- 大爆炸风格

/** 2D 哈希，返回 [0, 1)。 */
function hash(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** 值噪声。 */
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y) {
  let v = 0, amp = 0.5;
  for (let i = 0; i < 5; i++) {
    v += amp * noise(x, y);
    // 每层旋转一下再放大，避免网格感
    [x, y] = [x * 1.6 - y * 1.2 + 3.1, x * 1.2 + y * 1.6 + 1.7];
    amp *= 0.5;
  }
  return v;
}

/** 星点：把平面分成格子，少数格子里放一颗随机位置、随机亮度的星。 */
function stars(x, y, cells) {
  const gx = (x + 1) * cells, gy = (y + 1) * cells;
  const cx = Math.floor(gx), cy = Math.floor(gy);
  if (hash(cx, cy) < 0.88) return 0;
  const sx = cx + 0.2 + 0.6 * hash(cx + 7.1, cy + 3.3);
  const sy = cy + 0.2 + 0.6 * hash(cx + 1.9, cy + 9.4);
  const d = Math.hypot(gx - sx, gy - sy);
  const size = 0.06 + 0.1 * hash(cx + 4.2, cy + 8.8);
  return Math.exp(-(d * d) / (size * size)) * (0.4 + 0.6 * hash(cx + 2.5, cy + 6.6));
}

/** 宇宙大爆炸：白热的核心、向外迸射的光芒、彩色星云、冲击波环，背景是星空。 */
function shadeBigBang(x, y) {
  const r = Math.hypot(x, y);
  if (r > 1) return [0, 0, 0, 0];
  const dx = x / (r || 1), dy = y / (r || 1);

  // 深空底色 + 两层星点（近处少而亮，远处多而暗）
  let col = [0.012, 0.01, 0.035];
  const s = stars(x, y, 26) + 0.6 * stars(x + 0.37, y - 0.21, 55);
  col = col.map((c, i) => c + s * [0.9, 0.95, 1.1][i]);

  // 星云：扭曲过的 fbm，按半径越往外越淡，颜色用示例着色器的调色板
  const wx = fbm(x * 2.2 + 5.2, y * 2.2 + 1.3);
  const wy = fbm(x * 2.2 + 8.3, y * 2.2 + 2.8);
  const cloud = fbm(x * 2.6 + wx * 1.8, y * 2.6 + wy * 1.8);
  const density = smoothstep(0.38, 0.85, cloud) * (1 - smoothstep(0.25, 1.0, r));
  const nebula = palette(cloud * 1.6 + r * 0.4 + 0.6);
  col = col.map((c, i) => c + nebula[i] * density * 1.6);

  // 光芒：只随方向变化的噪声，拉成一根根放射状的光束（粗光束 + 细丝），越往外越弱
  const rays =
    Math.pow(fbm(dx * 4 + 10, dy * 4 + 10), 4) * 8 + Math.pow(fbm(dx * 13 + 4, dy * 13 + 4), 5) * 6;
  const rayFade = Math.exp(-r * 1.9);
  const rayCol = palette(0.08 + r * 0.5);
  col = col.map((c, i) => c + rayCol[i] * rays * rayFade);

  // 冲击波：一圈被噪声打散的亮环，颜色绕一圈走完整个彩虹
  const shock = Math.exp(-Math.pow((r - 0.6 - 0.04 * (wx - 0.5)) * 11, 2)) * (0.35 + 0.9 * cloud);
  const shockCol = palette(Math.atan2(y, x) / TAU + 0.3 * wy);
  col = col.map((c, i) => c + shockCol[i] * shock * 0.9);

  // 核心：白热的点 + 偏暖的辉光 + 外面一层品红色的光晕
  const core = Math.exp(-r * r * 90) * 2.5 + 0.035 / (r + 0.015);
  const halo = Math.exp(-r * 4.5) * 0.55;
  col = col.map((c, i) => c + core * [1.0, 0.8, 0.6][i] + halo * [1.0, 0.35, 0.7][i]);

  // 色调映射：高光柔和地压到 1 以内，不会一片死白
  return [...col.map((c) => Math.pow(1 - Math.exp(-c * 1.35), 0.85)), 1];
}

const STYLES = { a: shadeA, ripple: shadeRipple, bigbang: shadeBigBang };

function render(size, samples, shade) {
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) / samples) / size) * 2 - 1;
          const y = 1 - ((py + (sy + 0.5) / samples) / size) * 2;
          const c = shade(x, y);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const i = (py * size + px) * 4;
      // 取平均后除回 alpha（非预乘），边缘半透明像素颜色才不会发黑
      out[i] = a ? Math.round((r / a) * 255) : 0;
      out[i + 1] = a ? Math.round((g / a) * 255) : 0;
      out[i + 2] = a ? Math.round((b / a) * 255) : 0;
      out[i + 3] = Math.round((a / (samples * samples)) * 255);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 最小 PNG 编码

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 位深
  header[9] = 6; // RGBA
  // 每行前面加一个 0（不做行过滤）
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 把几张 PNG 原样打包成 .ico（Vista 起支持 PNG 格式的图标项）。 */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // 类型：图标
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = entries.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 表示 256
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // 色彩平面
    e.writeUInt16LE(32, 6); // 位深
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

/** 超采样数：小图多采一些，抗锯齿边缘才平滑。 */
const samplesFor = (size) => (size <= 64 ? 8 : size <= 256 ? 6 : 4);

const styleArg = process.argv.find((a) => a.startsWith("--style="));
const styleName = styleArg ? styleArg.slice("--style=".length) : "a";
const shade = STYLES[styleName];
if (!shade) throw new Error(`未知风格 ${styleName}，可选：${Object.keys(STYLES).join(" / ")}`);
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (args[0]) {
  // 预览单张
  const size = Number(args[1] ?? 256);
  writeFileSync(args[0], encodePng(size, render(size, samplesFor(size), shade)));
  console.log(`wrote ${args[0]} (${size}×${size})`);
} else {
  const ICONS = "src-tauri/icons";
  const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
  const pngs = new Map(SIZES.map((size) => [size, encodePng(size, render(size, samplesFor(size), shade))]));

  // 1. 用 1024 的图刷新其它平台的文件（icns、Windows 商店的 Square*Logo 等），手机端的不要
  writeFileSync(`${ICONS}/1024x1024.png`, pngs.get(1024));
  execSync(`npx tauri icon ${ICONS}/1024x1024.png`, { stdio: "ignore" });
  rmSync(`${ICONS}/android`, { recursive: true, force: true });
  rmSync(`${ICONS}/ios`, { recursive: true, force: true });

  // 2. 每个尺寸单独绘制的结果覆盖进去；tauri.conf.json 引用的 128x128@2x / icon.png 也用对应尺寸
  for (const [size, png] of pngs) writeFileSync(`${ICONS}/${size}x${size}.png`, png);
  writeFileSync(`${ICONS}/128x128@2x.png`, pngs.get(256));
  writeFileSync(`${ICONS}/icon.png`, pngs.get(512));
  // 256 必须排第一：tauri-codegen 取 icon.ico 的第一项当窗口图标（任务栏显示的就是它），
  // 第一项若是 16，任务栏会把 16×16 放大显示，一片模糊
  writeFileSync(`${ICONS}/icon.ico`, encodeIco([256, 48, 32, 16].map((size) => ({ size, png: pngs.get(size) }))));
  console.log(`wrote ${ICONS}: ${SIZES.join(" / ")} 的 PNG 与 icon.ico（256 / 48 / 32 / 16）`);

  // 3. 标题栏用的矢量图
  if (styleName === "a") {
    writeFileSync("src/assets/app-icon.svg", svgA());
    console.log("wrote src/assets/app-icon.svg");
  }
}
