import type { GameSummary } from './games';

const RESULT_SUFFIX: Record<'W' | 'L' | 'D', string> = { W: 'W', L: 'L', D: 'D' };

/** One dropdown, at the top of the page, that swaps the whole dashboard between the season and a single game — the BI-dashboard "scope" pattern, standard-combobox per the dataviz skill's filter guidance. */
export function ScopeSelect({
  games,
  value,
  onChange,
}: {
  games: readonly GameSummary[];
  value: string | null;
  onChange: (gameId: string | null) => void;
}) {
  if (games.length === 0) return null;

  return (
    <label className="scope-select">
      <span className="scope-select-label">Viewing</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Full season</option>
        {games.map((g) => (
          <option key={g.game.id} value={g.game.id}>
            {new Date(g.game.kickoff_at).toLocaleDateString()} · vs {g.game.opponent || 'TBD'} (
            {g.state.score.us}–{g.state.score.them}
            {g.result ? ` ${RESULT_SUFFIX[g.result]}` : ''})
          </option>
        ))}
      </select>
    </label>
  );
}
