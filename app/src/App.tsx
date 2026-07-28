import { useEffect } from 'react';
import { requestPersistence } from './db';
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
