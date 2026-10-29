/** 线性图标，统一 24×24 视框、currentColor 描边。 */
const PATHS: Record<string, string> = {
  folder:
    '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 4v5h7V4"/><path d="M8 20v-6h8v6"/>',
  saveAs:
    '<path d="M13 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5"/><path d="M13 4l5 5v3"/><path d="M13 4v5h5"/><path d="M18 15v6"/><path d="M15 18h6"/>',
  pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  settings:
    '<path d="M4 7h9"/><path d="M19 7h1"/><path d="M4 17h3"/><path d="M13 17h7"/><circle cx="16" cy="7" r="2.5"/><circle cx="10" cy="17" r="2.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.2v.3"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  file:
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 12l-2 2 2 2"/><path d="M14 12l2 2-2 2"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20 16l-5-5-8 8"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12"/><path d="M6 12h12"/>',
  // 窗口按钮：仿 Windows 11 的细线图标
  winMin: '<path d="M4.5 12h15"/>',
  winMax: '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>',
  winRestore: '<rect x="4.5" y="7.5" width="12" height="12" rx="2"/><path d="M7.5 4.5h10a2 2 0 0 1 2 2v10"/>',
  winClose: '<path d="M5 5l14 14"/><path d="M19 5L5 19"/>',
  keyboard:
    '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 16): string {
  const body = PATHS[name] ?? "";
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
