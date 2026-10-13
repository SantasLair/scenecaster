import { create } from 'zustand';
import { PROP_DEFAULTS as DEFAULTS, type ObjectProps } from '../../shared/props';

export type { ObjectProps };

interface EditorState extends ObjectProps {
  selectedId: string | null;
  snapEnabled: boolean;
  texW: number;
  texH: number;
  setSelectedObject: (id: string | null, props?: Partial<ObjectProps>, texW?: number, texH?: number) => void;
  updateProperties: (props: Partial<ObjectProps>) => void;
  toggleSnap: () => void;
}

export const useEditorStore = create<EditorState>(set => ({
  selectedId: null,
  snapEnabled: false,
  texW: 0,
  texH: 0,
  ...DEFAULTS,

  setSelectedObject: (id, props, texW = 0, texH = 0) => {
    const next = { ...DEFAULTS, ...props };
    set({ selectedId: id, ...next, texW, texH });
  },

  updateProperties: (props) => set(props),

  toggleSnap: () => set(s => ({ snapEnabled: !s.snapEnabled })),

}));
