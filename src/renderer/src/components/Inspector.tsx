import { useEffect, useRef, useState, type ReactNode } from 'react';
import SheetPreview from './SheetPreview';
import Icon from './Icon';
import type { PfAsset, PfObject } from '../../../shared/phaseform/types';
import {
  advancedKeys, degToRad, getAt, isHexColor, parseNumStr, pointCount, radToDeg, sectionsFor, setAt,
  type FieldDef,
} from './inspectorFields';

interface Props {
  object: PfObject;
  /** image/spritesheet/atlas keys from the project manifest. */
  textureKeys: string[];
  /** bitmapFont keys. */
  fontKeys: string[];
  /** The project's asset entries: a spritesheet gets a frame picker under its object's Frame field. */
  assets: PfAsset[];
  /** Keys of the project's animations, for a sprite's Animation picker. */
  animationKeys: string[];
  /** Depth only applies to top-level objects. */
  isTopLevel: boolean;
  /** A value of undefined removes the field. `commit` ends the undo step at once (toggles, selects). */
  onChange(patch: Record<string, unknown>, commit?: boolean): void;
  /** Editing finished (blur, Enter, mouse-up). */
  onCommit(): void;
  onDelete(): void;
}

export const inputCls = 'bg-gray-950 border border-gray-700 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-blue-500';

const fmt = (v: number) => String(Number(v.toFixed(4)));

// ---------------------------------------------------------------- primitives

/** Pixels the pointer must travel before a press on a number turns from a click (edit the text) into a scrub. */
const SCRUB_THRESHOLD = 3;

/**
 * A number field like Godot's: click to type, drag sideways to change the value by `step` per pixel (hold Shift for a tenth
 * of that). The value is committed (one undo step) when the drag ends.
 */
