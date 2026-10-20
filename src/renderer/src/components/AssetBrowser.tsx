import { useState, useEffect } from 'react';
import type React from 'react';
import { beginDrag, clamp } from '../beginDrag';
import { cleanSubfolder } from '../../../shared/assetImport';

type ViewMode = 'list' | 'grid-sm' | 'grid-lg';

const flatFiles = (entries: AssetEntry[]): AssetFile[] =>
  entries.flatMap(e => e.type === 'file' ? [e] : flatFiles(e.children));

interface Props {
  projectFolder: string | null;
  onOpenProject: () => void;
  onDragAsset: (file: AssetFile) => void;
  /** Copies files into the project folder `destRel` and registers them; resolves with the copied paths. */
  onImport: (sources: string[], destRel: string) => Promise<string[]>;
}

function FileThumb({ file, onDragAsset, viewMode }: {
  file: AssetFile; onDragAsset: (f: AssetFile) => void; viewMode: ViewMode;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.fileToDataUrl(file.fullPath).then(url => { if (!cancelled && url) setSrc(url); });
    return () => { cancelled = true; };
  }, [file.fullPath]);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/phaser-asset', JSON.stringify({ ...file, dataUrl: src ?? '' }));
    onDragAsset(file);
  };

  if (viewMode === 'list') {
    return (
      <div draggable onDragStart={handleDragStart} title={file.name}
        className="flex items-center gap-2 px-2 py-1 rounded cursor-grab hover:bg-gray-700 transition-colors group">
        <div className="w-6 h-6 flex-shrink-0 rounded overflow-hidden bg-gray-900 border border-gray-700 flex items-center justify-center">
          {src
            ? <img src={src} alt="" className="w-full h-full object-contain" />
            : <span className="text-gray-600 text-[8px]">{file.ext.replace('.', '')}</span>}
        </div>
        <span className="text-xs text-gray-300 truncate group-hover:text-white flex-1">{file.name}</span>
      </div>
    );
  }

  const isLarge = viewMode === 'grid-lg';
  const sz = isLarge ? 'w-20 h-20' : 'w-12 h-12';

  return (
    <div draggable onDragStart={handleDragStart} title={file.name}
      className="flex flex-col items-center gap-1 p-1.5 rounded cursor-grab hover:bg-gray-700 transition-colors group">
      <div className={`${sz} flex-shrink-0 rounded overflow-hidden bg-gray-900 border border-gray-700 flex items-center justify-center`}>
        {src
          ? <img src={src} alt="" className="w-full h-full object-contain" />
          : <span className="text-gray-600 text-[10px]">{file.ext.replace('.', '')}</span>}
      </div>
      <span className={`${isLarge ? 'text-[10px]' : 'text-[9px]'} text-gray-400 group-hover:text-white text-center leading-tight max-w-full`}
        style={{ wordBreak: 'break-all', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {file.name}
      </span>
    </div>
  );
}

function FolderNode({ folder, selectedPath, onSelect, depth }: {
  folder: AssetFolder; selectedPath: string | null;
  onSelect: (f: AssetFolder) => void; depth: number;
}) {
  const subFolders = folder.children.filter(c => c.type === 'folder') as AssetFolder[];
  const [open, setOpen] = useState(depth === 0);
  const isSelected = selectedPath === folder.path;

  return (
    <div>
      <button
        onClick={() => { onSelect(folder); if (subFolders.length > 0) setOpen(o => !o); }}
        className={`w-full flex items-center gap-1 py-1 pr-2 text-xs rounded transition-colors text-left truncate ${
          isSelected ? 'bg-blue-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {subFolders.length > 0
          ? <span className="text-[8px] w-3 flex-shrink-0">{open ? '▾' : '▸'}</span>
          : <span className="w-3 flex-shrink-0" />}
        <span className="flex-shrink-0">📁</span>
        <span className="truncate ml-1">{folder.name}</span>
      </button>
      {open && subFolders.map(sub => (
        <FolderNode key={sub.path} folder={sub} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function AssetBrowser({ projectFolder, onOpenProject, onDragAsset, onImport }: Props) {
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedFolder, setSelectedFolder] = useState<AssetFolder | null>(null);

  const [leftW, setLeftW] = useState(140);
  const [assetsDir, setAssetsDir] = useState('assets');
  const [subfolder, setSubfolder] = useState('');
  const [reload, setReload] = useState(0);
  const [overDrop, setOverDrop] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => { setSelectedFolder(null); }, [projectFolder]);

  useEffect(() => {
    if (!projectFolder) {
      setAssets([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void window.electronAPI.assetsInfo(projectFolder).then(info => { if (!cancelled && info) setAssetsDir(info.dir); });
    window.electronAPI.readAssets(projectFolder)
      .then(result => { if (!cancelled) setAssets(result); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectFolder, reload]);

  // Files added, removed or renamed outside the editor (a file manager, git, an AI) show up without a manual refresh.
  useEffect(() => window.electronAPI.onAssetsChanged(() => setReload(n => n + 1)), []);

  const startDivResize = (e: React.MouseEvent) => {
    const w0 = leftW;
    beginDrag(e, 'ew-resize', dx => setLeftW(clamp(w0 + dx, 80, 280)));
  };

  if (!projectFolder) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
      <div className="text-3xl opacity-20">📁</div>
      <p className="text-xs text-gray-500 text-center">No project open.<br />Open a Phaser project folder to browse assets.</p>
      <button onClick={onOpenProject}
        className="mt-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors">
        Open Project Folder
      </button>
    </div>
  );

  const folders = assets.filter(e => e.type === 'folder') as AssetFolder[];
  const isGrid = viewMode !== 'list';

  const activeEntries: AssetEntry[] = selectedFolder ? selectedFolder.children : assets;
  const activeFiles = activeEntries.filter(e => e.type === 'file') as AssetFile[];
  const activeFolders = activeEntries.filter(e => e.type === 'folder') as AssetFolder[];

  const searchResults = search.trim()
    ? flatFiles(assets).filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : null;

  // Imports go to the assets folder, plus the folder selected in the tree, plus an optional typed subfolder.
  const sub = cleanSubfolder(subfolder);
  const destRel = [assetsDir, selectedFolder?.path, sub].filter(Boolean).join('/');
  const runImport = async (sources: string[]) => {
    if (!sources.length || sub === null || importing) return;
    setImporting(true);
    try { if ((await onImport(sources, destRel)).length) setReload(n => n + 1); } finally { setImporting(false); }
  };
  const pick = async () => runImport(await window.electronAPI.pickAssets());
  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  const ViewBtn = ({ mode, icon, title }: { mode: ViewMode; icon: string; title: string }) => (
    <button onClick={() => setViewMode(mode)} title={title}
      className={`px-1.5 py-1 rounded text-xs transition-colors ${
        viewMode === mode ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-white'}`}>
      {icon}
    </button>
  );

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden min-w-0"
      onDragOver={e => { if (isFileDrag(e)) { e.preventDefault(); setOverDrop(true); } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOverDrop(false); }}
      onDrop={e => {
        if (!isFileDrag(e)) return;
        e.preventDefault(); setOverDrop(false);
        void runImport(Array.from(e.dataTransfer.files).map(f => window.electronAPI.pathForFile(f)).filter(Boolean));
      }}>
      {overDrop && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-blue-950/70 border-2 border-dashed border-blue-500 pointer-events-none">
          <span className="text-xs text-blue-200">Drop to import into {destRel}</span>
        </div>
      )}
      <div className="px-2 py-1 border-b border-gray-700 flex items-center gap-2 flex-shrink-0 text-[11px] text-gray-500">
        <button onClick={pick} disabled={importing || sub === null} title="Copy image, audio or data files into the project"
          className="px-2 py-0.5 rounded text-xs border border-gray-600 text-gray-200 hover:border-blue-500 hover:text-white disabled:opacity-40 flex-shrink-0">
          {importing ? 'Importing…' : 'Import…'}
        </button>
        <span className="truncate" title={destRel}>into {assetsDir}{selectedFolder ? `/${selectedFolder.path}` : ''}/</span>
        <input value={subfolder} onChange={e => setSubfolder(e.target.value)} placeholder="new subfolder (optional)" spellCheck={false}
          className={`w-40 min-w-0 bg-gray-900 border rounded px-1.5 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500 placeholder-gray-600 ${sub === null ? 'border-red-600' : 'border-gray-700'}`} />
        <span className="text-gray-600 hidden xl:inline">or drop files here</span>
      </div>
      <div className="px-2 py-1.5 border-b border-gray-700 flex items-center gap-2 flex-shrink-0">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search assets…"
          className="flex-1 min-w-0 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 placeholder-gray-600" />
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <ViewBtn mode="list" icon="☰" title="List" />
          <ViewBtn mode="grid-sm" icon="⊞" title="Small icons" />
          <ViewBtn mode="grid-lg" icon="⬛" title="Large icons" />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        <div className="flex-shrink-0 overflow-y-auto border-r border-gray-700 py-1"
          style={{ width: leftW }}>
          {loading
            ? <p className="text-xs text-gray-600 text-center py-4">Scanning…</p>
            : (
              <>
                <button
                  onClick={() => setSelectedFolder(null)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors text-left ${
                    !selectedFolder ? 'bg-blue-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                  <span>🗂</span>
                  <span className="truncate">All Assets</span>
                </button>
                {folders.map(f => (
                  <FolderNode key={f.path} folder={f} selectedPath={selectedFolder?.path ?? null}
                    onSelect={setSelectedFolder} depth={0} />
                ))}
              </>
            )}
        </div>

        <div onMouseDown={startDivResize}
          className="w-1 flex-shrink-0 cursor-ew-resize hover:bg-blue-500 transition-colors bg-transparent group">
          <div className="w-px h-full mx-auto bg-gray-700 group-hover:bg-blue-500 transition-colors" />
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 min-w-0">
          {loading && <p className="text-xs text-gray-600 text-center py-4">Scanning…</p>}

          {searchResults ? (
            <div className={isGrid ? 'flex flex-wrap gap-1' : ''}>
              {searchResults.length === 0
                ? <p className="text-xs text-gray-600 text-center py-4">No results.</p>
                : searchResults.map(f => <FileThumb key={f.path} file={f} onDragAsset={onDragAsset} viewMode={viewMode} />)}
            </div>
          ) : (
            <>
              {activeFolders.length > 0 && (
                <div className={`mb-1 ${isGrid ? 'flex flex-wrap gap-1' : ''}`}>
                  {activeFolders.map(f => (
                    <button key={f.path} onClick={() => setSelectedFolder(f)}
                      className={`${isGrid
                        ? 'flex flex-col items-center gap-1 p-1.5 rounded hover:bg-gray-700 transition-colors'
                        : 'w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-700 transition-colors'}`}>
                      <span className={isGrid ? 'text-2xl' : 'text-sm'}>📁</span>
                      <span className="text-xs text-gray-400 truncate">{f.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {activeFiles.length === 0 && activeFolders.length === 0 && !loading && (
                <p className="text-xs text-gray-600 text-center py-4">No images here.</p>
              )}
              <div className={isGrid ? 'flex flex-wrap gap-1' : ''}>
                {activeFiles.map(f => (
                  <FileThumb key={f.path} file={f} onDragAsset={onDragAsset} viewMode={viewMode} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
