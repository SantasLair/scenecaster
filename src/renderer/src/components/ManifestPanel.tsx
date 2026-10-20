import { useEffect, useRef, useState } from 'react';
import type { PfAsset, PfProject } from '../../../shared/phaseform/types';
import SheetPreview from './SheetPreview';
import { JsonBox, NumberInput, Row, inputCls } from './Inspector';

interface Props {
  project: PfProject | null;
  /** A value of undefined removes the field. `commit` ends the undo step at once. */
  onUpdate(key: string, patch: Record<string, unknown>, commit?: boolean): void;
  onCommit(): void;
  /** False if the new key is empty or taken. */
  onRename(oldKey: string, newKey: string): boolean;
  onRemove(key: string): void;
  /** Everywhere the key is used, across all scene files. */
  onFindUses(key: string): Promise<string[]>;
}

interface FieldDef { name: string; label: string; kind: 'path' | 'int'; min?: number; def?: number; required?: boolean; hint?: string }

const url: FieldDef = { name: 'url', label: 'Image file', kind: 'path', required: true };
const int = (name: string, label: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label, kind: 'int', min: 0, def: 0, ...extra });

// The fields the schema defines per asset type; anything else on an entry is kept untouched.
const FIELDS: Record<string, FieldDef[]> = {
  image: [url],
  spritesheet: [
    url,
    int('frameWidth', 'Frame width', { min: 1, def: 32, required: true }),
    int('frameHeight', 'Frame height', { min: 1, def: 32, required: true }),
    int('margin', 'Margin'), int('spacing', 'Spacing'), int('startFrame', 'Start frame'), int('endFrame', 'End frame'),
    int('frames', 'Frame count', { min: 1, hint: 'Optional: lets tools check frame numbers.' }),
  ],
  atlas: [url, { name: 'atlasUrl', label: 'Atlas data file', kind: 'path', required: true }],
  bitmapFont: [url, { name: 'dataUrl', label: 'Font data file', kind: 'path', required: true }],
};

/** Switching between these keeps the file and only adds or drops the frame size. */
const SWITCHABLE = ['image', 'spritesheet'];

function PathField({ value, required, onApply }: { value: string; required?: boolean; onApply(v: string | undefined): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const apply = () => {
    const t = text.trim().replace(/\\/g, '/');
    if (t === value) { setText(value); return; }
    if (!t && required) { setText(value); return; }
    onApply(t || undefined);
  };
  return (
    <input type="text" value={text} spellCheck={false} onChange={e => setText(e.target.value)} onBlur={apply}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={`flex-1 min-w-0 font-mono ${inputCls}`} />
  );
}

export function KeyField({ keyName, onRename, hint = 'Renaming also updates the open scene, animations and preload lists; other scene files are updated when you save.', what = 'asset' }: {
  keyName: string; onRename(k: string): boolean; hint?: string; what?: string;
}) {
  const [text, setText] = useState(keyName);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(keyName); setError(null); }, [keyName]);
  const apply = () => {
    const t = text.trim();
    if (t === keyName) { setText(keyName); setError(null); return; }
    if (onRename(t)) setError(null);
    else { setError(t ? `"${t}" is already used by another ${what}.` : 'The key cannot be empty.'); setText(keyName); }
  };
  return (
    <div>
      <Row label="Key" hint={hint}>
        <input type="text" value={text} spellCheck={false} onChange={e => { setText(e.target.value); setError(null); }} onBlur={apply}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className={`flex-1 min-w-0 ${inputCls} ${error ? '!border-red-600' : ''}`} />
      </Row>
      {error && <div className="text-[10px] text-red-400 -mt-0.5 mb-1">{error}</div>}
    </div>
  );
}

