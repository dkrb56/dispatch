// The tabs of the Setup pipeline and Options windows (ticket change-options-and-setup-windows): a row of
// buttons `[role="tab"][data-tab]` and one panel `[data-tab-panel]` per button; one panel shows at a time.
// Nothing here touches the document at import time, so the node tests can import pickTab.

/** The tab to show: the wanted name when the list has it, else the first name. */
export function pickTab(names: string[], wanted?: string | null): string {
  return wanted && names.includes(wanted) ? wanted : (names[0] ?? "");
}

/** Wires the tab buttons of a dialog. `show` shows one panel (the first without a name); `current` names it. */
export function initDialogTabs(root: HTMLElement): { show(name?: string): void; current(): string } {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"][data-tab]')];
  const panels = [...root.querySelectorAll<HTMLElement>("[data-tab-panel]")];
  const names = buttons.map((button) => button.dataset.tab ?? "");
  let shown = names[0] ?? "";
  const show = (name?: string): void => {
    shown = pickTab(names, name);
    for (const panel of panels) panel.hidden = panel.dataset.tabPanel !== shown;
    for (const button of buttons) {
      const active = button.dataset.tab === shown;
      button.setAttribute("aria-selected", String(active));
      button.classList.toggle("active", active);
    }
  };
  for (const button of buttons) button.addEventListener("click", () => show(button.dataset.tab));
  show();
  return { show, current: () => shown };
}
