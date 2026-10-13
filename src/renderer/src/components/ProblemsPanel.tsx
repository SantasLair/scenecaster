import { useState } from 'react';
import type { SceneProblem } from '../../../shared/scene';

/** The load-time validation report for the scene file: errors (things skipped) and warnings. */
export default function ProblemsPanel({ problems }: { problems: SceneProblem[] }) {
  const [open, setOpen] = useState(true);
  if (problems.length === 0) return null;
  const errors = problems.filter(p => p.level === 'error').length;
  return (
    <div className="absolute top-3 right-3 z-20 max-w-sm text-xs bg-gray-900/95 border border-yellow-700 rounded shadow-lg">
      <button onClick={() => setOpen(o => !o)} className="w-full px-3 py-1.5 flex items-center gap-2 text-yellow-400 text-left">
        <span>⚠</span>
        <span className="flex-1">
          Scene file: {errors > 0 ? `${errors} error${errors !== 1 ? 's' : ''}, ` : ''}{problems.length - errors} warning{problems.length - errors !== 1 ? 's' : ''}
        </span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul className="max-h-60 overflow-y-auto px-3 pb-2 space-y-1 select-text">
          {problems.map((p, i) => (
            <li key={i} className={p.level === 'error' ? 'text-red-400' : 'text-gray-300'}>
              {p.level === 'error' ? '✖ ' : '• '}{p.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
