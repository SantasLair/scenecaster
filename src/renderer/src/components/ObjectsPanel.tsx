import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { PfObject } from '../../../shared/phaseform/types';
import { isContainer } from '../../../shared/phaseform/types';
import { labelOf, walk } from '../../../shared/phaseform/tree';
import Icon from './Icon';

export type AddKind = 'container' | 'rectangle' | 'ellipse' | 'triangle' | 'text';

interface Props {
  objects: PfObject[];
  selectedId: string | null;
  lockedIds: ReadonlySet<string>;
  onSelect(id: string): void;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  /** Sets the object's `name` ('' clears it). */
  onRename(id: string, label: string): void;
  onToggleVisible(id: string): void;
  onToggleLocked(id: string): void;
  /** `index` is the position among the new parent's children as shown before the dragged item is removed. */
  onMove(id: string, parentId: string | null, index: number): void;
  /** parentId = selected container or null. */
  onAdd(kind: AddKind, parentId: string | null): void;
}

const ADD_ITEMS: { kind: AddKind; label: string }[] = [
  { kind: 'container', label: 'Container' },
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'text', label: 'Text' },
];

const DRAG_MIME = 'application/x-pf-object';

type DropPos = 'before' | 'after' | 'into';
interface DropTarget { id: string | null; pos: DropPos | 'end' }

interface RowData {
  obj: PfObject;
  depth: number;
  parentId: string | null;
  index: number;
  container: boolean;
  open: boolean;
}

// ---------------------------------------------------------------- icons

const TYPE_COLOR: Record<string, string> = {
  container: '#d9b45a', image: '#7fd1a3', sprite: '#7fd1a3', tileSprite: '#7fd1a3',
  text: '#e8895a', bitmapText: '#e8895a', graphics: '#c28fe0',
};
const SHAPE_COLOR = '#569eff';

function TypeIcon({ type }: { type: string }) {
  const c = TYPE_COLOR[type] ?? SHAPE_COLOR;
  const p = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: c, strokeWidth: 1.4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const, className: 'flex-shrink-0' };
  switch (type) {
    case 'container': return <svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.5" strokeDasharray="2.5 1.5" /><rect x="5" y="6" width="6" height="4" fill={c} fillOpacity=".25" /></svg>;
    case 'image': return <svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="6" cy="7" r="1.2" fill={c} /><path d="M3 12l3.5-3.5 2.5 2.5 2-2 2 2" /></svg>;
    case 'sprite': return <svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M8 5l1 2.2 2.2.3-1.7 1.5.5 2.3L8 10.200 6 11.300l.5-2.300L4.800 7.500 7 7.200z" fill={c} fillOpacity=".4" /></svg>;
    case 'tileSprite': return <svg {...p}><rect x="2" y="2" width="12" height="12" rx="1" /><path d="M8 2v12M2 8h12" /></svg>;
    case 'text': return <svg {...p}><path d="M3 4h10M8 4v9M6 13h4" /></svg>;
    case 'bitmapText': return <svg {...p}><path d="M3 13l3.500-9L10 13M4.300 10h4.400M12 6v7" /></svg>;
    case 'rectangle': return <svg {...p}><rect x="2.500" y="4" width="11" height="8" fill={c} fillOpacity=".25" /></svg>;
    case 'ellipse': return <svg {...p}><ellipse cx="8" cy="8" rx="5.500" ry="4" fill={c} fillOpacity=".25" /></svg>;
    case 'triangle': return <svg {...p}><path d="M8 3L14 13H2z" fill={c} fillOpacity=".25" /></svg>;
    case 'line': return <svg {...p}><path d="M3 13L13 3" /></svg>;
    case 'polygon': return <svg {...p}><path d="M8 2.500l5 3.600-2 5.900H5L3 6.100z" fill={c} fillOpacity=".25" /></svg>;
    case 'star': return <svg {...p}><path d="M8 2l1.800 4 4.200.4-3.200 2.800 1 4.300L8 11.300 4.200 13.500l1-4.300L2 6.400 6.200 6z" fill={c} fillOpacity=".25" /></svg>;
    case 'arc': return <svg {...p}><path d="M3 12a5.500 5.500 0 0110 0" /></svg>;
    default: return <svg {...p}><path d="M4 2.500h5l3 3v8H4z M9 2.500v3h3" /></svg>;
  }
}

