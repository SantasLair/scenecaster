import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { PROJECT_DIR, SCENES_DIR, SCENE_EXT } from '../../../shared/layout';

interface Props {
  projectFolder: string | null;
  onOpenProject: () => void;
  /** Opens one of the project's scenes by key (a `scenecaster/scenes/<key>.scene.json` file was activated). */
  onOpenScene: (key: string) => void;
  onDragAsset: () => void;
}

interface Row { entry: FsEntry; depth: number; root?: boolean }

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const AUDIO_EXTS = ['.mp3', '.ogg', '.wav', '.flac', '.m4a'];
const SCRIPT_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];

const slash = (p: string) => p.replace(/\\/g, '/');
const baseName = (p: string) => slash(p).replace(/\/+$/, '').split('/').pop() ?? p;

type Kind = 'folder' | 'image' | 'scene' | 'json' | 'script' | 'audio' | 'text' | 'file';
const KIND_COLOR: Record<Kind, string> = {
  folder: '#d9b45a', image: '#7fd1a3', scene: '#569eff', json: '#e0c46a', script: '#e8895a', audio: '#c28fe0', text: '#b5bcc9', file: '#9aa3b2',
};

function kindOf(e: FsEntry, sceneKey: string | null): Kind {
  if (e.type === 'folder') return 'folder';
  if (sceneKey) return 'scene';
  if (IMAGE_EXTS.includes(e.ext)) return 'image';
  if (AUDIO_EXTS.includes(e.ext)) return 'audio';
  if (SCRIPT_EXTS.includes(e.ext)) return 'script';
  if (e.ext === '.json') return 'json';
  if (['.md', '.txt', '.html', '.css', '.yml', '.yaml', '.xml'].includes(e.ext)) return 'text';
  return 'file';
}

/** Small flat icons in the spirit of Godot's FileSystem dock; replaced by Godot's own icon set later. */
function FileIcon({ kind, open }: { kind: Kind; open?: boolean }) {
  const c = KIND_COLOR[kind];
  const props = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: c, strokeWidth: 1.4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const, className: 'flex-shrink-0' };
  switch (kind) {
    case 'folder': return open
      ? <svg {...props}><path d="M1.5 4.5v8h11l2-6h-9l-1-2h-3z" fill={c} fillOpacity=".25" /></svg>
      : <svg {...props}><path d="M1.5 3.5h4l1.5 1.5h7.5v7.5h-13z" fill={c} fillOpacity=".25" /></svg>;
    case 'image': return <svg {...props}><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="6" cy="7" r="1.2" fill={c} /><path d="M3 12l3.5-3.5 2.5 2.5 2-2 2 2" /></svg>;
    case 'scene': return <svg {...props}><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6.5h12M6 3v10" /></svg>;
    case 'script': return <svg {...props}><path d="M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5" /></svg>;
    case 'audio': return <svg {...props}><path d="M3 6.5v3h2.5L9 12V4L5.5 6.5zM11 6a3 3 0 010 4" /></svg>;
    case 'json': return <svg {...props}><path d="M6 3c-1.5 0-1.5 1-1.5 2s0 2-1.5 3c1.500 1 1.500 2 1.500 3s0 2 1.500 2M10 3c1.500 0 1.500 1 1.500 2s0 2 1.500 3c-1.500 1-1.500 2-1.500 3s0 2-1.500 2" /></svg>;
    default: return <svg {...props}><path d="M4 2.5h5l3 3v8H4z M9 2.5v3h3" /></svg>;
  }
}

