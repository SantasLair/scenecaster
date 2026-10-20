import { useEffect, useRef, useState } from 'react';
import type { PfAsset, PfProject } from '../../../shared/phaseform/types';
import { animationList, frameMs, uniqueAnimationKey, type PfAnimation, type PfAnimFrame } from '../../../shared/phaseform/animations';
import { sheetFrames, sheetSpec } from '../../../shared/phaseform/sheet';
import { useProjectImage } from '../hooks/useProjectImage';
import { usesOfAnimation } from '../sceneModel';
import { KeyField } from './ManifestPanel';
import { NumberInput, Row, inputCls } from './Inspector';
import SheetPreview from './SheetPreview';

interface Props {
  project: PfProject | null;
  onAdd(anim: PfAnimation): boolean;
  /** A value of undefined removes the field. `commit` ends the undo step at once. */
  onUpdate(key: string, patch: Record<string, unknown>, commit?: boolean): void;
  onCommit(): void;
  onRename(oldKey: string, newKey: string): boolean;
  onRemove(key: string): void;
}

const TEXTURE_TYPES = ['image', 'spritesheet', 'atlas'];
const textures = (project: PfProject): PfAsset[] => project.assets.filter(a => TEXTURE_TYPES.includes(a.type));

/** Plays the animation in a loop at its real timing, honouring yoyo; frames come from the sheets' grids. */
function Preview({ anim, assets }: { anim: PfAnimation; assets: PfAsset[] }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const n = anim.frames.length;
  // A yoyo plays 0..n-1 then back down to 1, so the cycle has 2n-2 steps.
  const cycle = anim.yoyo && n > 2 ? n * 2 - 2 : n;
  const index = Math.min(step % Math.max(cycle, 1), Math.max(cycle, 1) - 1);
  const frameIndex = index < n ? index : cycle - index;
  const frame = anim.frames[frameIndex];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!playing || cycle < 2) return;
    timer.current = setTimeout(() => setStep(s => (s + 1) % cycle), frameMs(anim, frameIndex));
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [playing, step, cycle, anim, frameIndex]);

  const asset = assets.find(a => a.key === frame?.key);
  const img = useProjectImage(typeof asset?.url === 'string' ? asset.url : null);
  const spec = asset?.type === 'spritesheet' ? sheetSpec(asset) : null;
  const rect = img.size && spec && typeof frame?.frame === 'number' ? sheetFrames(img.size.w, img.size.h, spec).find(f => f.index === frame.frame) : undefined;
  const box = rect ?? (img.size && asset?.type === 'image' ? { x: 0, y: 0, w: img.size.w, h: img.size.h } : undefined);
  const scale = box ? Math.min(96 / box.w, 96 / box.h, 4) : 1;

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 h-24 flex items-center justify-center bg-gray-950 border border-gray-700 flex-shrink-0">
        {box && img.src && img.size ? (
          <div style={{
            width: box.w * scale, height: box.h * scale, backgroundImage: `url(${img.src})`, imageRendering: 'pixelated',
            backgroundSize: `${img.size.w * scale}px ${img.size.h * scale}px`, backgroundPosition: `${-box.x * scale}px ${-box.y * scale}px`,
          }} />
        ) : <span className="text-[10px] text-gray-600 text-center px-1">{frame ? 'no preview' : 'no frames'}</span>}
      </div>
      <div className="text-[11px] text-gray-400">
        <button onClick={() => setPlaying(p => !p)} className="px-2 py-0.5 rounded border border-gray-700 hover:text-white hover:border-gray-500">{playing ? 'Pause' : 'Play'}</button>
        <div className="mt-1">Frame {frameIndex + 1} of {n}</div>
      </div>
    </div>
  );
}