function Arrow({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className="flex-shrink-0 text-gray-500" style={{ transform: open ? 'rotate(90deg)' : undefined }}>
      <path d="M3 1.5L7 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const EyeIcon = ({ off }: { off: boolean }) => <Icon name={off ? 'GuiVisibilityHidden' : 'GuiVisibilityVisible'} size={14} />;
const LockIcon = ({ on }: { on: boolean }) => <Icon name={on ? 'Lock' : 'Unlock'} size={14} />;

// ---------------------------------------------------------------- rows

interface Handlers {
  select(id: string): void;
  toggle(id: string): void;
  startRename(id: string): void;
  commitRename(id: string, value: string): void;
  cancelRename(): void;
  context(e: React.MouseEvent, id: string): void;
  toggleVisible(id: string): void;
  toggleLocked(id: string): void;
  dragStart(e: React.DragEvent, id: string): void;
  dragOver(e: React.DragEvent, row: RowData, pos: DropPos): void;
  drop(e: React.DragEvent): void;
  dragEnd(): void;
}

function RenameInput({ obj, onCommit, onCancel }: { obj: PfObject; onCommit(v: string): void; onCancel(): void }) {
  const [text, setText] = useState(typeof obj.name === 'string' ? obj.name : '');
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(text.trim()); else onCancel();
  };
  return (
    <input ref={ref} value={text} placeholder={obj.id} spellCheck={false}
      onChange={e => setText(e.target.value)}
      onBlur={() => finish(true)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      className="flex-1 min-w-0 h-[18px] bg-gray-950 border border-blue-500 rounded px-1 text-xs text-white focus:outline-none" />
  );
}

const TreeRow = memo(function TreeRow({ row, selected, locked, renaming, drop, h }: {
  row: RowData; selected: boolean; locked: boolean; renaming: boolean; drop: DropPos | null; h: Handlers;
}) {
  const { obj, depth, container, open } = row;
  const hidden = obj.visible === false;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  const onDragOver = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const pos: DropPos = container ? (f < 0.25 ? 'before' : f > 0.75 ? 'after' : 'into') : (f < 0.5 ? 'before' : 'after');
    h.dragOver(e, row, pos);
  };

  return (
    <div ref={ref} data-row-id={obj.id}
      draggable={!renaming}
      onDragStart={e => h.dragStart(e, obj.id)}
      onDragOver={onDragOver}
      onDrop={h.drop}
      onDragEnd={h.dragEnd}
      onClick={e => { e.stopPropagation(); h.select(obj.id); }}
      onDoubleClick={e => { e.stopPropagation(); h.startRename(obj.id); }}
      onContextMenu={e => h.context(e, obj.id)}
      title={obj.id}
      style={{ paddingLeft: 6 + depth * 14 }}
      className={`group relative flex items-center gap-1.5 h-[22px] pr-1.5 cursor-default select-none whitespace-nowrap ${
        selected ? 'bg-[var(--gd-tree-selected)] text-white' : 'text-gray-300 hover:bg-[var(--gd-tree-hover)]'
      } ${drop === 'into' ? 'outline outline-1 -outline-offset-1 outline-blue-500 bg-blue-900/30' : ''}`}>
      {drop === 'before' && <span className="absolute left-0 right-0 top-0 h-[2px] bg-blue-500 pointer-events-none" />}
      {drop === 'after' && <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-blue-500 pointer-events-none" />}
      {container
        ? <span onClick={e => { e.stopPropagation(); h.toggle(obj.id); }} className="w-3 flex justify-center"><Arrow open={open} /></span>
        : <span className="w-3 flex-shrink-0" />}
      <span className={`flex items-center gap-1.5 min-w-0 ${renaming ? 'flex-1' : 'flex-1'} ${hidden ? 'opacity-40' : ''}`}>
        <TypeIcon type={obj.type} />
        {renaming
          ? <RenameInput obj={obj} onCommit={v => h.commitRename(obj.id, v)} onCancel={h.cancelRename} />
          : <span className="truncate">{labelOf(obj)}</span>}
      </span>
      <button onClick={e => { e.stopPropagation(); h.toggleLocked(obj.id); }} title={locked ? 'Unlock' : 'Lock'}
        onDoubleClick={e => e.stopPropagation()}
        className={`flex-shrink-0 transition-opacity ${locked ? 'opacity-100 text-amber-400' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-gray-400'}`}>
        <LockIcon on={locked} />
      </button>
      <button onClick={e => { e.stopPropagation(); h.toggleVisible(obj.id); }} title={hidden ? 'Show' : 'Hide'}
        onDoubleClick={e => e.stopPropagation()}
        className={`flex-shrink-0 transition-opacity ${hidden ? 'opacity-100 text-gray-500' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-gray-400'}`}>
        <EyeIcon off={hidden} />
      </button>
    </div>
  );
});

// ---------------------------------------------------------------- menus

type MenuState = { x: number; y: number; id: string | null; mode: 'context' | 'add' } | null;

function Menu({ menu, parentId, canAct, onClose, onAdd, onRename, onDuplicate, onDelete }: {
  menu: NonNullable<MenuState>; parentId: string | null; canAct: boolean; onClose(): void;
  onAdd(kind: AddKind, parentId: string | null): void; onRename(): void; onDuplicate(): void; onDelete(): void;
}) {
  const item = 'block w-full text-left px-3 py-1 text-gray-300 hover:bg-gray-700 hover:text-white';
  const adds = (
    <>
      {ADD_ITEMS.map(a => (
        <button key={a.kind} className={item} onClick={() => { onAdd(a.kind, parentId); onClose(); }}>{a.label}</button>
      ))}
    </>
  );
  const left = Math.min(menu.x, window.innerWidth - 170);
  const top = Math.min(menu.y, window.innerHeight - (menu.mode === 'add' ? 140 : 190));
  return (
    <div style={{ left, top }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
      className="fixed z-[2000] min-w-40 py-1 rounded text-xs bg-gray-800 border border-gray-700 shadow-lg shadow-black/40">
      {menu.mode === 'add' ? adds : (
        <>
          <div className="relative group/add">
            <div className={`${item} cursor-default flex justify-between`}><span>Add</span><span className="text-gray-500">&rsaquo;</span></div>
            <div className="hidden group-hover/add:block absolute left-full top-0 min-w-32 py-1 rounded bg-gray-800 border border-gray-700 shadow-lg shadow-black/40">{adds}</div>
          </div>
          {canAct && (
            <>
              <div className="my-1 border-t border-gray-700" />
              <button className={item} onClick={() => { onRename(); onClose(); }}>Rename<span className="float-right text-gray-500">F2</span></button>
              <button className={item} onClick={() => { onDuplicate(); onClose(); }}>Duplicate</button>
              <button className={`${item} !text-red-400`} onClick={() => { onDelete(); onClose(); }}>Delete<span className="float-right text-gray-500">Del</span></button>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- panel

function flatten(objects: PfObject[], expanded: ReadonlySet<string>): RowData[] {
  const out: RowData[] = [];
  const rec = (list: PfObject[], depth: number, parentId: string | null) => {
    list.forEach((obj, index) => {
      const container = isContainer(obj);
      const open = container && expanded.has(obj.id);
      out.push({ obj, depth, parentId, index, container, open });
      if (open && obj.children) rec(obj.children, depth + 1, obj.id);
    });
  };
  rec(objects, 0, null);
  return out;
}

export default function ObjectsPanel(props: Props) {
  const { objects, selectedId, lockedIds } = props;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);

  const { parents, byId } = useMemo(() => {
    const parents = new Map<string, string | null>();
    const byId = new Map<string, PfObject>();
    for (const { obj, parent } of walk(objects)) { parents.set(obj.id, parent?.id ?? null); byId.set(obj.id, obj); }
    return { parents, byId };
  }, [objects]);
  const rows = useMemo(() => flatten(objects, expanded), [objects, expanded]);

  // Latest values for the stable handlers.
  const live = useRef({ props, rows, parents, byId, drop, expanded });
  live.current = { props, rows, parents, byId, drop, expanded };
  const dragRef = useRef<string | null>(null);

  // Reveal the selection: open its ancestors once per selected id.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || revealed.current === selectedId || !parents.has(selectedId)) return;
    revealed.current = selectedId;
    const need: string[] = [];
    for (let p = parents.get(selectedId) ?? null; p; p = parents.get(p) ?? null) need.push(p);
    if (need.some(id => !expanded.has(id))) setExpanded(prev => new Set([...prev, ...need]));
  }, [selectedId, parents, expanded]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', key); };
  }, [menu]);

  const h = useMemo<Handlers>(() => {
    const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    return {
      select: id => live.current.props.onSelect(id),
      toggle,
      startRename: id => { live.current.props.onSelect(id); setRenamingId(id); },
      commitRename: (id, value) => {
        setRenamingId(null);
        const cur = live.current.byId.get(id);
        const before = cur && typeof cur.name === 'string' ? cur.name : '';
        if (value !== before) live.current.props.onRename(id, value);
      },
      cancelRename: () => setRenamingId(null),
      context: (e, id) => {
        e.preventDefault(); e.stopPropagation();
        live.current.props.onSelect(id);
        setMenu({ x: e.clientX, y: e.clientY, id, mode: 'context' });
      },
      toggleVisible: id => live.current.props.onToggleVisible(id),
      toggleLocked: id => live.current.props.onToggleLocked(id),
      dragStart: (e, id) => {
        e.stopPropagation();
        dragRef.current = id;
        e.dataTransfer.setData(DRAG_MIME, id);
        e.dataTransfer.effectAllowed = 'move';
      },
      dragOver: (e, row, pos) => {
        const dragged = dragRef.current;
        if (!dragged) return;
        e.stopPropagation();
        // Refuse the dragged object itself and anything inside it.
        for (let p: string | null = row.obj.id; p; p = live.current.parents.get(p) ?? null) {
          if (p === dragged) { e.dataTransfer.dropEffect = 'none'; setDrop(null); return; }
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Just under an open container's header is where its children begin: that means "into".
        const eff: DropPos = pos === 'after' && row.open && (row.obj.children?.length ?? 0) > 0 ? 'into' : pos;
        setDrop(d => (d && d.id === row.obj.id && d.pos === eff ? d : { id: row.obj.id, pos: eff }));
      },
      drop: e => {
        const dragged = dragRef.current;
        const target = live.current.drop;
        dragRef.current = null;
        setDrop(null);
        if (!dragged || !target) return;
        e.preventDefault(); e.stopPropagation();
        const { props: p, rows: rs, byId: map } = live.current;
        if (target.pos === 'end' || target.id === null) { p.onMove(dragged, null, p.objects.length); return; }
        const row = rs.find(r => r.obj.id === target.id);
        if (!row) return;
        if (target.pos === 'before') p.onMove(dragged, row.parentId, row.index);
        else if (target.pos === 'after') p.onMove(dragged, row.parentId, row.index + 1);
        else {
          p.onMove(dragged, row.obj.id, map.get(row.obj.id)?.children?.length ?? 0);
          setExpanded(prev => new Set(prev).add(row.obj.id));
        }
      },
      dragEnd: () => { dragRef.current = null; setDrop(null); },
    };
  }, []);

  const selectedObj = selectedId ? byId.get(selectedId) : undefined;
  const addParent = selectedObj && isContainer(selectedObj) ? selectedObj.id : null;
  const menuObj = menu?.id ? byId.get(menu.id) : undefined;
  const menuParent = menu?.mode === 'add' ? addParent : menuObj && isContainer(menuObj) ? menuObj.id : null;

  const addAndOpen = (kind: AddKind, parentId: string | null) => {
    props.onAdd(kind, parentId);
    if (parentId) setExpanded(prev => new Set(prev).add(parentId));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renamingId) return;
    const i = rows.findIndex(r => r.obj.id === selectedId);
    const cur = rows[i];
    const select = (j: number) => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (r) props.onSelect(r.obj.id); };
    if (e.key === 'ArrowDown') { e.preventDefault(); select(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(i < 0 ? 0 : i - 1); }
    else if (e.key === 'ArrowRight' && cur?.container) {
      e.preventDefault();
      if (!cur.open) h.toggle(cur.obj.id); else select(i + 1);
    } else if (e.key === 'ArrowLeft' && cur) {
      e.preventDefault();
      if (cur.open) h.toggle(cur.obj.id);
      else if (cur.parentId) props.onSelect(cur.parentId);
    } else if (e.key === 'Delete' && cur) { e.preventDefault(); props.onDelete(cur.obj.id); }
    else if (e.key === 'F2' && cur) { e.preventDefault(); setRenamingId(cur.obj.id); }
  };

  const openAddMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu(m => (m?.mode === 'add' ? null : { x: r.left, y: r.bottom + 2, id: null, mode: 'add' }));
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-2 py-1 flex-shrink-0 text-xs">
        <span className="text-gray-500">{byId.size} object{byId.size === 1 ? '' : 's'}</span>
        <button onClick={openAddMenu} onMouseDown={e => e.stopPropagation()} title="Add object"
          className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:bg-gray-700 hover:text-white text-sm leading-none">+</button>
      </div>

      <div tabIndex={0} onKeyDown={onKeyDown} className="flex-1 overflow-auto outline-none text-xs pb-2"
        onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, id: null, mode: 'context' }); }}
        onDragOver={e => {
          if (!dragRef.current) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          setDrop(d => (d && d.pos === 'end' ? d : { id: null, pos: 'end' }));
        }}
        onDrop={h.drop}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null); }}>
        {rows.length === 0 && <p className="px-3 py-3 text-gray-500">No objects. Add one with +.</p>}
        {rows.map(row => (
          <TreeRow key={row.obj.id} row={row}
            selected={row.obj.id === selectedId}
            locked={lockedIds.has(row.obj.id)}
            renaming={row.obj.id === renamingId}
            drop={drop && drop.id === row.obj.id && drop.pos !== 'end' ? drop.pos : null}
            h={h} />
        ))}
        <div className={`min-h-6 flex-1 ${drop?.pos === 'end' ? 'border-t-2 border-blue-500' : ''}`}
          onClick={() => { /* empty area: keep selection */ }} />
      </div>

      {menu && (
        <Menu menu={menu} parentId={menuParent} canAct={menu.mode === 'context' && !!menuObj}
          onClose={() => setMenu(null)}
          onAdd={addAndOpen}
          onRename={() => menu.id && setRenamingId(menu.id)}
          onDuplicate={() => menu.id && props.onDuplicate(menu.id)}
          onDelete={() => menu.id && props.onDelete(menu.id)} />
      )}
    </div>
  );
}