export function NumberInput({ value, def, min, max, step, int, width = 'flex-1 min-w-0', onValue, onCommit }: {
  value: number | undefined; def: number; min?: number; max?: number; step?: number; int?: boolean; width?: string;
  onValue(v: number): void; onCommit(): void;
}) {
  const shown = value ?? def;
  const [text, setText] = useState(fmt(shown));
  const focused = useRef(false);
  const scrub = useRef<{ x: number; start: number; active: boolean } | null>(null);
  useEffect(() => { if (!focused.current) setText(fmt(shown)); }, [shown]);
  const clamp = (v: number) => {
    let r = int ? Math.round(v) : v;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    return r;
  };
  const perPixel = step ?? (int ? 1 : 0.01);
  return (
    <input type="number" value={text} min={min} max={max} step={step ?? (int ? 1 : 0.01)}
      title="Drag sideways to change the value; click to type"
      onPointerDown={e => {
        if (focused.current || e.button !== 0) return;
        e.preventDefault(); // no focus yet: a click without a drag focuses on release
        e.currentTarget.setPointerCapture(e.pointerId);
        scrub.current = { x: e.clientX, start: shown, active: false };
      }}
      onPointerMove={e => {
        const s = scrub.current;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (!s.active && Math.abs(dx) < SCRUB_THRESHOLD) return;
        s.active = true;
        const v = clamp(Number((s.start + dx * perPixel * (e.shiftKey ? 0.1 : 1)).toFixed(4)));
        setText(fmt(v));
        onValue(v);
      }}
      onPointerUp={e => {
        const s = scrub.current;
        scrub.current = null;
        if (!s) return;
        if (s.active) onCommit();
        else { e.currentTarget.focus(); e.currentTarget.select(); }
      }}
      onFocus={() => { focused.current = true; }}
      onChange={e => {
        setText(e.target.value);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onValue(clamp(v));
      }}
      onBlur={() => { focused.current = false; setText(fmt(value ?? def)); onCommit(); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${width} text-right ${inputCls} [&:not(:focus)]:cursor-ew-resize`} />
  );
}

export function TextInput({ value, onValue, onCommit, placeholder, className = 'flex-1 min-w-0' }: {
  value: string; onValue(v: string): void; onCommit(): void; placeholder?: string; className?: string;
}) {
  return (
    <input type="text" value={value} placeholder={placeholder} spellCheck={false}
      onChange={e => onValue(e.target.value)} onBlur={onCommit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`${className} ${inputCls}`} />
  );
}

function ColorInput({ value, free, onValue, onCommit, onOneShot }: {
  value: string; free?: boolean; onValue(v: string): void; onCommit(): void; onOneShot(v: string): void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const apply = () => {
    const t = text.trim();
    if (t !== value && t && (free || isHexColor(t))) onOneShot(t); else setText(value);
  };
  return (
    <div className="flex items-center gap-1">
      <input type="color" value={isHexColor(value) ? value : '#000000'}
        onChange={e => onValue(e.target.value)} onBlur={onCommit} onMouseUp={onCommit}
        className="w-8 h-6 rounded border border-gray-600 bg-transparent cursor-pointer p-0" />
      <input type="text" value={text} spellCheck={false} onChange={e => setText(e.target.value)} onBlur={apply}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={`w-20 font-mono ${inputCls}`} />
    </div>
  );
}

/** A raw JSON editor: parses on blur, never applies invalid JSON. Empty text removes the field unless `required`. */
export function JsonBox({ value, required, rows = 4, onApply }: {
  value: unknown; required?: boolean; rows?: number; onApply(v: unknown): void;
}) {
  const pretty = value === undefined ? '' : JSON.stringify(value, null, 2);
  const [text, setText] = useState(pretty);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) { setText(pretty); setError(null); } }, [pretty]);
  const blur = () => {
    focused.current = false;
    const t = text.trim();
    if (t === '') {
      if (required) { setError('A value is required'); return; }
      setError(null);
      if (value !== undefined) onApply(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(t);
      setError(null);
      if (JSON.stringify(parsed) !== JSON.stringify(value)) onApply(parsed);
      setText(JSON.stringify(parsed, null, 2));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div>
      <textarea value={text} rows={rows} spellCheck={false}
        onFocus={() => { focused.current = true; }}
        onChange={e => setText(e.target.value)} onBlur={blur}
        className={`w-full font-mono text-[11px] resize-y ${inputCls} ${error ? '!border-red-600' : ''}`} />
      {error && <div className="text-[10px] text-red-400 mt-0.5 break-words">Invalid JSON, not applied: {error}</div>}
    </div>
  );
}

export function Row({ label, children, onReset, hint, tall }: {
  label: string; children: ReactNode; onReset?: () => void; hint?: string; tall?: boolean;
}) {
  return (
    <div className="mb-0.5">
      <div className={`flex py-0.5 gap-2 ${tall ? 'items-start' : 'items-center'}`}>
        <span className="text-xs text-gray-400 basis-2/5 flex-shrink-0 truncate" title={label}>{label}</span>
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {children}
          <button onClick={onReset} disabled={!onReset} title="Reset to the default (removes this field)"
            className={`flex-shrink-0 text-gray-500 hover:text-[var(--gd-accent)] ${onReset ? '' : 'invisible'}`}>
            <Icon name="ReloadSmall" size={14} />
          </button>
        </div>
      </div>
      {hint && <div className="text-[10px] text-gray-600 pl-[40%]">{hint}</div>}
    </div>
  );
}

/** Sections the user collapsed; kept across selections so the Inspector stays the way they left it. */
const collapsedSections = new Set<string>();

/** A titled group of rows that folds away, like Godot's inspector categories. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(!collapsedSections.has(title));
  const toggle = () => {
    if (open) collapsedSections.add(title); else collapsedSections.delete(title);
    setOpen(!open);
  };
  return (
    <section>
      <button onClick={toggle} aria-expanded={open}
        className="w-full flex items-center gap-1 px-1.5 py-1 mb-1 rounded bg-gray-800 text-xs font-medium text-gray-300 hover:text-white">
        <Icon name={open ? 'GuiTreeArrowDown' : 'GuiTreeArrowRight'} size={12} />{title}
      </button>
      {open && <div className="px-1">{children}</div>}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button title="Copy id"
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1000); }).catch(() => { /* unavailable */ }); }}
      className="px-1.5 py-0.5 rounded text-[10px] border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 flex-shrink-0">
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

// ---------------------------------------------------------------- one table field

function Field({ def, obj, textureKeys, fontKeys, assets, onChange, onCommit }: {
  def: FieldDef; obj: PfObject; textureKeys: string[]; fontKeys: string[]; assets: PfAsset[];
  onChange: Props['onChange']; onCommit: () => void;
}) {
  const raw = getAt(obj, def.path);
  const present = raw !== undefined;
  const set = (v: unknown, commit = false) => {
    const patch = setAt(obj, def.path, v);
    // Clearing the last anchor axis removes the (now empty) anchor object.
    const a = patch.anchor;
    onChange(def.path[0] === 'anchor' && a && typeof a === 'object' && Object.keys(a).length === 0 ? { anchor: undefined } : patch, commit);
  };
  const reset = !def.required && present ? () => set(undefined, true) : undefined;
  const label = def.path.length > 2 || def.when ? `  ${def.label}` : def.label;
  const row = (control: ReactNode, opts: { tall?: boolean; noReset?: boolean } = {}) => (
    <Row label={label} hint={def.hint} onReset={opts.noReset ? undefined : reset} tall={opts.tall}>{control}</Row>
  );

  switch (def.kind) {
    case 'text': {
      const v = typeof raw === 'string' ? raw : '';
      return row(<TextInput value={v} placeholder={def.path[0] === 'name' ? obj.id : undefined}
        onValue={s => set(s === '' ? undefined : s)} onCommit={onCommit} />, { noReset: true });
    }
    case 'textarea':
      return row(
        <textarea value={typeof raw === 'string' ? raw : ''} rows={3} spellCheck={false}
          onChange={e => set(e.target.value)} onBlur={onCommit}
          className={`w-full resize-y ${inputCls}`} />, { tall: true, noReset: true });
    case 'number':
    case 'int':
    case 'angle': {
      const isAngle = def.kind === 'angle';
      const base = typeof def.def === 'number' ? def.def : 0;
      const value = typeof raw === 'number' ? (isAngle ? radToDeg(raw) : raw) : undefined;
      return row(
        <NumberInput value={value} def={base} min={def.min} max={def.max} step={def.step} int={def.kind === 'int'}
          onValue={v => set(isAngle ? degToRad(v) : v)} onCommit={onCommit} />);
    }
    case 'bool': {
      const v = typeof raw === 'boolean' ? raw : Boolean(def.def);
      return row(<input type="checkbox" checked={v} onChange={e => set(e.target.checked, true)} className="accent-blue-500 w-4 h-4" />);
    }
    case 'color':
      return row(<ColorInput value={typeof raw === 'string' ? raw : String(def.def ?? '#ffffff')} free={def.freeColor}
        onValue={v => set(v)} onCommit={onCommit} onOneShot={v => set(v, true)} />);
    case 'select': {
      const cur = typeof raw === 'string' ? raw : '';
      const options = def.options ?? [];
      const list = cur && !options.includes(cur) ? [...options, cur] : options;
      return row(
        <select value={cur} onChange={e => set(e.target.value === '' ? undefined : e.target.value, true)} className={`flex-1 min-w-0 ${inputCls}`}>
          {list.map(o => <option key={o} value={o}>{o === '' ? `(default${def.def ? `: ${def.def}` : ''})` : o}</option>)}
        </select>, { noReset: true });
    }
    case 'vec2': {
      const d = def.def as { x: number; y: number };
      const cur = (getAt(obj, def.path) as { x?: unknown; y?: unknown } | undefined) ?? {};
      const num = (k: 'x' | 'y') => (typeof cur[k] === 'number' ? (cur[k] as number) : undefined);
      // Send the whole vec2, keeping any other keys, with the missing axis filled from the default.
      const edit = (k: 'x' | 'y', v: number) =>
        set({ ...(typeof raw === 'object' && raw ? raw : {}), x: num('x') ?? d.x, y: num('y') ?? d.y, [k]: v });
      return row(
        <>
          <NumberInput value={num('x')} def={d.x} min={def.min} max={def.max} step={def.step} onValue={v => edit('x', v)} onCommit={onCommit} />
          <NumberInput value={num('y')} def={d.y} min={def.min} max={def.max} step={def.step} onValue={v => edit('y', v)} onCommit={onCommit} />
        </>);
    }
    case 'numstr': {
      const shown = typeof raw === 'number' || typeof raw === 'string' ? String(raw) : '';
      const sheet = def.path[0] === 'frame' && typeof obj.key === 'string' ? assets.find(a => a.key === obj.key && a.type === 'spritesheet') : undefined;
      const input = row(<TextInput value={shown} placeholder={def.def !== undefined ? String(def.def) : 'default'}
        onValue={s => set(parseNumStr(s))} onCommit={onCommit} />);
      if (!sheet) return input;
      return (
        <>
          {input}
          <div className="mb-1"><SheetPreview asset={sheet} maxSize={220} selected={typeof raw === 'number' ? raw : undefined} onPick={i => set(i, true)} /></div>
        </>
      );
    }
    case 'texture':
    case 'font': {
      const keys = def.kind === 'texture' ? textureKeys : fontKeys;
      const cur = typeof raw === 'string' ? raw : '';
      const missing = cur !== '' && !keys.includes(cur);
      return row(
        <>
          <select value={cur} onChange={e => set(e.target.value, true)}
            className={`flex-1 min-w-0 ${inputCls} ${missing ? '!border-red-600 text-red-300' : ''}`}>
            {(cur === '' || missing) && <option value={cur}>{cur === '' ? '(none)' : `${cur} (missing)`}</option>}
            {keys.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </>, { noReset: true });
    }
    case 'presence': {
      const on = present;
      return (
        <label className="flex items-center justify-between py-1 text-xs text-gray-400 mt-1">
          <span>{def.label}</span>
          <input type="checkbox" checked={on} className="accent-blue-500 w-4 h-4"
            onChange={e => set(e.target.checked ? def.enable : undefined, true)} />
        </label>
      );
    }
    case 'json':
      return (
        <div className="mb-1">
          <div className="text-[11px] text-gray-500 mb-0.5">{def.label}</div>
          <JsonBox value={raw} onApply={v => set(v, true)} />
        </div>
      );
    case 'points':
      return (
        <div className="mb-1">
          <div className="text-[11px] text-gray-500 mb-0.5">{def.label}: {pointCount(raw)}</div>
          <JsonBox value={raw} required rows={5} onApply={v => set(v, true)} />
        </div>
      );
  }
}

// ---------------------------------------------------------------- inspector

export default function Inspector({ object, textureKeys, fontKeys, assets, animationKeys, isTopLevel, onChange, onCommit, onDelete }: Props) {
  const sections = sectionsFor(object.type, isTopLevel);
  const advanced = advancedKeys(object, isTopLevel);

  return (
    <div key={object.id} className="p-2 space-y-2 text-sm">
      <Section title="Identity">
        <div className="bg-gray-900 rounded px-3 py-2 mb-1.5 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-gray-500 mb-0.5">ID &middot; {object.type}</div>
            <div className="text-xs text-white font-mono truncate" title={object.id}>{object.id}</div>
          </div>
          <CopyButton text={object.id} />
        </div>
        {sections.find(([s]) => s === 'Identity')?.[1].map(def => (
          <Field key={def.path.join('.') + def.kind} def={def} obj={object} textureKeys={textureKeys} fontKeys={fontKeys} assets={assets}
            onChange={onChange} onCommit={onCommit} />
        ))}
      </Section>

      {sections.filter(([s]) => s !== 'Identity').map(([section, defs]) => (
        <Section key={section} title={section}>
          {defs.filter(d => !d.when || d.when(object)).map(def => (
            <Field key={def.path.join('.') + def.kind} def={def} obj={object} textureKeys={textureKeys} fontKeys={fontKeys} assets={assets}
              onChange={onChange} onCommit={onCommit} />
          ))}
        </Section>
      ))}

      {object.type === 'sprite' && (() => {
        const anim = object.animation && typeof object.animation === 'object' ? object.animation as { key?: unknown } : undefined;
        const cur = typeof anim?.key === 'string' ? anim.key : '';
        const missing = cur !== '' && !animationKeys.includes(cur);
        return (
          <Section title="Animation">
            <Row label="Plays" hint="Define animations in the Animations panel. Play options stay in the raw JSON below.">
              <select value={cur} onChange={e => onChange({ animation: e.target.value === '' ? undefined : { ...anim, key: e.target.value } }, true)}
                className={`flex-1 min-w-0 ${inputCls} ${missing ? '!border-red-600 text-red-300' : ''}`}>
                <option value="">(none)</option>
                {missing && <option value={cur}>{cur} (missing)</option>}
                {animationKeys.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </Row>
          </Section>
        );
      })()}

      {advanced.length > 0 && (
        <Section title="Advanced">
          <div className="text-[10px] text-gray-600 mb-2">Raw JSON. Applied when you leave the box; invalid JSON is rejected. Empty removes the field.</div>
          {advanced.map(k => (
            <div key={k} className="mb-2">
              <div className="text-[11px] text-gray-400 font-mono mb-0.5">{k}</div>
              <JsonBox value={object[k]} onApply={v => onChange({ [k]: v }, true)} />
            </div>
          ))}
        </Section>
      )}

      <button onClick={onDelete}
        className="w-full py-2 rounded text-xs text-red-400 border border-red-900 hover:bg-red-900/30 transition-colors">
        Delete Object
      </button>
    </div>
  );
}
