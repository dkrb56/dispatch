// The wires between the nodes of the Map and of the worker view: one SVG behind the nodes of a
// host, drawn from the places of the nodes after the layout, and again when the host changes size.

const SVG = "http://www.w3.org/2000/svg";

export interface Link {
  from: HTMLElement;
  to: HTMLElement;
  /** A class of the wire: `work` (green), `wait` (orange), `done`, `active` (blue), `later` (dashed). */
  kind?: string;
  /** A short word on the wire: what passes along it. */
  label?: string;
}

const drawn = new WeakMap<HTMLElement, Link[]>();
const observed = new WeakSet<HTMLElement>();

/** Draws the wires of a host. The host has `position: relative`; the nodes are inside it. */
export function drawLinks(host: HTMLElement, links: Link[]): void {
  drawn.set(host, links);
  if (!observed.has(host)) {
    observed.add(host);
    new ResizeObserver(() => paint(host)).observe(host);
  }
  paint(host);
}

function paint(host: HTMLElement): void {
  host.querySelector(":scope > svg.links")?.remove();
  const links = (drawn.get(host) ?? []).filter((link) => link.from.isConnected && link.to.isConnected);
  const box = host.getBoundingClientRect();
  if (box.width === 0 || links.length === 0) return;
  const svg = document.createElementNS(SVG, "svg");
  svg.classList.add("links");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(host.scrollWidth));
  svg.setAttribute("height", String(host.scrollHeight));
  const at = (rect: DOMRect, side: "left" | "right") => ({
    x: (side === "right" ? rect.right : rect.left) - box.left + host.scrollLeft,
    y: rect.top + rect.height / 2 - box.top + host.scrollTop,
  });
  for (const link of links) {
    const a = at(link.from.getBoundingClientRect(), "right");
    const b = at(link.to.getBoundingClientRect(), "left");
    // A soft S from the right edge of one node to the left edge of the next; the head ends 2px short.
    const end = b.x - 2;
    const middle = (a.x + end) / 2;
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", `M ${a.x} ${a.y} C ${middle} ${a.y}, ${middle} ${b.y}, ${end - 5} ${b.y}`);
    path.setAttribute("class", `link ${link.kind ?? ""}`);
    const head = document.createElementNS(SVG, "path");
    head.setAttribute("d", `M ${end - 6} ${b.y - 4} L ${end} ${b.y} L ${end - 6} ${b.y + 4} Z`);
    head.setAttribute("class", `link-head ${link.kind ?? ""}`);
    svg.append(path, head);
    if (link.label) {
      const text = document.createElementNS(SVG, "text");
      text.textContent = link.label;
      text.setAttribute("x", String(middle));
      text.setAttribute("y", String((a.y + b.y) / 2 - 7));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", `link-label ${link.kind ?? ""}`);
      svg.append(text);
    }
  }
  host.prepend(svg);
}