/** Picks frames to append: click a cell of a sheet, or add every frame of it. */
function AddFrames({ project, onAppend }: { project: PfProject; onAppend(frames: PfAnimFrame[]): void }) {
  const list = textures(project);
  const [key, setKey] = useState(list[0]?.key ?? '');
  const asset = list.find(a => a.key === key) ?? list[0];
  const img = useProjectImage(asset?.type === 'spritesheet' && typeof asset.url === 'string' ? asset.url : null);
  const spec = asset?.type === 'spritesheet' ? sheetSpec(asset) : null;
  const all = img.size && spec ? sheetFrames(img.size.w, img.size.h, spec) : [];
  if (!asset) return <p className="text-[11px] text-gray-500">The project has no image assets to animate.</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <select value={asset.key} onChange={e => setKey(e.target.value)} className={`flex-1 min-w-0 ${inputCls}`}>
          {list.map(a => <option key={a.key} value={a.key}>{a.key} ({a.type})</option>)}
        </select>
        {asset.type === 'spritesheet'
          ? <button disabled={!all.length} onClick={() => onAppend(all.map(f => ({ key: asset.key, frame: f.index })))}
              className="px-2 py-0.5 rounded text-xs border border-gray-700 text-gray-300 hover:border-gray-500 disabled:opacity-40 whitespace-nowrap">Add all</button>
          : asset.type === 'image'
            ? <button onClick={() => onAppend([{ key: asset.key }])} className="px-2 py-0.5 rounded text-xs border border-gray-700 text-gray-300 hover:border-gray-500">Add</button>
            : null}
      </div>
      {asset.type === 'spritesheet' && <SheetPreview asset={asset} maxSize={200} onPick={i => onAppend([{ key: asset.key, frame: i }])} />}
      {asset.type === 'atlas' && <p className="text-[10px] text-gray-600">Atlas frames are named: add them by editing the frame name in the list.</p>}
      {asset.type === 'spritesheet' && <p className="text-[10px] text-gray-600 mt-0.5">Click a frame to append it.</p>}
    </div>
  );
}

function AnimationEditor({ anim, project, onUpdate, onCommit, onRename, onRemove }: Omit<Props, 'onAdd' | 'project'> & { anim: PfAnimation; project: PfProject }) {
  const patch = (p: Record<string, unknown>, commit = false) => onUpdate(anim.key, p, commit);
  const setFrames = (frames: PfAnimFrame[]) => patch({ frames }, true);
  const edit = (i: number, change: Partial<PfAnimFrame>) => setFrames(anim.frames.map((f, j) => {
    if (j !== i) return f;
    const next = { ...f, ...change };
    for (const k of Object.keys(change)) if (change[k] === undefined) delete next[k];
    return next;
  }));
  const move = (i: number, d: number) => {
    const to = i + d;
    if (to < 0 || to >= anim.frames.length) return;
    const frames = [...anim.frames];
    [frames[i], frames[to]] = [frames[to], frames[i]];
    setFrames(frames);
  };
  const texList = textures(project);

  const remove = () => {
    const uses = usesOfAnimation(anim.key);
    const detail = uses.length ? `\n\nStill played by: ${uses.slice(0, 8).join(', ')}${uses.length > 8 ? ` and ${uses.length - 8} more` : ''}.\nThey will show a missing-animation warning.` : '';
    if (window.confirm(`Remove animation "${anim.key}"?${detail}`)) onRemove(anim.key);
  };

  return (
    <div className="p-2">
      <KeyField keyName={anim.key} onRename={k => onRename(anim.key, k)} what="animation" hint="Renaming also updates the sprites in the open scene that play it." />

      <div className="my-2"><Preview anim={anim} assets={project.assets} /></div>

      <div className="text-[11px] text-gray-500 mt-2 mb-1">Frames ({anim.frames.length})</div>
      {anim.frames.map((f, i) => (
        <div key={i} className="flex items-center gap-1 mb-1">
          <span className="w-5 text-right text-[10px] text-gray-600 flex-shrink-0">{i + 1}</span>
          <select value={f.key} onChange={e => edit(i, { key: e.target.value })}
            className={`flex-1 min-w-0 ${inputCls} ${texList.some(a => a.key === f.key) ? '' : '!border-red-600 text-red-300'}`}>
            {!texList.some(a => a.key === f.key) && <option value={f.key}>{f.key} (missing)</option>}
            {texList.map(a => <option key={a.key} value={a.key}>{a.key}</option>)}
          </select>
          {typeof f.frame === 'string'
            ? <input readOnly value={f.frame} title="Frame name" className={`w-16 ${inputCls}`} />
            : <NumberInput value={f.frame} def={0} min={0} int width="w-14" onValue={v => onUpdate(anim.key, { frames: anim.frames.map((g, j) => (j === i ? { ...g, frame: v } : g)) })} onCommit={onCommit} />}
          <NumberInput value={f.duration} def={0} min={0} int width="w-14" onValue={v => onUpdate(anim.key, { frames: anim.frames.map((g, j) => (j === i ? { ...g, duration: v } : g)) })} onCommit={onCommit} />
          <button title="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-500 hover:text-white disabled:opacity-30 px-0.5">↑</button>
          <button title="Move down" onClick={() => move(i, 1)} disabled={i === anim.frames.length - 1} className="text-gray-500 hover:text-white disabled:opacity-30 px-0.5">↓</button>
          <button title="Remove frame" onClick={() => setFrames(anim.frames.filter((_, j) => j !== i))} disabled={anim.frames.length === 1} className="text-gray-500 hover:text-red-400 disabled:opacity-30 px-0.5">×</button>
        </div>
      ))}
      <div className="text-[10px] text-gray-600 mb-2">Columns: texture, frame number, extra milliseconds on that frame.</div>

      <div className="border border-gray-700 rounded p-2 mb-3">
        <div className="text-[11px] text-gray-500 mb-1">Add frames</div>
        <AddFrames project={project} onAppend={frames => setFrames([...anim.frames, ...frames])} />
      </div>

      <Row label="Frame rate" hint="Frames per second. Phaser uses 24 when neither this nor a duration is set." onReset={anim.frameRate !== undefined ? () => patch({ frameRate: undefined }, true) : undefined}>
        <NumberInput value={anim.frameRate} def={24} min={0.1} step={1} onValue={v => patch({ frameRate: v })} onCommit={onCommit} />
      </Row>
      <Row label="Repeat" hint="-1 repeats forever." onReset={anim.repeat !== undefined ? () => patch({ repeat: undefined }, true) : undefined}>
        <NumberInput value={anim.repeat} def={0} min={-1} int onValue={v => patch({ repeat: v })} onCommit={onCommit} />
      </Row>
      <Row label="Delay (ms)" onReset={anim.delay !== undefined ? () => patch({ delay: undefined }, true) : undefined}>
        <NumberInput value={anim.delay} def={0} min={0} int onValue={v => patch({ delay: v })} onCommit={onCommit} />
      </Row>
      <Row label="Repeat delay (ms)" onReset={anim.repeatDelay !== undefined ? () => patch({ repeatDelay: undefined }, true) : undefined}>
        <NumberInput value={anim.repeatDelay} def={0} min={0} int onValue={v => patch({ repeatDelay: v })} onCommit={onCommit} />
      </Row>
      <Row label="Yoyo" onReset={anim.yoyo !== undefined ? () => patch({ yoyo: undefined }, true) : undefined}>
        <input type="checkbox" checked={anim.yoyo === true} onChange={e => patch({ yoyo: e.target.checked }, true)} className="accent-blue-500 w-4 h-4" />
      </Row>

      <button onClick={remove} className="mt-3 px-2 py-1 rounded text-xs border border-red-900 text-red-400 hover:bg-red-900/30">Remove animation</button>
    </div>
  );
}

