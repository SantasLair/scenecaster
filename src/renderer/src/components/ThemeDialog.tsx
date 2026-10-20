import { useState } from 'react';
import { CONTRAST_RANGE, PRESETS, applyTheme, deriveTheme, fromHex, presetName, toHex, type ThemeInput } from '../theme/godotTheme';
import { loadTheme, saveTheme } from '../theme/themeSettings';

/** Theme settings: a preset, or a base colour, accent colour and contrast. Applies live and is remembered. */
export default function ThemeDialog({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeInput>(loadTheme);

  const change = (t: ThemeInput) => { setTheme(t); applyTheme(deriveTheme(t)); saveTheme(t); };
  const name = presetName(theme);

  const colour = (label: string, value: string, set: (hex: string) => void) => (
    <label className="flex items-center justify-between text-xs text-gray-400">
      {label}
      <input type="color" value={value} onChange={e => set(e.target.value)} className="w-16 h-6" />
    </label>
  );

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-white mb-4">Theme</h2>
        <div className="space-y-3 mb-5">
          <label className="flex items-center justify-between text-xs text-gray-400">
            Preset
            <select value={name ?? ''} onChange={e => PRESETS[e.target.value] && change(PRESETS[e.target.value])}
              className="w-32 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white">
              {!name && <option value="">Custom</option>}
              {Object.keys(PRESETS).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {colour('Base colour', toHex(theme.base), hex => { const c = fromHex(hex); if (c) change({ ...theme, base: c }); })}
          {colour('Accent colour', toHex(theme.accent), hex => { const c = fromHex(hex); if (c) change({ ...theme, accent: c }); })}
          <label className="flex items-center justify-between text-xs text-gray-400">
            Contrast
            <input type="range" min={CONTRAST_RANGE.min} max={CONTRAST_RANGE.max} step={0.01} value={theme.contrast}
              onChange={e => change({ ...theme, contrast: Number(e.target.value) })} className="w-32" />
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">Done</button>
        </div>
      </div>
    </div>
  );
}
