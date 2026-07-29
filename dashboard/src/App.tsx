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
  const record = teamRecord(games);
  const selected = gameId ? games.find((g) => g.game.id === gameId) : undefined;

  return (
    <Page>
      <h1>{team.name}</h1>
      <p className="muted">
        {team.age_group ? `${team.age_group} · ` : ''}
        {games.length} game{games.length === 1 ? '' : 's'} this season
      </p>
      <ScopeSelect games={games} value={gameId} onChange={setGameId} />
      {selected ? (
        <GameView summary={selected} players={snapshot.players} onBack={() => setGameId(null)} />
      ) : (
        <SeasonView
          snapshot={snapshot}
          games={games}
          record={record}
          onSelectGame={(id) => setGameId(id)}
        />
      )}
    </Page>
  );
}
