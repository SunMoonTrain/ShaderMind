# ShaderMind

一个基于 Tauri 2 的 GLSL 片段着色器实时预览工具。

左边写代码，右边出画面，底下挂纹理。停止输入 300ms 自动重新编译，不需要点任何"运行"按钮；
编译失败时画面停留在上一次成功的结果上，不会黑屏，错误信息带行号列在编辑区下方。

## 功能

- **WebGL2 渲染**，只需要写片段着色器；顶点着色器内置一个铺满屏幕的三角形（`gl_VertexID` 生成，无顶点缓冲）
- **与 Shadertoy 兼容**：入口写 `mainImage()`，内置 uniform 的名称、类型和含义都和 Shadertoy 一致，单 pass 的代码可以原样粘贴
- **VS Code 风格的编辑器**（CodeMirror 6）：
  - 针对 GLSL ES 3.00 的语法高亮，区分关键字、类型、内置函数、内置 uniform、分量（`.xyz`）等
  - 智能补全：内置函数（带签名与中文说明）、uniform、你自己定义的函数 / 变量 / 宏、`.` 之后的分量、常用代码片段
  - 悬停提示：鼠标停在函数或变量上显示签名与说明
  - 多光标、列选择、移动 / 复制 / 删除行、切换注释等 VS Code 快捷键
  - 括号配对着色、缩进参考线、代码折叠、查找替换、跳转到行
  - **颜色色块**：`vec3(…)` / `vec4(…)` 颜色字面量前显示色块，点一下用取色器改颜色
  - **数值滑条**（参考 The Book of Shaders 编辑器）：单击数字弹出滑条，单击 `vec2(…)` 弹出二维调节板，拖动时画面实时更新
  - **拖动调值**：按住 Alt 左右拖动数字，实时看画面变化
- **5 套配色主题**（Dark Modern / One Dark Pro / Tokyo Night / Catppuccin Mocha / Light Modern），整个界面一起切换
- **字体设置**：内置 JetBrains Mono（带连字），也可选系统里的 Cascadia Code、Fira Code 等或自填字体名；字号、行高、连字可调
- **命令面板**（Ctrl+Shift+P）：所有功能都能搜到，支持 `:行号` 快速跳转
- **300ms 防抖自动重编译**（延迟可调），编译失败保留上一帧画面；错误在编辑器里画波浪线、行号旁标红点，
  同时列在编辑区下方的"问题"面板里，点击跳转
- **4 个纹理槽**（`iChannel0`..`iChannel3`），拖入或点击选择本地图片，每槽可切 `repeat`/`clamp` 与 `linear`/`nearest`
- **会话恢复**：源码、文件路径、纹理路径、播放状态、分栏比例、编辑器设置都记在本地配置里，重开即恢复
- **自绘标题栏**：不用系统标题栏，工具栏兼作标题栏（空白处拖动窗口、双击最大化），右上角是自己画的窗口按钮
- **窗口记忆**：尺寸与位置由 `tauri-plugin-window-state` 保存
- **GLSL 文件读写**：打开 / 保存 / 另存为，也可以直接把 `.glsl` 拖进窗口

## 快速开始

