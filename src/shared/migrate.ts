// Text for scenecaster/MIGRATE.md (instructions an AI follows to make a game load its scenes from PHASEFORM files) and the
// one-line pointer for CLAUDE.md / AGENTS.md. Pure; the editor writes the first file and only shows the second.
import type { SceneRow } from './sceneRegistry';
import type { PfProject } from './phaseform/types';

export const MIGRATE_FILE = 'MIGRATE.md';

export const CLAUDE_POINTER =
  'Scenes and assets are PHASEFORM files (phaseform.project.json, *.phaseform.json), edited in Scenecaster. Keep them in sync when you change scenes, assets or settings, run `npx phaseform-cli validate` afterwards, and load scenes through `phaseform-loader` (read scenecaster/MIGRATE.md).';

interface MigrateInput {
  project: PfProject;
  rows: SceneRow[];
  loads: { method: string; key: string | null; url: string | null; path: string; line: number; dynamic: boolean }[];
  configPath: string | null;
}

export function migrateText({ project, rows, loads, configPath }: MigrateInput): string {
  const known = new Set(project.assets.map(a => a.key));
  const literalLoads = loads.filter(l => !l.dynamic && l.key && !known.has(l.key));
  const dynamicLoads = loads.filter(l => l.dynamic);
  const lines: string[] = [
    `# Adopting ${project.name} into PHASEFORM`,
    '',
    'Written by Scenecaster. You (an AI assistant) are asked to make this game load its scenes and assets from PHASEFORM files, so the human can edit layouts visually. Keep game behaviour identical. Run the game or its tests when done.',
    '',
    '## Rules',
    '',
    '- Only literal placements move into scene files. Leave computed or procedural positions in code and say so in your final message.',
    '- Do not edit the files in `scenecaster/` or hand-write layouts the human is editing; scene files follow the PHASEFORM schema.',
    '- If this project forbids Phaser in its core layer, put scene-reading code in the adapter layer (check `CLAUDE.md`).',
    '- Phaser 4 only. Stop and report if the game is on Phaser 3.',
    '',
    '## Steps',
    '',
    '1. Add `phaseform-loader` (and `phaseform-vite-plugin` if the game uses Vite) as dependencies.',
    `2. \`phaseform.project.json\` already lists the scenes below. Check its canvas size and entry scene against ${configPath ? `\`${configPath}\`` : 'the game config'}.`,
    '3. Make each scene class build its objects from its scene file through `phaseform-loader` instead of creating them by hand.',
    '4. Move asset loads into the manifest (`assets` in `phaseform.project.json`) and load them from there.',
    '5. Add a dev shortcut: the game reads `?scene=<key>` (development only) and starts in that scene.',
    '6. Run `npx phaseform-cli validate`, then reopen the project in Scenecaster: the Drift section should be clean.',
    '',
    '## Scenes',
    '',
  ];
  if (rows.length === 0) lines.push('No scenes found.');
  for (const r of rows) {
    const where = r.cls ? `class \`${r.cls.className}\` (${r.cls.path}:${r.cls.line})` : 'no scene class found';
    const action = r.state === 'layout+code' ? 'Load its layout in the class.'
      : r.state === 'code-only' ? 'Extract its literal placements into a new scene file, or leave it in code.'
      : 'Create or find the scene class that should use this layout.';
    lines.push(`- \`${r.key ?? '(computed key)'}\`: ${r.state}; ${where}${r.path ? `; layout \`${r.path}\`` : ''}. ${action}`);
  }
  lines.push('', '## Assets loaded in code but missing from the manifest', '');
  if (literalLoads.length === 0) lines.push('None found.');
  for (const l of literalLoads) lines.push(`- ${l.path}:${l.line} \`${l.method}\` "${l.key}" (${l.url})`);
  if (dynamicLoads.length > 0) {
    lines.push('', `${dynamicLoads.length} load${dynamicLoads.length > 1 ? 's use' : ' uses'} computed keys or files and could not be read; check these by hand:`, '');
    for (const l of dynamicLoads) lines.push(`- ${l.path}:${l.line} \`${l.method}\``);
  }
  lines.push('', '## Pointer for CLAUDE.md or AGENTS.md', '', 'Add this line (Scenecaster never edits these files):', '', `> ${CLAUDE_POINTER}`, '');
  return lines.join('\n');
}
