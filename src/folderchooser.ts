// The folder chooser of the mode "Use a host" (ticket remote-folder-chooser). The native folder
// dialog shows the folders of the window's computer; this chooser inside the page shows the
// folders of the host through its command `dir_list`. The mode "This PC does the work" keeps the
// native dialog. The module has no imports, so the tests can load it: the caller gives it the
// function that calls `dir_list`, and it reads its elements of index.html only when it opens. With
// several hosts (ticket remote-multi-host) a list box at its top picks the host of the folder.

/** The reply of `dir_list` (src-tauri/src/core/info.rs): a folder, its parent, its sub folders and the roots. */
export interface DirList {
  path: string;
  /** `null` at a root. */
  parent: string | null;
  /** The sub folders without a leading `.`, sorted without case. */
  folders: string[];
  /** The drive roots on Windows (`C:\`), `/` elsewhere. */
  roots: string[];
}

/** Lists a folder of a host; without a path, the home folder of the host. */
export type ListFolder = (host: string, path: string | null) => Promise<unknown>;

/** A host that the chooser can show. */
export interface ChooserHost {
  id: string;
  name: string;
}

/** The folder that the user chose, and its host. */
export interface ChosenFolder {
  host: string;
  folder: string;
}

/** The path of the sub folder `name` of `parent`, with the separator of `parent`. */
export function joinPath(parent: string, name: string): string {
  const separator = parent.includes("\\") || /^[A-Za-z]:/.test(parent) ? "\\" : "/";
  return parent.endsWith(separator) ? parent + name : parent + separator + name;
}

/** Whether a value has the shape of a `dir_list` reply. */
export function isDirList(value: unknown): value is DirList {
  if (!value || typeof value !== "object") return false;
  const reply = value as Record<string, unknown>;
  const strings = (list: unknown) => Array.isArray(list) && list.every((item) => typeof item === "string");
  return typeof reply.path === "string" && (reply.parent === null || typeof reply.parent === "string") && strings(reply.folders) && strings(reply.roots);
}

interface Elements {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  host: HTMLSelectElement;
  path: HTMLInputElement;
  form: HTMLFormElement;
  up: HTMLButtonElement;
  roots: HTMLElement;
  error: HTMLElement;
  list: HTMLElement;
  choose: HTMLButtonElement;
}

let elements: Elements | null = null;
/** The function of the chooser that is open, its host, and the folder that it shows. */
let open: { list: ListFolder; host: string; shown: DirList | null; done: (folder: ChosenFolder | null) => void } | null = null;
/** The number of the last navigation: an older reply that comes late is dropped. */
let navigation = 0;

function el<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`#${id}`)!;
}

/** Reads the elements and connects the buttons, once. */
function init(): Elements {
  if (elements) return elements;
  const found: Elements = {
    dialog: el("folder-chooser"),
    title: el("folder-chooser-title"),
    host: el("folder-chooser-host"),
    path: el("folder-chooser-path"),
    form: el("folder-chooser-go-form"),
    up: el("folder-chooser-up"),
    roots: el("folder-chooser-roots"),
    error: el("folder-chooser-error"),
    list: el("folder-chooser-list"),
    choose: el("folder-chooser-choose"),
  };
  found.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = found.path.value.trim();
    if (typed) void show(typed);
  });
  // Another host: its home folder shows.
  found.host.addEventListener("change", () => {
    if (!open) return;
    open.host = found.host.value;
    open.shown = null;
    found.choose.disabled = true;
    void show(null);
  });
  found.up.addEventListener("click", () => {
    const parent = open?.shown?.parent;
    if (parent) void show(parent);
  });
  found.choose.addEventListener("click", () => finish(open?.shown ? { host: open.host, folder: open.shown.path } : null));
  el("folder-chooser-cancel").addEventListener("click", () => finish(null));
  el("folder-chooser-close").addEventListener("click", () => finish(null));
  // A click on the dark area around the dialog closes it.
  found.dialog.addEventListener("click", (event) => {
    if (event.target === found.dialog) finish(null);
  });
  // Esc closes the dialog without a folder. The event comes after the close; a dialog that is
  // open again by then belongs to a new chooser.
  found.dialog.addEventListener("close", () => {
    if (!found.dialog.open) finish(null);
  });
  elements = found;
  return found;
}

/** Ends the open chooser with a folder or with null. */
function finish(folder: ChosenFolder | null): void {
  const ending = open;
  if (!ending) return;
  open = null;
  navigation++;
  if (elements?.dialog.open) elements.dialog.close();
  ending.done(folder);
}

/** Lists a folder and shows it; an error leaves the last good folder in view and shows the host's text. */
async function show(path: string | null): Promise<void> {
  const current = open;
  const parts = elements;
  if (!current || !parts) return;
  const number = ++navigation;
  let reply: unknown;
  try {
    reply = await current.list(current.host, path);
  } catch (error) {
    if (number !== navigation || open !== current) return;
    parts.error.textContent = String(error);
    parts.error.hidden = false;
    // The text box shows the folder that is in view again.
    parts.path.value = current.shown?.path ?? "";
    return;
  }
  if (number !== navigation || open !== current) return;
  if (!isDirList(reply)) {
    parts.error.textContent = "The host gave no folder list.";
    parts.error.hidden = false;
    return;
  }
  current.shown = reply;
  render(parts, reply);
}

function render(parts: Elements, folder: DirList): void {
  parts.error.hidden = true;
  parts.error.textContent = "";
  parts.path.value = folder.path;
  parts.up.disabled = folder.parent === null;
  parts.choose.disabled = false;
  parts.roots.replaceChildren(
    ...folder.roots.map((root) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = root;
      button.title = `Show ${root}`;
      button.addEventListener("click", () => void show(root));
      return button;
    }),
  );
  if (folder.folders.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No sub folders.";
    parts.list.replaceChildren(empty);
  } else {
    parts.list.replaceChildren(
      ...folder.folders.map((name) => {
        const item = document.createElement("li");
        item.textContent = name;
        item.title = `Open ${name}`;
        item.addEventListener("click", () => void show(joinPath(folder.path, name)));
        return item;
      }),
    );
  }
  parts.list.scrollTop = 0;
}

/**
 * Shows the chooser with `title` on the first of `hosts`, at `start` or at the home folder of that
 * host. The list box of the hosts shows only with more than one host. Gives the folder that the
 * path line shows at Choose with its host, or null at Cancel, Esc, the close button or the
 * backdrop. When `start` cannot be listed, the chooser starts at the home folder of the host.
 */
export function chooseFolder(title: string, start: string | null | undefined, hosts: readonly ChooserHost[], list: ListFolder): Promise<ChosenFolder | null> {
  const parts = init();
  finish(null);
  return new Promise((resolve) => {
    open = { list, host: hosts[0]?.id ?? "", shown: null, done: resolve };
    parts.title.textContent = title;
    parts.host.replaceChildren(
      ...hosts.map((host) => {
        const option = document.createElement("option");
        option.value = host.id;
        option.textContent = host.name;
        return option;
      }),
    );
    parts.host.value = open.host;
    parts.host.hidden = hosts.length < 2;
    parts.path.value = start ?? "";
    parts.error.hidden = true;
    parts.error.textContent = "";
    parts.up.disabled = true;
    parts.choose.disabled = true;
    parts.roots.replaceChildren();
    parts.list.replaceChildren();
    parts.dialog.showModal();
    const current = open;
    void (async () => {
      if (start) {
        await show(start);
        if (open !== current || current.shown) return;
      }
      await show(null);
    })();
  });
}
