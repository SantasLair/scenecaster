// Godot editor icons (CC BY 4.0, see THIRD_PARTY.md), copied into src/renderer/src/icons and recoloured to currentColor.
const files = import.meta.glob('../icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const icons: Record<string, string> = {};
for (const [path, svg] of Object.entries(files)) {
  const name = path.slice(path.lastIndexOf('/') + 1, -'.svg'.length);
  icons[name] = svg.replace(/fill="#(?:e0e0e0|fff)"/g, 'fill="currentColor"');
}

export type IconName =
  | 'ToolSelect' | 'ToolMove' | 'ToolRotate' | 'ToolScale' | 'Play' | 'Stop' | 'Save' | 'Snap' | 'Reload' | 'Folder'
  | 'GuiClose' | 'Environment' | 'Window' | 'Lock' | 'Unlock' | 'GuiVisibilityVisible' | 'GuiVisibilityHidden' | 'UndoRedo' | 'Script';

/** A 16px Godot icon that takes the text colour. The SVG text comes from our own bundled files, never from user data. */
export default function Icon({ name, size = 16, flipX }: { name: IconName; size?: number; flipX?: boolean }) {
  return (
    <span aria-hidden className="inline-flex flex-shrink-0 [&>svg]:w-full [&>svg]:h-full" style={{ width: size, height: size, transform: flipX ? 'scaleX(-1)' : undefined }}
      dangerouslySetInnerHTML={{ __html: icons[name] ?? '' }} />
  );
}
