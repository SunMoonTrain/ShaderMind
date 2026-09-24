import {
  VERTEX_SHADER,
  buildFragmentSource,
  HEADER_LINES,
  parseShaderLog,
  type ShaderDiagnostic,
} from "./glsl";

export type WrapMode = "repeat" | "clamp";
export type FilterMode = "linear" | "nearest";

export interface ChannelParams {
  wrap: WrapMode;
  filter: FilterMode;
}

export interface FrameStats {
  time: number;
  fps: number;
  width: number;
  height: number;
}

interface Channel {
  texture: WebGLTexture;
  width: number;
  height: number;
  params: ChannelParams;
}

interface Uniforms {
  iTime: WebGLUniformLocation | null;
  iResolution: WebGLUniformLocation | null;
  iMouse: WebGLUniformLocation | null;
  iChannel: (WebGLUniformLocation | null)[];
  iChannelResolution: WebGLUniformLocation | null;
}

export const CHANNEL_COUNT = 4;

/**
 * 只负责画面：编译片段着色器、维护 4 个纹理槽、驱动 rAF 循环。
 *
 * 编译失败时不会替换 program，因此画面停留在上一次成功的着色器上，不会黑屏。
 */
export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly vertexShader: WebGLShader;
  private readonly channels: Channel[] = [];

  private program: WebGLProgram | null = null;
  private uniforms: Uniforms | null = null;

  private channelResolution = new Float32Array(CHANNEL_COUNT * 2);
  private mouse: [number, number] = [0.5, 0.5];

  private elapsed = 0;
  private lastTick = 0;
  private paused = false;
  private rafId = 0;

  private frameCount = 0;
  private fpsWindowStart = 0;
  private fps = 0;

  /** 每帧结束后回调，用于刷新工具栏上的读数。 */
  onStats: ((stats: FrameStats) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("当前环境不支持 WebGL2");
    this.gl = gl;

    const vs = this.compileStage(gl.VERTEX_SHADER, VERTEX_SHADER);
    if (typeof vs === "string") throw new Error("内置顶点着色器编译失败：" + vs);
    this.vertexShader = vs;

    // 绑定一个空 VAO；顶点数据完全由 gl_VertexID 生成，不需要任何属性。
    gl.bindVertexArray(gl.createVertexArray());
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    for (let i = 0; i < CHANNEL_COUNT; i++) {
      this.channels.push({
        texture: gl.createTexture()!,
        width: 1,
        height: 1,
        params: { wrap: "repeat", filter: "linear" },
      });
      this.clearChannel(i);
    }
  }

  // ---------------------------------------------------------------- 着色器

  private compileStage(type: number, source: string): WebGLShader | string {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "";
      gl.deleteShader(shader);
      return log;
    }
    return shader;
  }

  /**
   * 编译并启用新的片段着色器。
   * 返回空数组表示成功；否则返回带编辑器行号的诊断信息，且画面保持不变。
   */
  compile(userSource: string): ShaderDiagnostic[] {
    const gl = this.gl;
    const userLines = userSource.split("\n").length;
    const stage = this.compileStage(gl.FRAGMENT_SHADER, buildFragmentSource(userSource));

    if (typeof stage === "string") {
      const diagnostics = parseShaderLog(stage, HEADER_LINES, userLines);
      return diagnostics.length
        ? diagnostics
        : [
            {
              severity: "error",
              line: null,
              message: "片段着色器编译失败（驱动未给出原因）",
              raw: stage,
            },
          ];
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, this.vertexShader);
    gl.attachShader(program, stage);
    gl.linkProgram(program);
    gl.deleteShader(stage);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "";
      gl.deleteProgram(program);
      const diagnostics = parseShaderLog(log, HEADER_LINES, userLines);
      return diagnostics.length
        ? diagnostics
        : [{ severity: "error", line: null, message: "着色器链接失败", raw: log }];
    }

    if (this.program) gl.deleteProgram(this.program);
    this.program = program;
    this.uniforms = {
      iTime: gl.getUniformLocation(program, "iTime"),
      iResolution: gl.getUniformLocation(program, "iResolution"),
      iMouse: gl.getUniformLocation(program, "iMouse"),
      iChannel: Array.from({ length: CHANNEL_COUNT }, (_, i) =>
        gl.getUniformLocation(program, "iChannel" + i),
      ),
      iChannelResolution:
        gl.getUniformLocation(program, "iChannelResolution[0]") ??
        gl.getUniformLocation(program, "iChannelResolution"),
    };
    return [];
  }

  // ---------------------------------------------------------------- 纹理

  private applyParams(index: number): void {
    const gl = this.gl;
    const channel = this.channels[index];
    const wrap = channel.params.wrap === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    const filter = channel.params.filter === "linear" ? gl.LINEAR : gl.NEAREST;

    gl.bindTexture(gl.TEXTURE_2D, channel.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  setChannelImage(index: number, image: TexImageSource, params?: Partial<ChannelParams>): void {
    const gl = this.gl;
    const channel = this.channels[index];
    Object.assign(channel.params, params);

    gl.bindTexture(gl.TEXTURE_2D, channel.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const width = (image as HTMLImageElement).naturalWidth || (image as ImageBitmap).width || 1;
    const height = (image as HTMLImageElement).naturalHeight || (image as ImageBitmap).height || 1;
    channel.width = width;
    channel.height = height;
    this.channelResolution[index * 2] = width;
    this.channelResolution[index * 2 + 1] = height;
    this.applyParams(index);
  }

  /** 槽位置空：绑定 1×1 黑色纹理，保证采样它的着色器依然能正常运行。 */
  clearChannel(index: number): void {
    const gl = this.gl;
    const channel = this.channels[index];

    gl.bindTexture(gl.TEXTURE_2D, channel.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    channel.width = 1;
    channel.height = 1;
    this.channelResolution[index * 2] = 1;
    this.channelResolution[index * 2 + 1] = 1;
    this.applyParams(index);
  }

  setChannelParams(index: number, params: Partial<ChannelParams>): void {
    Object.assign(this.channels[index].params, params);
    this.applyParams(index);
  }

  // ---------------------------------------------------------------- 时间 / 输入

  setMouse(x: number, y: number): void {
    this.mouse = [x, y];
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  resetTime(): void {
    this.elapsed = 0;
  }

  getTime(): number {
    return this.elapsed;
  }

  // ---------------------------------------------------------------- 循环

  start(): void {
    if (this.rafId) return;
    this.lastTick = performance.now();
    this.fpsWindowStart = this.lastTick;
    const loop = (now: number) => {
      this.rafId = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (!this.rafId) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private resize(): [number, number] {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    return [width, height];
  }

  private frame(now: number): void {
    const gl = this.gl;

    const dt = Math.min((now - this.lastTick) / 1000, 0.25);
    this.lastTick = now;
    if (!this.paused) this.elapsed += dt;

    const [width, height] = this.resize();

    if (this.program && this.uniforms) {
      const u = this.uniforms;
      gl.useProgram(this.program);

      if (u.iTime) gl.uniform1f(u.iTime, this.elapsed);
      if (u.iResolution) gl.uniform2f(u.iResolution, width, height);
      if (u.iMouse) gl.uniform2f(u.iMouse, this.mouse[0], this.mouse[1]);
      if (u.iChannelResolution) gl.uniform2fv(u.iChannelResolution, this.channelResolution);

      for (let i = 0; i < CHANNEL_COUNT; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, this.channels[i].texture);
        const loc = u.iChannel[i];
        if (loc) gl.uniform1i(loc, i);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    this.frameCount++;
    if (now - this.fpsWindowStart >= 500) {
      this.fps = (this.frameCount * 1000) / (now - this.fpsWindowStart);
      this.frameCount = 0;
      this.fpsWindowStart = now;
    }
    this.onStats?.({ time: this.elapsed, fps: this.fps, width, height });
  }
}