function Arrow({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className="flex-shrink-0 text-gray-500" style={{ transform: open ? 'rotate(90deg)' : undefined }}>
      <path d="M3 1.5L7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function FileSystemPanel({ projectFolder, onOpenProject, onOpenScene, onDragAsset }: Props) {
  const root = projectFolder ? slash(projectFolder).replace(/\/+$/, '') : null;
  const api = window.electronAPI;

  const [children, setChildren] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [found, setFound] = useState<FsEntry[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FsEntry } | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const sceneRe = useMemo(() => {
    if (!root) return null;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${esc(root)}/${esc(PROJECT_DIR)}/${esc(SCENES_DIR)}/([^/]+)${esc(SCENE_EXT)}$`, 'i');
  }, [root]);
  const sceneKeyOf = useCallback((e: FsEntry) => (e.type === 'file' && sceneRe ? slash(e.path).match(sceneRe)?.[1] ?? null : null), [sceneRe]);
  const rel = useCallback((p: string) => (root && slash(p).startsWith(root + '/') ? slash(p).slice(root.length + 1) : slash(p)), [root]);

  const load = useCallback(async (dir: string) => {
    const list = await api.listDir(dir);
    setChildren(c => ({ ...c, [dir]: list }));
  }, [api]);

  const reload = useCallback(() => {
    if (!projectFolder) return;
    load(projectFolder);
    for (const dir of expandedRef.current) if (dir !== projectFolder) load(dir);
  }, [projectFolder, load]);

  // A new project starts with only its root open.
  useEffect(() => {
    setChildren({}); setSelected(null); setFilter(''); setFound(null); setMenu(null);
    if (!projectFolder) { setExpanded(new Set()); return; }
    setExpanded(new Set([projectFolder]));
    load(projectFolder);
  }, [projectFolder, load]);

  // Files change outside the editor (the AI, git): rescan when the window regains focus, like Godot.
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  // Filtering searches the whole project, not only the folders that have been opened.
  useEffect(() => {
    const q = filter.trim();
    if (!projectFolder || !q) { setFound(null); return; }
    let cancelled = false;
    const t = setTimeout(() => { api.findFiles(projectFolder, q).then(r => { if (!cancelled) setFound(r); }); }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [filter, projectFolder, api]);

  const rows = useMemo<Row[]>(() => {
    if (!projectFolder) return [];
    if (found) return found.map(entry => ({ entry, depth: 0 }));
    const out: Row[] = [{ entry: { name: baseName(projectFolder), type: 'folder', path: projectFolder, ext: '' }, depth: 0, root: true }];
    const walk = (dir: string, depth: number) => {
      for (const entry of children[dir] ?? []) {
        out.push({ entry, depth });
        if (entry.type === 'folder' && expanded.has(entry.path)) walk(entry.path, depth + 1);
      }
    };
    if (expanded.has(projectFolder)) walk(projectFolder, 1);
    return out;
  }, [projectFolder, children, expanded, found]);

  const toggle = (dir: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else { next.add(dir); load(dir); }
      return next;
    });
  };

  const activate = (e: FsEntry) => {
    if (e.type === 'folder') return toggle(e.path);
    const key = sceneKeyOf(e);
    if (key) onOpenScene(key);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'F5') { reload(); return; }
    const i = rows.findIndex(r => r.entry.path === selected);
    const cur = rows[i];
    const select = (j: number) => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (r) setSelected(r.entry.path); };
    if (ev.key === 'ArrowDown') { ev.preventDefault(); select(i + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); select(i < 0 ? 0 : i - 1); }
    else if (ev.key === 'ArrowRight' && cur?.entry.type === 'folder') {
      ev.preventDefault();
      if (!expanded.has(cur.entry.path)) toggle(cur.entry.path); else select(i + 1);
    } else if (ev.key === 'ArrowLeft' && cur) {
      ev.preventDefault();
      if (cur.entry.type === 'folder' && expanded.has(cur.entry.path) && !cur.root) toggle(cur.entry.path);
      else for (let j = i - 1; j >= 0; j--) if (rows[j].depth < cur.depth) { select(j); break; }
    } else if (ev.key === 'Enter' && cur) { ev.preventDefault(); activate(cur.entry); }
  };

  if (!projectFolder) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-xs text-gray-500">Open a project to browse its files.</p>
        <button onClick={onOpenProject} className="px-3 py-1 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white">Open Project Folder</button>
      </div>
    );
  }

  const copy = (text: string) => { navigator.clipboard?.writeText(text).catch(() => { /* clipboard unavailable */ }); };

  return (
    <div className="h-full flex flex-col" onClick={() => setMenu(null)}>
      <div className="flex items-center gap-1 p-1.5 flex-shrink-0">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter files"
          onKeyDown={e => { if (e.key === 'Escape') setFilter(''); e.stopPropagation(); }}
          className="flex-1 min-w-0 px-2 py-1 rounded text-xs bg-gray-950 border border-gray-700 text-gray-200 placeholder-gray-600 focus:border-blue-500 outline-none" />
        <button onClick={reload} title="Refresh (F5)" className="px-1.5 py-1 rounded text-gray-400 hover:bg-gray-700 hover:text-white">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5v3h-3" /></svg>
        </button>
      </div>

      <div tabIndex={0} onKeyDown={onKeyDown} className="flex-1 overflow-auto outline-none text-xs pb-2">
        {rows.length === 0 && <p className="px-3 py-2 text-gray-500">No files match.</p>}
        {rows.map(({ entry, depth, root: isRoot }) => {
          const open = entry.type === 'folder' && expanded.has(entry.path);
          const key = sceneKeyOf(entry);
          const kind = kindOf(entry, key);
          const isSel = selected === entry.path;
          const draggable = entry.type === 'file' && IMAGE_EXTS.includes(entry.ext);
          return (
            <div key={entry.path}
              draggable={draggable}
              onDragStart={draggable ? ev => {
                ev.dataTransfer.setData('application/phaser-asset', JSON.stringify({ name: entry.name, fullPath: entry.path, dataUrl: '' }));
                onDragAsset();
              } : undefined}
              onClick={ev => { ev.stopPropagation(); setSelected(entry.path); setMenu(null); }}
              onDoubleClick={() => activate(entry)}
              onContextMenu={ev => { ev.preventDefault(); ev.stopPropagation(); setSelected(entry.path); setMenu({ x: ev.clientX, y: ev.clientY, entry }); }}
              title={rel(entry.path) || entry.name}
              style={{ paddingLeft: 6 + depth * 14 }}
              className={`flex items-center gap-1.5 h-[22px] pr-2 cursor-default select-none whitespace-nowrap ${isSel ? 'bg-[var(--gd-tree-selected)] text-white' : 'text-gray-300 hover:bg-[var(--gd-tree-hover)]'}`}>
              {entry.type === 'folder' && !found
                ? <span onClick={ev => { ev.stopPropagation(); toggle(entry.path); }} className="w-3 flex justify-center"><Arrow open={open} /></span>
                : <span className="w-3" />}
              <FileIcon kind={kind} open={open} />
              <span className={found ? 'flex-shrink-0 max-w-[60%] truncate' : 'truncate'}>{isRoot ? `${entry.name}/` : entry.name}</span>
              {found && <span className="truncate text-gray-600 ml-1">{rel(entry.path)}</span>}
            </div>
          );
        })}
      </div>

      {menu && (
        <div style={{ left: menu.x, top: menu.y }} onClick={ev => ev.stopPropagation()}
          className="fixed z-50 min-w-44 py-1 rounded text-xs bg-gray-800 border border-gray-700 shadow-lg shadow-black/40">
          {[
            ...(sceneKeyOf(menu.entry) ? [{ label: 'Open Scene', run: () => onOpenScene(sceneKeyOf(menu.entry)!) }] : []),
            { label: 'Show in File Manager', run: () => api.showItem(menu.entry.path) },
            { label: 'Copy Path', run: () => copy(menu.entry.path) },
            { label: 'Copy Relative Path', run: () => copy(rel(menu.entry.path)) },
            { label: 'Refresh', run: reload },
          ].map(item => (
            <button key={item.label} onClick={() => { item.run(); setMenu(null); }}
              className="block w-full text-left px-3 py-1 text-gray-300 hover:bg-gray-700 hover:text-white">{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
