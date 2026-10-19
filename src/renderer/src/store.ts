import { create } from 'zustand';

/** Editor session state that is not part of the scene: the selection and the snap toggle. */
interface EditorState {
  selectedId: string | null;
  snapEnabled: boolean;
  setSelected: (id: string | null) => void;
  toggleSnap: () => void;
}

export const useEditorStore = create<EditorState>(set => ({
  selectedId: null,
  snapEnabled: false,
  setSelected: id => set({ selectedId: id }),
  toggleSnap: () => set(s => ({ snapEnabled: !s.snapEnabled })),
}));
