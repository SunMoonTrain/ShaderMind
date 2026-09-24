import { open } from "@tauri-apps/plugin-dialog";
import { baseName, loadImageDataUrl, type ChannelConfig } from "./config";
import { CHANNEL_COUNT, type FilterMode, type Renderer, type WrapMode } from "./renderer";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

interface SlotState {
  path: string | null;
  wrap: WrapMode;
  filter: FilterMode;
  width: number;
  height: number;
  /** 路径存在但这次加载失败（文件被删/移动）时的说明。 */
  error: string | null;
}

interface SlotDom {
  root: HTMLElement;
  thumb: HTMLElement;
  info: HTMLElement;
  wrapBtn: HTMLButtonElement;
  filterBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
}

/**
 * 底部四个纹理槽。负责 UI、拖放命中测试，以及把图片送进 Renderer。
 */
export class ChannelPanel {
  private readonly slots: SlotState[] = [];
  private readonly dom: SlotDom[] = [];
  private dragTarget: number | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly renderer: Renderer,
    private readonly onChange: () => void,
  ) {
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      this.slots.push({ path: null, wrap: "repeat", filter: "linear", width: 1, height: 1, error: null });
      this.dom.push(this.buildSlot(i));
    }
    this.renderAll();
  }

  private buildSlot(index: number): SlotDom {
    const root = document.createElement("div");
    root.className = "slot";
    root.dataset.index = String(index);
    root.innerHTML = `
      <div class="slot-thumb" title="点击选择图片，或直接把图片拖进来">
        <span class="hint">点击或拖入<br>图片</span>
      </div>
      <div class="slot-body">
        <div class="slot-title">iChannel${index}</div>
        <div class="slot-info">空（1×1 黑色纹理）</div>
        <div class="slot-actions">
          <button data-act="wrap">repeat</button>
          <button data-act="filter">linear</button>
          <button data-act="clear" title="清空该槽位">清空</button>
        </div>
      </div>
    `;

    const dom: SlotDom = {
      root,
      thumb: root.querySelector(".slot-thumb")!,
      info: root.querySelector(".slot-info")!,
      wrapBtn: root.querySelector('[data-act="wrap"]')!,
      filterBtn: root.querySelector('[data-act="filter"]')!,
      clearBtn: root.querySelector('[data-act="clear"]')!,
    };

    dom.thumb.addEventListener("click", () => void this.pickImage(index));
    dom.wrapBtn.addEventListener("click", () => {
      const slot = this.slots[index];
      this.setParams(index, { wrap: slot.wrap === "repeat" ? "clamp" : "repeat" });
    });
    dom.filterBtn.addEventListener("click", () => {
      const slot = this.slots[index];
      this.setParams(index, { filter: slot.filter === "linear" ? "nearest" : "linear" });
    });
    dom.clearBtn.addEventListener("click", () => this.clear(index));

    this.container.appendChild(root);
    return dom;
  }

  // ---------------------------------------------------------------- 状态

  private setParams(index: number, params: Partial<Pick<SlotState, "wrap" | "filter">>): void {
    Object.assign(this.slots[index], params);
    this.renderer.setChannelParams(index, params);
    this.renderSlot(index);
    this.onChange();
  }

  async pickImage(index: number): Promise<void> {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "图片", extensions: IMAGE_EXTENSIONS }],
    });
    if (typeof selected === "string") await this.loadInto(index, selected);
  }

  /** 读取图片并上传到对应纹理单元。 */
  async loadInto(index: number, path: string): Promise<void> {
    const slot = this.slots[index];
    try {
      const dataUrl = await loadImageDataUrl(path);
      const image = new Image();
      image.src = dataUrl;
      await image.decode();

      this.renderer.setChannelImage(index, image, { wrap: slot.wrap, filter: slot.filter });
      slot.path = path;
      slot.width = image.naturalWidth;
      slot.height = image.naturalHeight;
      slot.error = null;
      this.dom[index].thumb.innerHTML = "";
      this.dom[index].thumb.appendChild(image);
    } catch (err) {
      slot.path = path;
      slot.error = String(err);
      this.renderer.clearChannel(index);
      this.dom[index].thumb.innerHTML = '<span class="hint">加载失败</span>';
    }
    this.renderSlot(index);
    this.onChange();
  }

  clear(index: number): void {
    const slot = this.slots[index];
    slot.path = null;
    slot.error = null;
    slot.width = 1;
    slot.height = 1;
    this.renderer.clearChannel(index);
    this.renderer.setChannelParams(index, { wrap: slot.wrap, filter: slot.filter });
    this.dom[index].thumb.innerHTML = '<span class="hint">点击或拖入<br>图片</span>';
    this.renderSlot(index);
    this.onChange();
  }

  /** 启动时按配置恢复（逐个串行，失败的槽位只标红不影响其它槽）。 */
  async restore(configs: (ChannelConfig | null)[]): Promise<void> {
    for (let i = 0; i < CHANNEL_COUNT; i++) {
      const entry = configs[i];
      if (!entry) continue;
      this.slots[i].wrap = entry.wrap;
      this.slots[i].filter = entry.filter;
      this.renderer.setChannelParams(i, { wrap: entry.wrap, filter: entry.filter });
      await this.loadInto(i, entry.path);
    }
    this.renderAll();
  }

  toConfig(): (ChannelConfig | null)[] {
    return this.slots.map((slot) =>
      slot.path ? { path: slot.path, wrap: slot.wrap, filter: slot.filter } : null,
    );
  }

  // ---------------------------------------------------------------- 拖放

  /** 根据窗口坐标找出命中的槽位，给 Tauri 的拖放事件用。 */
  slotIndexAt(clientX: number, clientY: number): number | null {
    for (let i = 0; i < this.dom.length; i++) {
      const r = this.dom[i].root.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return i;
      }
    }
    return null;
  }

  setDragTarget(index: number | null): void {
    if (this.dragTarget === index) return;
    if (this.dragTarget !== null) this.dom[this.dragTarget].root.classList.remove("dragover");
    if (index !== null) this.dom[index].root.classList.add("dragover");
    this.dragTarget = index;
  }

  static isImagePath(path: string): boolean {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return IMAGE_EXTENSIONS.includes(ext);
  }

  // ---------------------------------------------------------------- 渲染

  private renderAll(): void {
    for (let i = 0; i < CHANNEL_COUNT; i++) this.renderSlot(i);
  }

  private renderSlot(index: number): void {
    const slot = this.slots[index];
    const dom = this.dom[index];

    dom.wrapBtn.textContent = slot.wrap;
    dom.filterBtn.textContent = slot.filter;
    dom.clearBtn.disabled = slot.path === null;

    dom.info.classList.toggle("bad", slot.error !== null);
    if (slot.error) {
      dom.info.textContent = `加载失败：${baseName(slot.path ?? "")}`;
      dom.info.title = `${slot.path}\n${slot.error}`;
    } else if (slot.path) {
      dom.info.textContent = `${baseName(slot.path)} · ${slot.width}×${slot.height}`;
      dom.info.title = slot.path;
    } else {
      dom.info.textContent = "空（1×1 黑色纹理）";
      dom.info.title = "";
    }
  }
}
