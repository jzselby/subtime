import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Scoreboard } from './Scoreboard';
import './styles.css';

// `?p=` (a parent scoreboard link) and `?t=` (a coach dashboard link) are
// mutually exclusive tokens against two different, differently-scoped RPCs.
// Routed here so a `?p=` link only ever renders Scoreboard, which only ever
// calls get_team_scoreboard — App and its full get_team_dashboard call
// never run for it.
const params = new URLSearchParams(window.location.search);
const parentToken = params.get('p');

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>{parentToken ? <Scoreboard token={parentToken} /> : <App />}</StrictMode>,
  );
}