export default function AnimationsPanel({ project, onAdd, onUpdate, onCommit, onRename, onRemove }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const list = animationList(project);
  const anim = list.find(a => a.key === selected) ?? null;

  // Undoing a rename changes the key back: keep the same row selected.
  const last = useRef({ index: -1, count: 0 });
  useEffect(() => {
    if (anim) { last.current = { index: list.indexOf(anim), count: list.length }; return; }
    if (!selected) return;
    const { index, count } = last.current;
    setSelected(count === list.length && list[index] ? list[index].key : null);
  }, [selected, anim, list]);

  if (!project) return <div className="h-full flex items-center justify-center p-6"><p className="text-xs text-gray-500 text-center">Open a project to see its animations.</p></div>;

  const first = textures(project)[0];
  const create = () => {
    if (!first) return;
    const key = uniqueAnimationKey(project, 'anim');
    const frame = first.type === 'spritesheet' ? { key: first.key, frame: 0 } : { key: first.key };
    if (onAdd({ key, frames: [frame], frameRate: 8, repeat: -1 })) setSelected(key);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="max-h-[40%] min-h-[3.5rem] overflow-y-auto border-b border-gray-700 py-1 flex-shrink-0">
        {list.map(a => (
          <button key={a.key} onClick={() => setSelected(a.key)}
            className={`w-full flex items-center gap-2 px-2 py-1 text-xs text-left ${a.key === selected ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
            <span className="truncate flex-1">{a.key}</span>
            <span className="text-[10px] text-gray-500 flex-shrink-0">{a.frames.length} frame{a.frames.length === 1 ? '' : 's'}</span>
          </button>
        ))}
        {list.length === 0 && <p className="text-[11px] text-gray-500 px-2 py-1">No animations yet.</p>}
        <button onClick={create} disabled={!first} title={first ? 'Create an animation from the first image asset' : 'Add an image asset first'}
          className="w-full text-left px-2 py-1 text-xs text-blue-300 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-transparent">+ New animation</button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {anim
          ? <AnimationEditor key={anim.key} anim={anim} project={project} onUpdate={onUpdate} onCommit={onCommit}
              onRename={(o, n) => { const ok = onRename(o, n); if (ok) setSelected(n); return ok; }} onRemove={onRemove} />
          : <p className="text-xs text-gray-500 text-center p-6">Select an animation to edit it.</p>}
      </div>
    </div>
  );
}
