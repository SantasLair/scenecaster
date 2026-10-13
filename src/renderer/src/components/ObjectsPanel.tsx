import React, { useState, useRef, useEffect } from 'react';
import type { Shape } from '../../../shared/protocol';

export interface HierarchyItem {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
}

interface ContextMenu {
  x: number;
  y: number;
  item?: HierarchyItem;
}

interface Props {
  items: HierarchyItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onAddPrimitive: (shape: Shape) => void;
}

const PRIMITIVES: { shape: Shape; icon: string; label: string }[] = [
  { shape: 'rect',     icon: '⬜', label: 'Rectangle' },
  { shape: 'circle',   icon: '⭕', label: 'Circle'    },
  { shape: 'triangle', icon: '△',  label: 'Triangle'  },
];

export default function HierarchyPanel({
  items, selectedId, onSelect, onDelete, onDuplicate, onRename,
  onToggleVisible, onToggleLocked, onAddPrimitive,
}: Props) {
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addMenuRect, setAddMenuRect] = useState<DOMRect | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
      const t = e.target as Node;
      if (!addBtnRef.current?.contains(t) && !addMenuRef.current?.contains(t)) setShowAdd(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (renamingId) inputRef.current?.select();
  }, [renamingId]);

  const openMenu = (e: React.MouseEvent, item?: HierarchyItem) => {
    e.preventDefault();
    e.stopPropagation();
    setShowAdd(false);
    setMenu({ x: e.clientX, y: e.clientY, item });
  };

  const commitRename = () => {
    if (renamingId && renameVal.trim()) onRename(renamingId, renameVal.trim());
    setRenamingId(null);
  };

  const addPrimitive = (shape: Shape) => {
    onAddPrimitive(shape);
    setShowAdd(false);
    setMenu(null);
  };

  const typeIcon = (type: string) => {
    if (type === 'Sprite')   return '🖼';
    if (type === 'Image')    return '🌄';
    if (type === 'Text')     return '✏️';
    if (type === 'Rect')     return '⬜';
    if (type === 'Circle')   return '⭕';
    if (type === 'Triangle') return '△';
    return '◻';
  };

  return (
    <aside className="flex flex-col border-r border-gray-700 bg-gray-800 h-full relative overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Hierarchy</span>
        <span className="text-xs text-gray-600">{items.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1" onContextMenu={e => openMenu(e)}>

        <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 group">
          <span>📁</span>
          <span className="font-medium flex-1">Scene</span>
          <button
            ref={addBtnRef}
            onClick={() => {
              const rect = addBtnRef.current?.getBoundingClientRect();
              if (rect) setAddMenuRect(rect);
              setShowAdd(o => !o);
            }}
            title="Add object"
            className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-600 text-gray-400 hover:text-white transition-all text-sm leading-none">
            +
          </button>
        </div>

        {/* Fixed dropdown — escapes all overflow clipping */}
        {showAdd && addMenuRect && (
          <div ref={addMenuRef} style={{
            position: 'fixed',
            left: addMenuRect.left,
            top: addMenuRect.bottom + 4,
            zIndex: 9999,
          }} className="bg-gray-800 border border-gray-600 rounded shadow-xl py-1 min-w-32">
            <div className="px-3 py-1 text-[10px] text-gray-500 uppercase tracking-wider">Add Primitive</div>
            {PRIMITIVES.map(p => (
              <button key={p.shape} onClick={() => addPrimitive(p.shape)}
                className="w-full px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition-colors text-left">
                {p.label}
              </button>
            ))}
          </div>
        )}

        {items.map(item => (
          <div key={item.id} className="pl-3 pr-1">
            {renamingId === item.id ? (
              <input
                ref={inputRef}
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                className="w-full bg-gray-900 border border-blue-500 rounded px-2 py-1 text-xs text-white focus:outline-none"
              />
            ) : (
              <div className={`flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-colors group ${
                selectedId === item.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700/60 hover:text-gray-200'
              } ${item.locked ? 'opacity-50' : ''}`}>
                <button
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  onClick={() => !item.locked && onSelect(item.id)}
                  onContextMenu={e => openMenu(e, item)}>
                  <span className="opacity-50 text-sm flex-shrink-0">{typeIcon(item.type)}</span>
                  <span className={`truncate flex-1 ${!item.visible ? 'opacity-40 line-through' : ''}`}>
                    {item.name}
                  </span>
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onToggleLocked(item.id); }}
                  title={item.locked ? 'Unlock' : 'Lock'}
                  className={`flex-shrink-0 text-[11px] px-0.5 transition-opacity ${
                    item.locked ? 'opacity-100 text-orange-400' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-gray-500 hover:text-orange-300'}`}>
                  {item.locked ? '🔒' : '🔓'}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onToggleVisible(item.id); }}
                  title={item.visible ? 'Hide' : 'Show'}
                  className={`flex-shrink-0 text-[11px] px-0.5 transition-opacity ${
                    !item.visible ? 'opacity-100 text-gray-600' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 text-gray-400 hover:text-white'}`}>
                  {item.visible ? '👁' : '🚫'}
                </button>
              </div>
            )}
          </div>
        ))}

        {items.length === 0 && (
          <p className="text-xs text-gray-600 text-center py-6 px-2">No objects in scene.<br />Drag an asset or add a primitive.</p>
        )}

        <div className="flex-1 min-h-8" onContextMenu={e => openMenu(e)} />
      </div>

      {menu && (
        <div ref={menuRef}
          style={{ top: menu.y - 40, left: menu.x - 20, position: 'fixed', zIndex: 9999 }}
          className="bg-gray-800 border border-gray-600 rounded shadow-2xl py-1 min-w-36 text-xs">
          {menu.item ? (
            <>
              <div className="px-3 py-1.5 text-gray-500 border-b border-gray-700 truncate">{menu.item.name}</div>
              <button onClick={() => { onSelect(menu.item!.id); setMenu(null); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-700 text-gray-200 transition-colors">🎯 Select</button>
              <button onClick={() => { setRenamingId(menu.item!.id); setRenameVal(menu.item!.name); setMenu(null); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-700 text-gray-200 transition-colors">✏️ Rename</button>
              <button onClick={() => { onDuplicate(menu.item!.id); setMenu(null); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-700 text-gray-200 transition-colors">⎘ Duplicate</button>
              <button onClick={() => { onToggleVisible(menu.item!.id); setMenu(null); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-700 text-gray-200 transition-colors">
                {menu.item.visible ? '🚫 Hide' : '👁 Show'}
              </button>
              <button onClick={() => { onToggleLocked(menu.item!.id); setMenu(null); }}
                className="w-full text-left px-3 py-2 hover:bg-gray-700 text-gray-200 transition-colors">
                {menu.item.locked ? '🔓 Unlock' : '🔒 Lock'}
              </button>
              <div className="border-t border-gray-700 mt-1 pt-1" />
              <button onClick={() => { onDelete(menu.item!.id); setMenu(null); }}
                className="w-full text-left px-3 py-2 hover:bg-red-900 text-red-400 transition-colors">🗑 Delete</button>
            </>
          ) : (
            <>
              <div className="px-3 py-1.5 text-gray-500 border-b border-gray-700">Add Primitive</div>
              {PRIMITIVES.map(p => (
                <button key={p.shape} onClick={() => addPrimitive(p.shape)}
                  className="w-full px-3 py-2 text-gray-200 hover:bg-gray-700 transition-colors text-left">
                  {p.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
