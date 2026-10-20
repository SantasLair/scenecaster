import { useEffect, useState } from 'react';
import { readProjectImage } from '../sceneModel';

export interface ProjectImage {
  /** 'missing' when the file cannot be read. */
  state: 'none' | 'loading' | 'ready' | 'missing';
  src: string | null;
  size: { w: number; h: number } | null;
}

/** Loads an image of the open project (path relative to the project root) and its pixel size. */
export function useProjectImage(url: string | null | undefined): ProjectImage {
  const [img, setImg] = useState<ProjectImage>({ state: 'none', src: null, size: null });
  useEffect(() => {
    let cancelled = false;
    if (!url) { setImg({ state: 'none', src: null, size: null }); return; }
    setImg({ state: 'loading', src: null, size: null });
    void readProjectImage(url).then(data => {
      if (cancelled) return;
      if (!data) { setImg({ state: 'missing', src: null, size: null }); return; }
      const probe = new Image();
      probe.onload = () => { if (!cancelled) setImg({ state: 'ready', src: data, size: { w: probe.naturalWidth, h: probe.naturalHeight } }); };
      probe.onerror = () => { if (!cancelled) setImg({ state: 'missing', src: null, size: null }); };
      probe.src = data;
    });
    return () => { cancelled = true; };
  }, [url]);
  return img;
}