需要 [Node.js](https://nodejs.org/) 18+、[Rust](https://rustup.rs/) 1.77+，以及
[Tauri 的系统依赖](https://tauri.app/start/prerequisites/)（Windows 上是 WebView2 + MSVC 生成工具）。

```bash
npm install
```

开发模式（热更新）：

```bash
npm run tauri dev
```

打包安装程序：

```bash
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/` 下（`target/` 被 git 忽略，编辑器的文件树里可能看不到）：

- `nsis/ShaderMind_<版本>_x64-setup.exe`：安装向导，一般用这个
- `msi/ShaderMind_<版本>_x64_en-US.msi`：MSI 包，适合批量部署

## 使用方法

### 写着色器

写法和 Shadertoy 一样：`#version`、`precision` 和所有内置 uniform 的声明都已经由程序拼在你的代码前面，
编辑器里只需要写 `mainImage()`：

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}
```

真正的 `main()` 由程序接在代码末尾（不影响行号），输出的 alpha 固定为 1，和 Shadertoy 的显示一致。
也可以不写 `mainImage()`，自己写 `main()` 并把颜色写进全局输出 `fragColor`。

从别处粘进来的代码如果自带 `#version`，会被自动去掉（替换成空行，行号不受影响）。

### 内置 uniform

和 Shadertoy 一致：

| 名称 | 类型 | 含义 |
| --- | --- | --- |
| `iResolution` | `vec3` | 画布的像素尺寸（已乘 DPR，上限 2×）；`z` 为像素宽高比，恒为 `1.0` |
| `iTime` | `float` | 运行秒数，受工具栏的暂停 / 归零控制 |
| `iTimeDelta` | `float` | 上一帧耗时（秒），暂停时为 0 |
| `iFrameRate` | `float` | 当前帧率 |
| `iFrame` | `int` | 帧序号，暂停时不增加，时间归零时一起归零 |
| `iMouse` | `vec4` | 鼠标像素坐标，**左下角为原点**。`xy`：按住左键时的当前位置，松开后保持；`zw`：按下的位置，按住时 `z` 为正、松开后为负，`w` 只在按下那一帧为正 |
| `iDate` | `vec4` | 本地日期：年、月（0 起）、日、当天已过秒数 |
| `iChannel0` .. `iChannel3` | `sampler2D` | 底部四个纹理槽 |
| `iChannelResolution[4]` | `vec3[4]` | 各槽位纹理的像素尺寸；空槽为 `vec3(1.0)` |
| `iChannelTime[4]` | `float[4]` | 各槽位的播放时间；图片槽位等于 `iTime` |
| `iSampleRate` | `float` | 音频采样率，固定 `44100` |

另外定义了宏 `HW_PERFORMANCE`（值为 `1`），引用它的 Shadertoy 代码也能直接编译。

> 目前只支持单 pass：Buffer A–D、Common、Sound 标签页，以及立方体贴图、视频、键盘等输入还没有实现。
> 纹理槽始终是 `sampler2D`，按 Shadertoy 默认的 vflip 方式上传。

### 纹理

- **点击**槽位左侧的缩略图打开文件选择框，或者直接把图片**拖进**某个槽位
- 一次拖多张图会从命中的槽位开始依次填充；没落在槽位上则填进第一个空槽
- `repeat` / `clamp` 切换环绕方式，`linear` / `nearest` 切换采样过滤，默认 `repeat + linear`
- 空槽绑定的是 1×1 黑色纹理，所以采样空槽的着色器照样能跑，不会报错
- 配置里**只存图片路径**，不存图片数据；如果原文件被移走，该槽位会标红提示，其余槽位不受影响

### 编辑器

- **补全**：打字时自动弹出，`Tab` 或 `Enter` 接受；`Ctrl+Space` 手动触发。输入 `mainImage`、`uv`、`for`、`rot2d`、
  `palette`、`hash21`、`noise`、`sdBox`、`smin` 等可以展开成代码片段，用 `Tab` 在占位符之间跳转
- **悬停**：鼠标停在内置函数、uniform 或你自己定义的函数上，显示签名和说明
- **颜色色块**：`vec3(1.0, 0.5, 0.2)` 这类颜色字面量前面会出现一个小色块，点击弹出取色器，选色时代码和画面同步变化
- **数值滑条**：单击代码里的数字，下方弹出滑条，拖动即可改值，画面跟着实时重编译（不走防抖）。
  范围按数值自动选取：`0..1` 之内的数用 `[0, 1]`，`-1..1` 之内用 `[-1, 1]`，更大的数按数量级放大；整数步长为 1。
  单击 `vec2(x, y)` 的 `vec2` 或括号，弹出二维调节板，拖动圆点同时改两个分量，方向键微调（`Shift` 加大步长）。
  `Esc` 或 `Enter` 关闭，单击别处或编辑其它内容也会关闭
- **拖动调值**：按住 `Alt`，在数字上左右拖动即可调整数值（同时按住 `Shift` 精调，多一位小数）；
  `Alt` 单击数字但不拖动时，仍然是添加光标
- **设置**：点工具栏右上角的按钮或按 `Ctrl+,`，可以换主题、字体、字号、行高、缩进宽度，
  开关自动换行、行号、括号着色、缩进参考线、颜色色块、数值滑条、自动补全，调整自动编译延迟。修改即时生效并自动保存
- **命令面板**：`Ctrl+Shift+P` 或 `F1`，所有操作都能搜到；输入 `:42` 回车跳到第 42 行

### 快捷键

与 VS Code 保持一致：

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl+Shift+P` / `F1` | 命令面板 |
| `Ctrl+,` | 设置 |
| `Ctrl+O` | 打开 `.glsl` 文件 |
| `Ctrl+S` / `Ctrl+Shift+S` | 保存 / 另存为 |
| `Ctrl+D` | 选中下一个相同内容（多光标） |
| `Ctrl+Shift+L` | 选中所有相同内容 |
| `Alt+单击` | 添加光标 |
| `Ctrl+Alt+↑` / `↓` | 在上 / 下一行添加光标 |
| `Shift+Alt+拖动` | 列选择 |
| `Alt+拖动数字` | 调整数值（加 `Shift` 精调） |
| `Alt+↑` / `↓` | 上下移动行 |
| `Shift+Alt+↑` / `↓` | 向上 / 下复制行 |
| `Ctrl+Shift+K` | 删除行 |
| `Ctrl+L` | 选中整行 |
| `Ctrl+/` | 切换行注释 |
| `Ctrl+]` / `Ctrl+[` | 增加 / 减少缩进 |
| `Ctrl+F` / `Ctrl+H` | 查找 / 替换 |
| `Ctrl+G` | 跳转到行 |
| `Ctrl+Shift+[` / `]` | 折叠 / 展开代码块 |
| `F8` | 跳到下一个错误 |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | 放大 / 缩小 / 重置字号（也可以 `Ctrl+滚轮`） |
| `Ctrl+R` | 时间归零 |
| `空格`（焦点不在编辑器时） | 暂停 / 继续时间 |

底部状态栏依次显示：错误 / 警告数（点击跳到第一个错误）、文件路径、光标位置、选区信息、
缩进宽度（点击切换 2/4/8）、字号（点击打开设置）、`iTime`、画布分辨率、帧率。
编辑区和预览区之间的竖条可以拖动调整宽度，双击恢复均分。

## 项目结构

```
ShaderMind/
├─ index.html              页面骨架：工具栏 / 编辑区 / 预览区 / 纹理槽
├─ package.json
├─ vite.config.ts          Vite 配置（固定 1420 端口供 Tauri 连接）
├─ tsconfig.json
├─ src/                    前端
│  ├─ main.ts              入口：串起编辑器、渲染器、纹理槽、命令、快捷键、文件与配置读写
│  ├─ renderer.ts          WebGL2 渲染器：编译着色器、管理 4 个纹理、rAF 循环
│  ├─ channels.ts          底部纹理槽的 UI、拖放命中测试与图片上传
│  ├─ glsl.ts              内置顶点着色器、片段着色器头部、示例代码、编译日志解析
│  ├─ config.ts            配置结构、字段收敛，以及对 Rust 命令的封装
│  ├─ settings.ts          编辑器设置的结构与默认值、字体预设与检测
│  ├─ styles.css           界面样式（颜色全部来自主题变量）
│  ├─ editor/              编辑器
│  │  ├─ index.ts          组装 CodeMirror：可热切换的设置、诊断、光标信息
│  │  ├─ glsl-language.ts  GLSL 分词器、缩进、折叠、高亮样式
│  │  ├─ glsl-data.ts      关键字 / 类型 / 内置函数签名与中文说明 / 代码片段
│  │  ├─ completion.ts     自动补全与悬停提示，扫描用户定义的函数和变量
│  │  ├─ decorations.ts    括号配对着色、颜色色块、拖动调值、折行悬挂缩进
│  │  ├─ sliders.ts        单击数字弹出的滑条与 vec2 二维调节板
│  │  ├─ keymap.ts         VS Code 风格快捷键
│  │  └─ themes.ts         5 套主题定义，写成 CSS 变量
│  └─ ui/
│     ├─ palette.ts        命令面板
│     ├─ settings-panel.ts 设置面板
│     └─ icons.ts          线性图标
└─ src-tauri/              Rust 侧
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json      窗口、CSP、打包配置
   ├─ capabilities/        权限清单
   ├─ icons/
   └─ src/
      ├─ main.rs           入口
      └─ lib.rs            五个命令：配置读写、图片读取、文本文件读写
```

### 几个实现上的取舍

- **行号映射**：片段着色器头部是直接拼在用户代码前面的，而各家驱动对 `#line` 指令的处理并不一致，
  所以不发 `#line`，改为在解析编译日志时固定减去头部行数 —— 映射结果是确定的。
- **图片以 data URL 传给前端**（`load_image` 命令），而不是开放 asset 协议，
  这样不必为任意路径放开文件访问范围。
- **编译失败不替换 program**：`Renderer.compile()` 只有在链接成功后才换掉当前 program，
  所以出错时渲染循环继续用旧的着色器画，不会黑屏。
- **纹理恢复在首帧之后**才开始，不拖慢启动。
- **主题只换 CSS 变量**：语法高亮和编辑器外观都引用 `var(--…)`，切主题不需要重建编辑器；
  其它设置（字体、换行、补全等）放在 CodeMirror 的 Compartment 里，改动时只重配对应部分。
- **编译错误没有列号**：驱动只给行号，所以波浪线优先画在错误信息里用引号标出的记号上
  （如 `'nosuchfunc' : no matching overloaded function`），找不到才标整行。

### 配置文件

配置写在系统的应用配置目录下，Windows 上是：

```
%APPDATA%\com.shadermind.desktop\config.json          编辑器内容、文件路径、纹理路径与参数、编辑器设置
%APPDATA%\com.shadermind.desktop\.window-state.json   窗口尺寸与位置
```

删掉 `config.json` 即可恢复成初始的示例着色器。

## 许可证

见 [LICENSE](LICENSE)。
