import { icon } from "./icons";

export interface PaletteCommand {
  id: string;
  title: string;
  /** 分类，显示在标题前，如 "文件"、"视图" */
  category: string;
  /** 快捷键提示 */
  keys?: string;
  /** 额外的搜索关键词（英文名、拼音缩写等） */
  aliases?: string;
  run(): void;
}

const RECENT_KEY = "shadermind.palette.recent";

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 8)));
  } catch {
    // 私密模式等情况下写不进去，无所谓
  }
}

/** 子序列模糊匹配。返回分数（越大越好）和命中的字符下标；不匹配返回 null。 */
function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  if (!query) return { score: 0, hits: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const hits: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    hits.push(found);
    score += found === prev + 1 ? 5 : 1; // 连续命中加分
    if (found === 0 || /[\s:：/_-]/.test(t[found - 1] ?? "")) score += 3; // 词首加分
    prev = found;
    ti = found + 1;
  }
  return { score: score - t.length * 0.01, hits };
}

function renderHighlighted(text: string, hits: number[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const set = new Set(hits);
  let buf = "";
  let inHit = false;
  const flush = () => {
    if (!buf) return;
    if (inHit) {
      const b = document.createElement("b");
      b.textContent = buf;
      frag.appendChild(b);
    } else {
      frag.appendChild(document.createTextNode(buf));
    }
    buf = "";
  };
  [...text].forEach((ch, i) => {
    const h = set.has(i);
    if (h !== inHit) {
      flush();
      inHit = h;
    }
    buf += ch;
  });
  flush();
  return frag;
}

interface Item {
  title: string;
  category: string;
  keys?: string;
  hits: number[];
  run(): void;
  id?: string;
}

/**
 * 命令面板（Ctrl+Shift+P）。输入 ":行号" 可以直接跳转到行。
 */
export class CommandPalette {
  private root: HTMLElement | null = null;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private items: Item[] = [];
  private active = 0;
  private restoreFocus: HTMLElement | null = null;

  constructor(
    private readonly commands: () => PaletteCommand[],
    private readonly goToLine: (line: number) => void,
  ) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(prefix = ""): void {
    if (this.root) {
      this.input.value = prefix;
      this.refresh();
      this.input.focus();
      return;
    }
    this.restoreFocus = document.activeElement as HTMLElement | null;

    const root = document.createElement("div");
    root.className = "overlay palette-overlay";
    root.innerHTML = `
      <div class="palette" role="dialog" aria-label="命令面板">
        <div class="palette-input">${icon("search", 15)}<input type="text" spellcheck="false" placeholder="输入命令名称，或输入 : 加行号跳转" /></div>
        <div class="palette-list" role="listbox"></div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.input = root.querySelector("input")!;
    this.list = root.querySelector(".palette-list")!;

    root.addEventListener("mousedown", (e) => {
      if (e.target === root) {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener("input", () => this.refresh());
    this.input.addEventListener("keydown", (e) => this.onKey(e));

    this.input.value = prefix;
    this.refresh();
    this.input.focus();
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.restoreFocus?.focus?.();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = this.items.length;
      if (n) this.setActive((this.active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.runItem(this.items[this.active]);
    }
  }

  private runItem(item: Item | undefined): void {
    if (!item) return;
    if (item.id) saveRecent([item.id, ...loadRecent().filter((id) => id !== item.id)]);
    this.close();
    // 让面板先关掉、焦点先回去，再执行命令（有些命令会打开别的浮层）
    setTimeout(() => item.run(), 0);
  }

  private setActive(i: number): void {
    this.active = i;
    this.list.querySelectorAll(".palette-item").forEach((el, j) => el.classList.toggle("active", j === i));
    this.list.children[i]?.scrollIntoView({ block: "nearest" });
  }

  private refresh(): void {
    const query = this.input.value.trim();
    const goto = /^:\s*(\d*)$/.exec(query);

    if (goto) {
      const n = Number(goto[1]);
      this.items = [
        {
          title: n ? `跳转到第 ${n} 行` : "输入行号后回车跳转",
          category: "跳转",
          hits: [],
          run: () => n && this.goToLine(n),
        },
      ];
    } else {
      const recent = loadRecent();
      this.items = this.commands()
        .map((c) => {
          const label = `${c.category}: ${c.title}`;
          const m = fuzzy(query, label) ?? (c.aliases ? fuzzy(query, c.aliases) : null);
          if (!m) return null;
          const hits = fuzzy(query, label)?.hits ?? [];
          const r = recent.indexOf(c.id);
          const score = query ? m.score : r >= 0 ? 100 - r : 0;
          return { item: { ...c, hits: hits.map((h) => h - c.category.length - 2).filter((h) => h >= 0) }, score };
        })
        .filter((x): x is { item: Item & PaletteCommand; score: number } => x !== null)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item);
    }

    this.list.innerHTML = "";
    if (!this.items.length) {
      const empty = document.createElement("div");
      empty.className = "palette-empty";
      empty.textContent = "没有匹配的命令";
      this.list.appendChild(empty);
    }
    const recent = loadRecent();
    this.items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "palette-item";
      row.setAttribute("role", "option");

      const cat = document.createElement("span");
      cat.className = "palette-cat";
      cat.textContent = item.category + ":";
      const title = document.createElement("span");
      title.className = "palette-title";
      title.appendChild(renderHighlighted(item.title, item.hits));
      row.append(cat, title);

      if (!query && item.id && recent.includes(item.id)) {
        const tag = document.createElement("span");
        tag.className = "palette-tag";
        tag.textContent = "最近使用";
        row.appendChild(tag);
      }
      if (item.keys) {
        const keys = document.createElement("span");
        keys.className = "palette-keys";
        for (const k of item.keys.split("+")) {
          const kbd = document.createElement("kbd");
          kbd.textContent = k;
          keys.appendChild(kbd);
        }
        row.appendChild(keys);
      }
      row.addEventListener("mousemove", () => this.active !== i && this.setActive(i));
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.runItem(item);
      });
      this.list.appendChild(row);
    });
    this.setActive(0);
  }
}
