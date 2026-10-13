import type { SceneProblem } from '../../../shared/scene';

/** The load-time validation report for the scene file: errors (things skipped) and warnings. */
export default function ProblemsPanel({ problems }: { problems: SceneProblem[] }) {
  return (
    <ul className="px-3 py-2 space-y-1 text-xs select-text">
      {problems.map((p, i) => (
        <li key={i} className={p.level === 'error' ? 'text-red-400' : 'text-yellow-300'}>
          {p.level === 'error' ? '✖ ' : '⚠ '}{p.message}
        </li>
      ))}
    </ul>
  );
}
