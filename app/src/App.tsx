import { useEffect, useState } from 'react';
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
      <AppScreen route={route} />
    </>
  );
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
