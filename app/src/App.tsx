import type { ReactNode } from 'react';
import { Component, useEffect, useState } from 'react';
import { saveBackup } from './backup';
import { requestPersistence } from './db';
import { useRoute } from './router';
import { EventsScreen } from './screens/Events';
import { FormationScreen } from './screens/Formation';
import { HomeScreen } from './screens/Home';
import { LiveScreen } from './screens/Live';
import { SeasonScreen } from './screens/Season';
import { SetupScreen } from './screens/Setup';
import { SummaryScreen } from './screens/Summary';
import { TeamScreen } from './screens/Team';

export function App() {
  const route = useRoute();

  useEffect(() => {
    // Ask once, early. Safari evicts an unvisited site's storage after about a
    // week, and for this app that means losing a season.
    void requestPersistence();
  }, []);

  useEffect(() => {
    // Best-effort hard lock: works on Android Chrome once installed
    // (standalone display mode), where it stops the OS rotating the layout
    // viewport at all. Neither iOS nor a plain browser tab implements it —
    // `lock` is missing from TS's DOM lib for the same reason, which only
    // models the read side of ScreenOrientation — so this is paired with the
    // CSS `.landscape-guard` below, which works everywhere regardless. Belt,
    // then braces.
    const orientation = screen.orientation as { lock?: (o: string) => Promise<void> } | undefined;
    orientation?.lock?.('portrait').catch(() => {
      // Unsupported, or not running fullscreen/standalone — the CSS guard covers it.
    });
  }, []);

  return (
    <>
      <LandscapeGuard />
      {/* Keyed by route so leaving the crashed screen clears the error. */}
      <CrashScreen key={JSON.stringify(route)}>
        <AppScreen route={route} />
      </CrashScreen>
    </>
  );
}

/**
 * Without this, one bad render anywhere is a blank screen with no way out —
 * and no way to reach data that exists nowhere else. The backup button
 * reads IndexedDB directly, so it works however broken the React tree is.
 */
class CrashScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app">
        <header className="top">
          <h1>Something went wrong</h1>
        </header>
        <main style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <p>Your games are still saved on this phone. Reloading usually fixes this.</p>
          <button className="btn primary block" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            className="btn block"
            onClick={() => {
              location.hash = '';
              location.reload();
            }}
          >
            Go to the home screen
          </button>
          <button className="btn block" onClick={() => void saveBackup()}>
            Save a backup of my data
          </button>
          <p className="small muted" style={{ wordBreak: 'break-word' }}>
            {error.message}
          </p>
        </main>
      </div>
    );
  }
}

/**
 * The CSS `@media (orientation: landscape)` rule does the actual work — it
 * covers the screen the instant the device turns, with no JS round-trip in
 * the way. This only decides whether the guard's *text* exists in the DOM
 * at all, via the same query read through `matchMedia`.
 *
 * A first version left the text permanently in the DOM, just hidden with
 * `display: none`, and phrased it to dodge one collision with a Playwright
 * `text=` selector elsewhere in the suite — then hit a second, unrelated
 * one immediately after (case-insensitive substring matching finds a
 * hidden paragraph as readily as a visible one). Not rendering the text
 * outside landscape at all closes off that whole category of collision
 * rather than continuing to dodge specific words.
 */
function LandscapeGuard() {
  const [landscape, setLandscape] = useState(
    () => window.matchMedia('(orientation: landscape)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const update = () => setLandscape(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return (
    <div className="landscape-guard">
      {landscape && (
        <>
          <p>Turn your phone back to portrait.</p>
          <p className="small muted">Built for one-handed use on the sideline.</p>
        </>
      )}
    </div>
  );
}

function AppScreen({ route }: { route: ReturnType<typeof useRoute> }) {
  switch (route.name) {
    case 'team':
      return <TeamScreen key={route.teamId} teamId={route.teamId} />;
    case 'season':
      return <SeasonScreen key={route.teamId} teamId={route.teamId} />;
    case 'formation':
      return <FormationScreen key={route.teamId} teamId={route.teamId} />;
    case 'gameFormation':
      return <FormationScreen key={route.gameId} gameId={route.gameId} />;
    case 'setup':
      return <SetupScreen key={route.gameId} gameId={route.gameId} />;
    case 'live':
      return <LiveScreen key={route.gameId} gameId={route.gameId} />;
    case 'summary':
      return <SummaryScreen key={route.gameId} gameId={route.gameId} />;
    case 'events':
      return <EventsScreen key={route.gameId} gameId={route.gameId} />;
    default:
      return <HomeScreen />;
  }
}
