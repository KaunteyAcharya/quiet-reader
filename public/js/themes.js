export const PRESETS = [
  { id: 'paper', name: 'Paper', bg: '#faf8f3', fg: '#211f1c', accent: '#b4442a' },
  { id: 'sepia', name: 'Sepia', bg: '#f3e8d3', fg: '#3b2f22', accent: '#9a5b1e' },
  { id: 'snow', name: 'Snow', bg: '#ffffff', fg: '#111111', accent: '#2563eb' },
  { id: 'rose', name: 'Rosé', bg: '#fff1f2', fg: '#3a1d25', accent: '#e11d48' },
  { id: 'sage', name: 'Sage', bg: '#eef2e6', fg: '#25301f', accent: '#4d7c0f' },
  { id: 'lavender', name: 'Lavender', bg: '#f1eefb', fg: '#2a2340', accent: '#7c3aed' },
  { id: 'dusk', name: 'Dusk', bg: '#1b1a24', fg: '#e8e6f2', accent: '#c4a7ff' },
  { id: 'midnight', name: 'Midnight', bg: '#0f1115', fg: '#e6e6e6', accent: '#7aa2f7' },
  { id: 'forest', name: 'Forest', bg: '#0e1a14', fg: '#dcebdf', accent: '#6fcf97' },
  { id: 'ember', name: 'Ember', bg: '#1a1110', fg: '#f1e3dc', accent: '#ff8a5b' },
  { id: 'terminal', name: 'Terminal', bg: '#070b07', fg: '#a6e3a1', accent: '#f9e2af' },
  { id: 'oled', name: 'OLED', bg: '#000000', fg: '#d8d8d8', accent: '#ffffff' },
];

// kind = CSS fallback family. gf = loaded on demand from Google Fonts. Others use system fonts.
export const FONTS = {
  serif: { name: 'Newsreader', kind: 'serif', gf: true },
  literata: { name: 'Literata', kind: 'serif', gf: true },
  lora: { name: 'Lora', kind: 'serif', gf: true },
  source: { name: 'Source Serif 4', kind: 'serif', gf: true },
  garamond: { name: 'EB Garamond', kind: 'serif', gf: true },
  crimson: { name: 'Crimson Pro', kind: 'serif', gf: true },
  merri: { name: 'Merriweather', kind: 'serif', gf: true },
  playfair: { name: 'Playfair Display', kind: 'serif', gf: true },
  soft: { name: 'Fraunces', kind: 'serif', gf: true },
  georgia: { name: 'Georgia', kind: 'serif' },
  sans: { name: 'Inter', kind: 'sans-serif', gf: true },
  dm: { name: 'DM Sans', kind: 'sans-serif', gf: true },
  lexend: { name: 'Lexend', kind: 'sans-serif', gf: true },
  atkinson: { name: 'Atkinson Hyperlegible', kind: 'sans-serif', gf: true },
  grotesk: { name: 'Space Grotesk', kind: 'sans-serif', gf: true },
  system: { name: 'System UI', kind: 'sans-serif', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  mono: { name: 'JetBrains Mono', kind: 'monospace', gf: true },
  plex: { name: 'IBM Plex Mono', kind: 'monospace', gf: true },
};

const loaded = new Set();
export function loadFont(name) {
  if (!name || loaded.has(name)) return;
  loaded.add(name);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;700&display=swap`;
  document.head.append(l);
}
export function loadAllFonts() {
  for (const f of Object.values(FONTS)) if (f.gf) loadFont(f.name);
}

const clean = (n) => String(n || '').replace(/[^A-Za-z0-9 \-]/g, '').trim().slice(0, 60);

export function fontStack(id, t) {
  if (id === 'custom') {
    const n = clean(t.customFont);
    return n ? `'${n}', Georgia, serif` : FONTS.serif.stack || `'Newsreader', Georgia, serif`;
  }
  const f = FONTS[id] || FONTS.serif;
  return f.stack || `'${f.name}', ${f.kind === 'serif' ? 'Georgia, serif' : f.kind === 'monospace' ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}`;
}

function ensureLoaded(id, t) {
  if (id === 'custom') loadFont(clean(t.customFont));
  else if (FONTS[id]?.gf) loadFont(FONTS[id].name);
}

export const DEFAULT_THEME = {
  preset: 'paper',
  custom: { bg: '#faf8f3', fg: '#211f1c', accent: '#b4442a' },
  font: 'serif',
  headFont: 'auto', // 'auto' (Fraunces) | 'same' | font id | 'custom'
  customFont: '',
  uiScale: 1,
  size: 19,
  width: 680,
  lh: 1.7,
};

export function resolveColors(t) {
  if (t.preset === 'custom') return t.custom;
  return PRESETS.find((p) => p.id === t.preset) || PRESETS[0];
}

function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applyTheme(t) {
  const c = resolveColors(t);
  const root = document.documentElement;
  const s = root.style;
  s.setProperty('--bg', c.bg);
  s.setProperty('--fg', c.fg);
  s.setProperty('--accent', c.accent);
  ensureLoaded(t.font, t);
  const body = fontStack(t.font, t);
  s.setProperty('--font-body', body);
  const head = t.headFont === 'same' ? body : t.headFont === 'auto' || !t.headFont ? "'Fraunces', Georgia, serif" : fontStack(t.headFont, t);
  if (t.headFont && !['auto', 'same'].includes(t.headFont)) ensureLoaded(t.headFont, t);
  s.setProperty('--display', head);
  s.setProperty('--ui-scale', String(t.uiScale || 1));
  s.setProperty('--read-size', t.size + 'px');
  s.setProperty('--read-width', t.width + 'px');
  s.setProperty('--read-lh', String(t.lh));
  root.style.colorScheme = luminance(c.bg) < 0.4 ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.bg);
  document.dispatchEvent(new Event('quiet-theme'));
}