function AssetEditor({ asset, onUpdate, onCommit, onRename, onRemove, onFindUses }: Omit<Props, 'project'> & { asset: PfAsset }) {
  const fields = FIELDS[asset.type];
  const patch = (p: Record<string, unknown>, commit = false) => onUpdate(asset.key, p, commit);

  const setType = (type: string) => {
    if (type === 'spritesheet') patch({ type, frameWidth: asset.frameWidth ?? 32, frameHeight: asset.frameHeight ?? 32 }, true);
    else patch({ type, frameWidth: undefined, frameHeight: undefined, margin: undefined, spacing: undefined, startFrame: undefined, endFrame: undefined, frames: undefined }, true);
  };

  const remove = async () => {
    const uses = await onFindUses(asset.key);
    const detail = uses.length ? `\n\nStill used by:\n- ${uses.slice(0, 8).join('\n- ')}${uses.length > 8 ? `\n- and ${uses.length - 8} more` : ''}\n\nThey will show a missing-asset warning.` : '';
    if (window.confirm(`Remove "${asset.key}" from the project's asset list?\nThe file itself is not deleted.${detail}`)) onRemove(asset.key);
  };

  return (
    <div className="p-2">
      <KeyField keyName={asset.key} onRename={k => onRename(asset.key, k)} />
      <Row label="Type">
        {SWITCHABLE.includes(asset.type) ? (
          <select value={asset.type} onChange={e => setType(e.target.value)} className={`flex-1 min-w-0 ${inputCls}`}>
            {SWITCHABLE.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : <span className="text-xs text-gray-300">{asset.type}</span>}
      </Row>

      {fields?.map(f => f.kind === 'path' ? (
        <Row key={f.name} label={f.label}>
          <PathField value={typeof asset[f.name] === 'string' ? asset[f.name] as string : ''} required={f.required}
            onApply={v => patch({ [f.name]: v }, true)} />
        </Row>
      ) : (
        <Row key={f.name} label={f.label} hint={f.hint} onReset={!f.required && asset[f.name] !== undefined ? () => patch({ [f.name]: undefined }, true) : undefined}>
          <NumberInput value={typeof asset[f.name] === 'number' ? asset[f.name] as number : undefined} def={f.def ?? 0} min={f.min} int
            onValue={v => patch({ [f.name]: v })} onCommit={onCommit} />
        </Row>
      ))}

      {typeof asset.url === 'string' && asset.url !== '' && (
        <div className="my-2"><SheetPreview key={asset.key} asset={asset} /></div>
      )}

      {asset.type === 'audio' && (
        <Row label="Files (urls)" tall>
          <div className="flex-1 min-w-0"><JsonBox value={asset.urls} required rows={3} onApply={v => patch({ urls: v }, true)} /></div>
        </Row>
      )}

      {!fields && asset.type !== 'audio' && (
        <div className="mt-1">
          <div className="text-[10px] text-gray-600 mb-1">Unknown asset type: edit the entry as JSON. The key and type stay as they are.</div>
          <JsonBox value={Object.fromEntries(Object.entries(asset).filter(([k]) => k !== 'key' && k !== 'type'))} rows={6}
            onApply={v => {
              if (typeof v !== 'object' || v === null || Array.isArray(v)) return;
              const next = v as Record<string, unknown>;
              const gone = Object.keys(asset).filter(k => k !== 'key' && k !== 'type' && !(k in next));
              patch({ ...Object.fromEntries(gone.map(k => [k, undefined])), ...next }, true);
            }} />
        </div>
      )}

      <button onClick={remove} className="mt-3 px-2 py-1 rounded text-xs border border-red-900 text-red-400 hover:bg-red-900/30">Remove from project</button>
    </div>
  );
}

export default function ManifestPanel({ project, onUpdate, onCommit, onRename, onRemove, onFindUses }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const assets = project?.assets ?? [];
  const asset = assets.find(a => a.key === selected) ?? null;

  // Remember where the selected entry sits, so undoing a rename (the key changes back) keeps the same row selected.
  const last = useRef({ index: -1, count: 0 });
  useEffect(() => {
    if (asset) { last.current = { index: assets.indexOf(asset), count: assets.length }; return; }
    if (!selected) return;
    const { index, count } = last.current;
    setSelected(count === assets.length && assets[index] ? assets[index].key : null);
  }, [selected, asset, assets]);

  if (!project) return <div className="h-full flex items-center justify-center p-6"><p className="text-xs text-gray-500 text-center">Open a project to see its assets.</p></div>;
  if (!assets.length) return (
    <div className="h-full flex items-center justify-center p-6">
      <p className="text-xs text-gray-500 text-center leading-relaxed">No assets in the project file yet.<br />Drag an image from the Assets or FileSystem panel into the viewport to add one.</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="max-h-[45%] min-h-[3.5rem] overflow-y-auto border-b border-gray-700 py-1 flex-shrink-0">
        {assets.map(a => (
          <button key={a.key} onClick={() => setSelected(a.key)}
            className={`w-full flex items-center gap-2 px-2 py-1 text-xs text-left ${a.key === selected ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
            <span className="truncate flex-1">{a.key}</span>
            <span className="text-[10px] text-gray-500 flex-shrink-0">{a.type}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {asset
          ? <AssetEditor key={asset.key} asset={asset} onUpdate={onUpdate} onCommit={onCommit} onRename={(o, n) => { const ok = onRename(o, n); if (ok) setSelected(n); return ok; }} onRemove={onRemove} onFindUses={onFindUses} />
          : <p className="text-xs text-gray-500 text-center p-6">Select an asset to edit it.</p>}
      </div>
    </div>
  );
}
