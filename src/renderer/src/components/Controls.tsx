import { useState, type ReactNode } from 'react';
import { isSceneKey } from '../../../shared/phaseform/format';

interface FieldProps {
  label: string;
  value: number | string | boolean;
  type?: 'number' | 'color' | 'checkbox';
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: any) => void;
  /** Fired when an edit is finished (blur for text/color inputs, every toggle for checkboxes). */
  onCommit?: () => void;
}

export function InspectorField({ label, value, type = 'number', min, max, step = 0.01, onChange, onCommit }: FieldProps) {
  let input: ReactNode;
  if (type === 'checkbox') {
    input = (
      <input type="checkbox" checked={value as boolean}
        onChange={e => { onChange(e.target.checked); onCommit?.(); }}
        className="accent-blue-500 w-4 h-4" />
    );
  } else if (type === 'color') {
    input = (
      <input type="color" value={value as string} onChange={e => onChange(e.target.value)} onBlur={onCommit}
        className="w-10 h-7 rounded border border-gray-600 bg-transparent cursor-pointer" />
    );
  } else {
    input = (
      <input type="number" value={value as number} min={min} max={max} step={step}
        onChange={e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v); }}
        onBlur={onCommit}
        className="w-28 bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-xs text-right focus:outline-none focus:border-blue-500" />
    );
  }
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-gray-400 w-28">{label}</span>
      {input}
    </div>
  );
}

export function ToolBtn({ icon, label, active, onClick, disabled, extra = '' }: {
  icon: string; label: string; active?: boolean; onClick: () => void; disabled?: boolean; extra?: string;
}) {
  return (
    <button title={label} onClick={onClick} disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-blue-600 text-white shadow-[0_0_10px_rgba(59,130,246,0.4)]'
          : 'text-gray-300 hover:bg-gray-700 hover:text-white'
      } ${extra}`}>
      <span>{icon}</span><span className="hidden xl:inline">{label}</span>
    </button>
  );
}

export function PresetButton({ label, active, onClick, className = '' }: {
  label: string; active: boolean; onClick: () => void; className?: string;
}) {
  return (
    <button onClick={onClick}
      className={`rounded border transition-colors ${className} ${
        active ? 'border-blue-500 bg-blue-900/40 text-blue-300'
          : 'border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-300'}`}>
      {label}
    </button>
  );
}

const SIZE_PRESETS = [{ w: 1280, h: 720 }, { w: 960, h: 540 }, { w: 800, h: 600 }];

export function SetupDialog({ onConfirm, onCancel }: {
  onConfirm: (w: number, h: number) => void; onCancel: () => void;
}) {
  const [w, setW] = useState(1280);
  const [h, setH] = useState(720);
  const sizeInput = (label: string, value: number, set: (v: number) => void, fallback: number, max: number) => (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-400">{label}</span>
      <input type="number" value={value} onChange={e => set(parseInt(e.target.value) || fallback)} min={100} max={max}
        className="w-28 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-right text-white focus:outline-none focus:border-blue-500" />
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-6 w-80">
        <h2 className="text-sm font-semibold text-white mb-1">New PHASEFORM project</h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          This folder has no <span className="text-gray-300 font-mono">phaseform.project.json</span>. Choose the canvas size of the first scene; nothing is written until you save.
        </p>
        <div className="space-y-3 mb-5">
          {sizeInput('Width (px)', w, setW, 1280, 7680)}
          {sizeInput('Height (px)', h, setH, 720, 4320)}
          <div className="flex gap-2 flex-wrap pt-1">
            {SIZE_PRESETS.map(p => (
              <button key={`${p.w}x${p.h}`} onClick={() => { setW(p.w); setH(p.h); }}
                className="px-2 py-0.5 rounded text-[10px] border border-gray-600 text-gray-400 hover:border-blue-500 hover:text-blue-300 transition-colors">
                {p.w}×{p.h}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-700 transition-colors">Cancel</button>
          <button onClick={() => onConfirm(w, h)} className="px-4 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">Open Project</button>
        </div>
      </div>
    </div>
  );
}

/** Scene selector: the project's scenes (one layout file per scene key) and an inline "new scene" field. */
export function ScenePicker({ scenes, current, hasFile, onOpen, onCreate }: {
  scenes: { key: string }[]; current: string; hasFile: boolean; onOpen: (key: string) => void; onCreate: (key: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const taken = scenes.some(s => s.key.toLowerCase() === name.toLowerCase());
  const valid = isSceneKey(name) && !taken;
  const submit = () => { if (valid) { onCreate(name); setAdding(false); setName(''); } };
  const keys = scenes.some(s => s.key === current) ? scenes : [...scenes, { key: current }];
  return (
    <div className="flex items-center gap-1 mr-1">
      {adding ? (
        <input autoFocus value={name} placeholder="scene key" onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); else if (e.key === 'Escape') { setAdding(false); setName(''); } }}
          onBlur={() => { if (!name) setAdding(false); }}
          title={taken ? 'A scene with this key exists' : 'Must match the key of the game\x27s Phaser scene'}
          className={`w-28 bg-gray-900 border rounded px-2 py-1 text-xs text-white focus:outline-none ${name && !valid ? 'border-red-600' : 'border-gray-700 focus:border-blue-500'}`} />
      ) : (
        <select value={current} onChange={e => onOpen(e.target.value)} title="Scene"
          className="max-w-40 px-2 py-1.5 rounded text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:border-gray-600 focus:border-blue-500 outline-none">
          {keys.map(s => <option key={s.key} value={s.key}>{s.key}</option>)}
        </select>
      )}
      <button onClick={() => setAdding(true)} title="New scene"
        className="px-2 py-1.5 rounded text-xs text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700">+</button>
    </div>
  );
}
