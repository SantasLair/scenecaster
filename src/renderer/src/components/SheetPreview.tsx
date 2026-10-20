import type { PfAsset } from '../../../shared/phaseform/types';
import { sheetFrames, sheetSpec } from '../../../shared/phaseform/sheet';
import { useProjectImage } from '../hooks/useProjectImage';

interface Props {
  asset: PfAsset;
  /** The frame to highlight. */
  selected?: number;
  /** Makes the frames clickable. */
  onPick?: (index: number) => void;
  /** Longest side of the preview in CSS pixels. */
  maxSize?: number;
}

/** An asset's image with its frame grid drawn over it, so the frame size, margin and spacing can be checked by eye. */
export default function SheetPreview({ asset, selected, onPick, maxSize = 240 }: Props) {
  const url = typeof asset.url === 'string' ? asset.url : null;
  const { state, src, size } = useProjectImage(url);

  if (!url) return null;
  if (state === 'missing') return <div className="text-[10px] text-red-400">Image file not found: {url}</div>;
  if (state !== 'ready' || !src || !size) return <div className="text-[10px] text-gray-600">Loading preview…</div>;

  const spec = asset.type === 'spritesheet' ? sheetSpec(asset) : null;
  const frames = spec ? sheetFrames(size.w, size.h, spec) : [];
  // Fit the image into maxSize; small sheets are enlarged up to 4x so a 16px frame can be clicked.
  const scale = Math.min(maxSize / size.w, maxSize / size.h, 4);

  return (
    <div>
      <div className="relative inline-block border border-gray-700 bg-gray-950 leading-none" style={{ width: size.w * scale, height: size.h * scale }}>
        <img src={src} alt="" draggable={false}
          className="block w-full h-full" style={{ imageRendering: 'pixelated' }} />
        {frames.map(f => (
          <div key={f.index} title={`Frame ${f.index}`} onClick={onPick ? () => onPick(f.index) : undefined}
            className={`absolute border ${f.index === selected ? 'border-blue-400 bg-blue-500/30' : 'border-white/25'} ${onPick ? 'cursor-pointer hover:bg-white/15' : ''}`}
            style={{ left: f.x * scale, top: f.y * scale, width: f.w * scale, height: f.h * scale }}>
            {f.w * scale >= 22 && <span className="absolute left-0.5 top-0 text-[9px] text-white/70 select-none">{f.index}</span>}
          </div>
        ))}
      </div>
      <div className="text-[10px] text-gray-500 mt-1">
        {size.w}×{size.h}px{spec ? (frames.length ? `, ${frames.length} frames` : ', the frame size does not fit the image') : ''}
      </div>
    </div>
  );
}
