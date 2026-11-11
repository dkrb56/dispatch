// The colour themes of the window and the terminals (theme-switcher). A theme is a full set of the
// colour tokens of src/styles.css; a switch writes them on :root and changes no rule. The Slate set
// equals the first :root block of the stylesheet (tests/theme.test.ts keeps both equal). The Graphite
// values come from the Claude Design canvas "Commander redesign", board "Graphite look".

/** The tokens of one theme: token name (with `--`) to CSS colour. */
export type ThemeTokens = Record<string, string>;

/** The themes of the list in the Options screen, in its order. The first one is the default. */
export const THEMES: { name: string; label: string }[] = [
  { name: "slate", label: "Slate" },
  { name: "graphite-blue", label: "Graphite blue" },
  { name: "graphite-indigo", label: "Graphite indigo" },
  { name: "graphite-teal", label: "Graphite teal" },
  { name: "graphite-amber", label: "Graphite amber" },
];

/** The look before the theme switcher: the values of the :root block of src/styles.css. */
const SLATE: ThemeTokens = {
  "--bg": "#13161a",
  "--surface": "#171b20",
  "--card": "#1c2127",
  "--hairline": "#22282f",
  "--line": "#2b323a",
  "--group-line": "#5d6570",
  "--text": "#dfe3e8",
  "--text-2": "#a8b0ba",
  "--muted": "#7c8591",
  "--faint": "#5d6570",
  "--accent": "#8fb3d9",
  "--accent-bg": "#1f2b38",
  "--accent-line": "#34495f",
  "--on-accent": "#13161a",
  "--work": "#8cc0a0",
  "--work-bg": "#1d2a23",
  "--wait": "#d8b06a",
  "--wait-bg": "#33291a",
  "--wait-line": "#5c4a2c",
  "--wait-glow": "rgba(216, 176, 106, 0.14)",
  "--work-line": "#3d5a48",
  "--work-glow": "rgba(140, 192, 160, 0.18)",
  "--danger": "#d99a9a",
  "--danger-bg": "#352225",
  "--switch-on": "#3fae6a",
  "--code-cmd": "#8fb3d9",
  "--code-arg": "#a6cfa0",
  "--code-flag": "#9fc7d1",
  "--code-str": "#d8b06a",
  "--code-var": "#c3a6e0",
  "--code-op": "#7c8591",
  "--term-bg": "#13161a",
  "--term-fg": "#c9d0d8",
  "--term-cursor": "#dfe3e8",
  "--term-selection": "#2a3a4c",
  "--rose": "#d6a3c0",
};

/** The Graphite values that the four accents share. */
const GRAPHITE: ThemeTokens = {
  "--bg": "#0E1116",
  "--surface": "#151A21",
  "--card": "#1C222B",
  "--hairline": "#2A323D",
  "--line": "#3A4553",
  // The middle between the raised edge and the faint text of the canvas: 3.5:1 on --bg.
  "--group-line": "#616B7A",
  "--text": "#E6EAF0",
  "--text-2": "#A3ADBA",
  "--muted": "#8892A0",
  "--faint": "#616B7A",
  "--on-accent": "#06121F",
  "--work": "#5FD49B",
  "--work-bg": "#12301F",
  "--wait": "#F0B34A",
  "--wait-bg": "#3A2C10",
  // 45 % of the state colour over --bg.
  "--wait-line": "#745A2D",
  "--wait-glow": "rgba(240, 179, 74, 0.14)",
  "--work-line": "#326952",
  "--work-glow": "rgba(95, 212, 155, 0.18)",
  "--danger": "#F28C8E",
  "--danger-bg": "#3A1D1F",
  "--switch-on": "#5FD49B",
  "--code-arg": "#5FD49B",
  "--code-flag": "#8CC0FA",
  "--code-str": "#F0B34A",
  // The canvas has no purple and no rose: the Slate values stay.
  "--code-var": "#c3a6e0",
  "--code-op": "#8892A0",
  "--term-bg": "#0E1116",
  "--term-fg": "#C9D1DA",
  "--term-cursor": "#E6EAF0",
  "--rose": "#d6a3c0",
};

/**
 * The accent of each Graphite theme: the accent, its soft background (also the terminal selection;
 * the canvas value for blue, else 25 % of the accent over --bg) and its line (45 % over --bg).
 * xterm takes only hex and rgb values, so these mixes are fixed values, not color-mix().
 */
const ACCENTS: Record<string, [accent: string, soft: string, line: string]> = {
  "graphite-blue": ["#5BA4F5", "#16304D", "#31537A"],
  "graphite-indigo": ["#7C8CF8", "#2A304F", "#40487C"],
  "graphite-teal": ["#3CC6B4", "#1A3E3E", "#23625D"],
  "graphite-amber": ["#F0B34A", "#473A23", "#745A2D"],
};

/** The name of a known theme; an unknown or empty name gives the default, Slate. */
export function themeName(name: string | null | undefined): string {
  return THEMES.some((theme) => theme.name === name) ? (name as string) : THEMES[0].name;
}

/** The full token set of a theme. An unknown name gives Slate. */
export function themeTokens(name: string | null | undefined): ThemeTokens {
  const accent = ACCENTS[themeName(name)];
  if (!accent) return { ...SLATE };
  const [color, soft, line] = accent;
  return {
    ...GRAPHITE,
    "--accent": color,
    "--accent-bg": soft,
    "--accent-line": line,
    "--code-cmd": color,
    "--term-selection": soft,
  };
}

/** The colours of a terminal (the `theme` option of xterm.js) in a theme. */
export function terminalTheme(name: string | null | undefined): {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
} {
  const tokens = themeTokens(name);
  return {
    background: tokens["--term-bg"],
    foreground: tokens["--term-fg"],
    cursor: tokens["--term-cursor"],
    selectionBackground: tokens["--term-selection"],
  };
}
