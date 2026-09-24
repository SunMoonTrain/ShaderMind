import { acceptCompletion, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  historyKeymap,
  indentLess,
  indentMore,
  selectLine,
  toggleComment,
} from "@codemirror/commands";
import { foldKeymap, getIndentUnit, indentString } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import {
  gotoLine,
  openSearchPanel,
  searchKeymap,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { EditorSelection, countColumn } from "@codemirror/state";
import { type Command, type EditorView, type KeyBinding } from "@codemirror/view";

/** 在最上 / 最下的光标的上一行 / 下一行再加一个光标（VS Code 的 Ctrl+Alt+↑/↓）。 */
function addCursorVertically(forward: boolean): Command {
  return (view: EditorView) => {
    const { ranges } = view.state.selection;
    const edge = ranges.reduce((a, b) => ((forward ? b.head > a.head : b.head < a.head) ? b : a));
    const moved = view.moveVertically(EditorSelection.cursor(edge.head, 0, undefined, edge.goalColumn), forward);
    if (moved.head === edge.head) return false;
    const next = EditorSelection.cursor(moved.head, 0, undefined, moved.goalColumn);
    view.dispatch({
      selection: EditorSelection.create([...ranges, next], ranges.length),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

export const addCursorAbove = addCursorVertically(false);
export const addCursorBelow = addCursorVertically(true);

/** Tab：有选区时整体缩进；否则补齐到下一个缩进位（按设置用空格）。 */
const insertIndent: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore(view);
  const unit = getIndentUnit(state);
  view.dispatch(
    state.changeByRange((range) => {
      const line = state.doc.lineAt(range.head);
      const col = countColumn(line.text.slice(0, range.head - line.from), state.tabSize);
      const insert = indentString(state, unit - (col % unit));
      return { changes: { from: range.head, insert }, range: EditorSelection.cursor(range.head + insert.length) };
    }),
    { scrollIntoView: true, userEvent: "input.indent" },
  );
  return true;
};

/**
 * 按 VS Code 的习惯排布。排在前面的优先生效，所以覆盖默认行为的绑定要放在最前。
 */
export function vscodeKeymap(): readonly KeyBinding[] {
  return [
    // 补全：Tab / Enter 都能接受
    { key: "Tab", run: acceptCompletion },
    ...completionKeymap,

    // 多光标
    { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
    { key: "Mod-Shift-l", run: selectSelectionMatches, preventDefault: true },
    { key: "Mod-Alt-ArrowUp", run: addCursorAbove, preventDefault: true },
    { key: "Mod-Alt-ArrowDown", run: addCursorBelow, preventDefault: true },

    // 行操作（移动行、删除行等在 defaultKeymap 里：Alt+↑↓、Ctrl+Shift+K）
    { key: "Mod-l", run: selectLine, preventDefault: true },
    { key: "Mod-/", run: toggleComment, preventDefault: true },
    { key: "Mod-]", run: indentMore, preventDefault: true },
    { key: "Mod-[", run: indentLess, preventDefault: true },

    // 查找 / 跳转
    { key: "Mod-g", run: gotoLine, preventDefault: true },
    { key: "Mod-h", run: openSearchPanel, preventDefault: true },

    ...closeBracketsKeymap,
    ...searchKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...lintKeymap,
    { key: "Tab", run: insertIndent, shift: indentLess },
  ];
}
