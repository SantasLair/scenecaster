import { CONTRAST_RANGE, DEFAULT_PRESET, PRESETS, fromHex, toHex, type ThemeInput } from './godotTheme';

// The theme is a per-viewer preference, so it lives in localStorage, not in the project.
const KEY = 'scenecaster.theme.v1';

/** The saved theme, or the Default preset if nothing valid is saved or storage is unavailable. */
export function loadTheme(): ThemeInput {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { base?: string; accent?: string; contrast?: number } | null;
    const base = raw?.base ? fromHex(raw.base) : null, accent = raw?.accent ? fromHex(raw.accent) : null;
    if (base && accent && typeof raw?.contrast === 'number' && raw.contrast >= CONTRAST_RANGE.min && raw.contrast <= CONTRAST_RANGE.max) {
      return { base, accent, contrast: raw.contrast };
    }
  } catch { /* storage unavailable or bad JSON */ }
  return PRESETS[DEFAULT_PRESET];
}

export function saveTheme(t: ThemeInput) {
  try { localStorage.setItem(KEY, JSON.stringify({ base: toHex(t.base), accent: toHex(t.accent), contrast: t.contrast })); } catch { /* ignore */ }
}
