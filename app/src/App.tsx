import { useEffect } from 'react';
import { InstallBanner, UpdateChip } from './components';
import { requestPersistence } from './db';
import type { Route } from './router';
import { useRoute } from './router';
import { FormationScreen } from './screens/Formation';
import { HomeScreen } from './screens/Home';
import { LiveScreen } from './screens/Live';
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

  return (
    <>
      {screenFor(route)}
      {/* Both render nothing unless they have something to say, and both sit
          above the screen rather than inside it so no screen has to know.
          The banner is pinned to the bottom, which is where Setup, Formation
          and Summary put their primary action — so it is confined to the home
          screen, the one place with room for it and the first place you land. */}
      <UpdateChip />
      {route.name === 'home' && <InstallBanner />}
    </>
  );
}

function screenFor(route: Route) {
  switch (route.name) {
    case 'team':
      return <TeamScreen key={route.teamId} teamId={route.teamId} />;
    case 'formation':
      return <FormationScreen key={route.teamId} teamId={route.teamId} />;
    case 'setup':
      return <SetupScreen key={route.gameId} gameId={route.gameId} />;
    case 'live':
      return <LiveScreen key={route.gameId} gameId={route.gameId} />;
    case 'summary':
      return <SummaryScreen key={route.gameId} gameId={route.gameId} />;
    default:
      return <HomeScreen />;
  }
}
