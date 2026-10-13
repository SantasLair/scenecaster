import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../store';
import { InspectorField, PresetButton } from './Controls';
import {
  PROPS, PROP_KEYS, describe, normalizeEdit, pickProps, round2,
  type ObjectProps, type PropKey, type PropSection,
} from '../../../shared/props';

type OnEdit = (p: Partial<ObjectProps>, commit?: boolean) => void;

const ORIGIN_PRESETS = [
  { l: 'TL', x: 0, y: 0 }, { l: 'TC', x: 0.5, y: 0 }, { l: 'TR', x: 1, y: 0 },
  { l: 'CL', x: 0, y: 0.5 }, { l: 'C', x: 0.5, y: 0.5 }, { l: 'CR', x: 1, y: 0.5 },
  { l: 'BL', x: 0, y: 1 }, { l: 'BC', x: 0.5, y: 1 }, { l: 'BR', x: 1, y: 1 },
];
const SCROLL_PRESETS = [{ l: 'UI (0)', v: 0 }, { l: 'World (1)', v: 1 }];

/** Table keys grouped by `ui.section`, in table order. */
const SECTIONS: [PropSection, PropKey[]][] = (() => {
  const map = new Map<PropSection, PropKey[]>();
  for (const k of PROP_KEYS) {
    const s = PROPS[k].ui.section;
    map.set(s, [...(map.get(s) ?? []), k]);
  }
  return [...map];
})();

/** Hand-written additions rendered under a section's fields. */
const SECTION_EXTRAS: Partial<Record<PropSection, (p: ObjectProps, onEdit: OnEdit) => ReactNode>> = {
  'Rotation': p => (
    <div className="text-[10px] text-gray-600 text-right -mt-1">{Math.round((p.rotation * 180) / Math.PI)}°</div>
  ),
  'Depth (Z-order)': () => (
    <div className="text-[10px] text-gray-600 -mt-1">Higher = rendered on top</div>
  ),
  'Origin (Pivot)': (p, onEdit) => (
    <>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {ORIGIN_PRESETS.map(o => (
          <PresetButton key={o.l} label={o.l} className="px-1.5 py-0.5 text-[9px]"
            active={p.originX === o.x && p.originY === o.y}
            onClick={() => onEdit({ originX: o.x, originY: o.y }, true)} />
        ))}
      </div>
      <div className="text-[10px] text-gray-600 mt-1">Affects where x/y anchors on the sprite</div>
    </>
  ),
  'Scroll Factor': (p, onEdit) => (
    <>
      <div className="flex gap-2 mt-1.5">
        {SCROLL_PRESETS.map(o => (
          <PresetButton key={o.l} label={o.l} className="flex-1 py-1 text-[10px]"
            active={p.scrollFactorX === o.v && p.scrollFactorY === o.v}
            onClick={() => onEdit({ scrollFactorX: o.v, scrollFactorY: o.v }, true)} />
        ))}
      </div>
      <div className="text-[10px] text-gray-600 mt-1">0 = fixed to camera (UI), 1 = moves with world</div>
    </>
  ),
};

/** Design-mode inspector, driven by the property table in src/shared/props.ts. */
export default function Inspector({ selectedId, onEdit, onDelete }: {
  selectedId: string;
  onEdit: OnEdit;
  onDelete: (id: string) => void;
}) {
  const props = useEditorStore(useShallow(pickProps));
  const { texW, texH } = useEditorStore(useShallow(s => ({ texW: s.texW, texH: s.texH })));
  const commit = useEditorStore.getState().commit;

  const field = (k: PropKey) => {
    const { kind, ui } = describe(k);
    const value = props[k];
    if (ui.control === 'toggle') {
      return (
        <PresetButton key={k} label={ui.label} active={value as boolean} className="flex-1 py-1.5 text-xs font-medium"
          onClick={() => onEdit({ [k]: !value } as Partial<ObjectProps>, true)} />
      );
    }
    return (
      <InspectorField key={k} label={ui.label} value={value}
        type={kind === 'boolean' ? 'checkbox' : kind === 'color' ? 'color' : 'number'}
        min={ui.min} max={ui.max} step={ui.step}
        onChange={v => onEdit({ [k]: normalizeEdit(k, v) } as Partial<ObjectProps>)} onCommit={commit} />
    );
  };

  return (
    <div className="p-3 space-y-4 text-sm">
      <div className="bg-gray-900 rounded px-3 py-2">
        <div className="text-[10px] text-gray-500 mb-0.5">ID</div>
        <div className="text-xs text-white font-mono truncate">{selectedId}</div>
      </div>
      {SECTIONS.map(([section, keys]) => (
        <section key={section}>
          <div className="section-label mb-2">{section}</div>
          {keys.every(k => describe(k).ui.control === 'toggle')
            ? <div className="flex gap-2">{keys.map(field)}</div>
            : keys.map(field)}
          {SECTION_EXTRAS[section]?.(props, onEdit)}
        </section>
      ))}
      {texW > 0 && (
        <section>
          <div className="section-label mb-2">Display Size</div>
          <InspectorField label="Width (px)" value={round2(props.scaleX * texW)} step={1} min={1}
            onChange={v => onEdit({ scaleX: round2(v / texW) })} onCommit={commit} />
          <InspectorField label="Height (px)" value={round2(props.scaleY * texH)} step={1} min={1}
            onChange={v => onEdit({ scaleY: round2(v / texH) })} onCommit={commit} />
          <div className="text-[10px] text-gray-600 mt-1">Native: {texW}×{texH}px — edits scale</div>
        </section>
      )}
      <button onClick={() => onDelete(selectedId)}
        className="w-full py-2 rounded text-xs text-red-400 border border-red-900 hover:bg-red-900/30 transition-colors">
        🗑 Delete Object
      </button>
    </div>
  );
}
