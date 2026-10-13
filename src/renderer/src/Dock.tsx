import { createContext, useContext, useCallback } from 'react';
import type React from 'react';
import { DockviewReact, themeAbyss, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

/** Everything the panels need from App, passed by context (dockview renders panels as portals inside our tree). */
export interface DockCtx {
  objects: React.ReactNode;
  assets: React.ReactNode;
  inspector: React.ReactNode;
  console: React.ReactNode;
  problems: React.ReactNode;
  viewport: React.ReactNode;
}

export const DockContext = createContext<DockCtx | null>(null);

const LAYOUT_KEY = 'scenecaster.layout.v2';

function slot(key: keyof DockCtx) {
  return function Slot(_: IDockviewPanelProps) {
    const ctx = useContext(DockContext);
    return <div className="h-full w-full overflow-auto bg-gray-900">{ctx?.[key]}</div>;
  };
}

// The viewport hosts an iframe: no scrolling, and it must fill the panel.
function ViewportSlot(_: IDockviewPanelProps) {
  const ctx = useContext(DockContext);
  return <div className="relative h-full w-full overflow-hidden bg-[#1e1e1e]">{ctx?.viewport}</div>;
}

const components = {
  objects: slot('objects'),
  assets: slot('assets'),
  inspector: slot('inspector'),
  console: slot('console'),
  problems: slot('problems'),
  viewport: ViewportSlot,
};

export function buildDefaultLayout(api: DockviewApi) {
  api.clear();
  const vp = api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });
  api.addPanel({ id: 'objects', component: 'objects', title: 'Objects',
    position: { referencePanel: vp, direction: 'left' }, initialWidth: 220 });
  api.addPanel({ id: 'inspector', component: 'inspector', title: 'Inspector',
    position: { referencePanel: vp, direction: 'right' }, initialWidth: 270 });
  const assets = api.addPanel({ id: 'assets', component: 'assets', title: 'Assets',
    position: { referencePanel: vp, direction: 'below' }, initialHeight: 200 });
  api.addPanel({ id: 'console', component: 'console', title: 'Console', position: { referencePanel: assets } });
  api.addPanel({ id: 'problems', component: 'problems', title: 'Problems', position: { referencePanel: assets } });
  assets.api.setActive();
}

export function resetLayout(api: DockviewApi | null) {
  try { localStorage.removeItem(LAYOUT_KEY); } catch { /* storage unavailable */ }
  if (api) buildDefaultLayout(api);
}

export default function Dock({ onApi }: { onApi: (api: DockviewApi) => void }) {
  const onReady = useCallback((e: DockviewReadyEvent) => {
    const api = e.api;
    let restored = false;
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) { api.fromJSON(JSON.parse(saved)); restored = api.panels.length === Object.keys(components).length; }
    } catch { restored = false; }
    if (!restored) buildDefaultLayout(api);
    api.onDidLayoutChange(() => {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON())); } catch { /* ignore */ }
    });
    onApi(api);
  }, [onApi]);

  return <DockviewReact className="sc-dock" theme={themeAbyss} components={components} onReady={onReady} />;
}
