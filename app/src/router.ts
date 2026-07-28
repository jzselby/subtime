import { useEffect, useState } from 'react';

/**
 * Hash routing in ~30 lines. A five-screen app does not need a router library,
 * and hash routes mean the built app works from any static host — including
 * `file://` and a subdirectory — with no server rewrite rules.
 */

export type Route =
  | { name: 'home' }
  | { name: 'team'; teamId: string }
  | { name: 'season'; teamId: string }
  | { name: 'formation'; teamId: string }
  | { name: 'gameFormation'; gameId: string }
  | { name: 'setup'; gameId: string }
  | { name: 'live'; gameId: string }
  | { name: 'summary'; gameId: string }
  | { name: 'events'; gameId: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [head, id, tail] = parts;
  if (head === 'team' && id) {
    if (tail === 'formation') return { name: 'formation', teamId: id };
    if (tail === 'season') return { name: 'season', teamId: id };
    return { name: 'team', teamId: id };
  }
  if (head === 'game' && id) {
    if (tail === 'setup') return { name: 'setup', gameId: id };
    if (tail === 'formation') return { name: 'gameFormation', gameId: id };
    if (tail === 'summary') return { name: 'summary', gameId: id };
    if (tail === 'events') return { name: 'events', gameId: id };
    return { name: 'live', gameId: id };
  }
  return { name: 'home' };
}

export function hashFor(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'team':
      return `#/team/${route.teamId}`;
    case 'season':
      return `#/team/${route.teamId}/season`;
    case 'formation':
      return `#/team/${route.teamId}/formation`;
    case 'gameFormation':
      return `#/game/${route.gameId}/formation`;
    case 'setup':
      return `#/game/${route.gameId}/setup`;
    case 'live':
      return `#/game/${route.gameId}`;
    case 'summary':
      return `#/game/${route.gameId}/summary`;
    case 'events':
      return `#/game/${route.gameId}/events`;
  }
}

export function navigate(route: Route, replace = false): void {
  const hash = hashFor(route);
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
