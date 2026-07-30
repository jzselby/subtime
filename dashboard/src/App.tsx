import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { foldGames, teamRecord } from './games';
import { GameView } from './GameView';
import { ScopeSelect } from './ScopeSelect';
import { SeasonView } from './SeasonView';
import { useDashboard } from './useDashboard';

function useUrlParams(): URLSearchParams {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

/** Which game (if any) is selected, kept in sync with `?g=` so a drill-down is a shareable, back-button-able URL. */
function useGameId(): [string | null, (id: string | null) => void] {
  const [gameId, setGameId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('g'),
  );

  useEffect(() => {
    const onPop = () => setGameId(new URLSearchParams(window.location.search).get('g'));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('g', id);
    else url.searchParams.delete('g');
    window.history.pushState({}, '', url);
    setGameId(id);
  };

  return [gameId, navigate];
}

const TAG_LABELS: Record<string, string> = {
  fall: 'Fall season',
  spring: 'Spring season',
  tournament: 'Tournament',
  scrimmage: 'Scrimmage',
};

/** Same dropdown-at-the-top shape as ScopeSelect, sitting above it — narrows
 *  which games ScopeSelect and the season view even see. */
function TagFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (tag: string | null) => void;
}) {
  return (
    <label className="scope-select">
      <span className="scope-select-label">Filter</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">All games</option>
        {Object.entries(TAG_LABELS).map(([tag, label]) => (
          <option key={tag} value={tag}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="page">
      <div className="topbar">
        <span className="brand">Pitchside · Coaches Dashboard</span>
      </div>
      {children}
    </div>
  );
}

export function App() {
  const token = useUrlParams().get('t');
  const result = useDashboard(token);
  const [gameId, setGameId] = useGameId();
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  if (result.status === 'not-configured') {
    return (
      <Page>
        <div className="empty">
          This dashboard isn't configured — it's missing its Supabase URL/key
          at build time.
        </div>
      </Page>
    );
  }
  if (result.status === 'no-token') {
    return (
      <Page>
        <div className="empty">
          This link is missing its token. Ask the coach for the link from
          Team settings → Coaches dashboard.
        </div>
      </Page>
    );
  }
  if (result.status === 'loading') {
    return (
      <Page>
        <p className="muted">Loading…</p>
      </Page>
    );
  }
  if (result.status === 'error') {
    return (
      <Page>
        <div className="empty">
          Couldn't load this dashboard — the link may be wrong, or the coach
          may have turned it off. ({result.message})
        </div>
      </Page>
    );
  }

  const { snapshot } = result;
  const { team } = snapshot;
  const games = foldGames(snapshot);
  const filteredGames = tagFilter ? games.filter((g) => g.game.tag === tagFilter) : games;
  const record = teamRecord(filteredGames);
  // Looked up against the full list, not the filtered one, so a direct link
  // to a specific game still opens it even if a filter is active.
  const selected = gameId ? games.find((g) => g.game.id === gameId) : undefined;

  return (
    <Page>
      <h1>{team.name}</h1>
      <p className="muted">
        {team.age_group ? `${team.age_group} · ` : ''}
        {filteredGames.length} game{filteredGames.length === 1 ? '' : 's'}
        {tagFilter ? '' : ' this season'}
      </p>
      <TagFilter
        value={tagFilter}
        onChange={(tag) => {
          setTagFilter(tag);
          // A filter change can leave the currently open game out of view —
          // back out to the (now filtered) season list rather than showing a
          // game that no longer matches what's selected above it.
          setGameId(null);
        }}
      />
      <ScopeSelect games={filteredGames} value={gameId} onChange={setGameId} />
      {selected ? (
        <GameView summary={selected} players={snapshot.players} onBack={() => setGameId(null)} />
      ) : (
        <SeasonView
          snapshot={snapshot}
          games={filteredGames}
          record={record}
          onSelectGame={(id) => setGameId(id)}
        />
      )}
    </Page>
  );
}
