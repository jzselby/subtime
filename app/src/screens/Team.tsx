import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { minutesOf, Screen, Sheet } from '../components';
import {
  createGame,
  db,
  deleteTeam,
  GAME_TAG_LABELS,
  playerHistory,
  removePlayer,
  restorePlayer,
  uid,
  type GameTag,
  type Player,
  type Team,
} from '../db';
import { LogPastGameSheet } from './LogPastGame';
import { navigate } from '../router';
import {
  dashboardConfigured,
  dashboardUrl,
  disableDashboard,
  enableDashboard,
  publishNow,
  scoreboardUrl,
} from '../sync';

export function TeamScreen({ teamId }: { teamId: string }) {
  const team = useLiveQuery(() => db.teams.get(teamId), [teamId]);
  const players = useLiveQuery(
    () => db.players.where('teamId').equals(teamId).toArray(),
    [teamId],
  );
  const games = useLiveQuery(
    () => db.games.where('teamId').equals(teamId).reverse().sortBy('kickoffAt'),
    [teamId],
  );

  const [sheet, setSheet] = useState<'player' | 'game' | 'pastGame' | 'settings' | null>(null);
  const [editing, setEditing] = useState<Player | null>(null);

  if (!team) return <Screen title="Loading…">{null}</Screen>;

  const byNumber = (a: Player, b: Player) =>
    (Number(a.number) || 999) - (Number(b.number) || 999) || a.name.localeCompare(b.name);
  const roster = (players ?? []).filter((p) => p.active !== 0).sort(byNumber);
  const retired = (players ?? []).filter((p) => p.active === 0).sort(byNumber);

  /*
   * Removing a player is two different operations wearing one button, and which
   * one it is depends on whether they have played. The confirm says which, so
   * "Remove" never silently means something other than what was expected.
   */
  const remove = async (player: Player) => {
    const { games, onFieldNow } = await playerHistory(player);
    if (onFieldNow) {
      alert(`${player.name} is on the field in a game in progress. Sub them off first.`);
      return;
    }
    const message =
      games === 0
        ? `Remove ${player.name}? They have not played a game, so nothing is recorded against them.`
        : `${player.name} has played ${games} game${games === 1 ? '' : 's'}.\n\n` +
          'They will be retired: taken off the roster and out of future team sheets, ' +
          'but still named in every game they played. You can restore them later.';
    if (!confirm(message)) return;
    await removePlayer(player);
  };

  return (
    <Screen
      title={team.name}
      subtitle={team.ageGroup || undefined}
      onBack={() => navigate({ name: 'home' })}
      action={
        <button className="btn ghost" onClick={() => setSheet('settings')}>
          Settings
        </button>
      }
    >
      <div className="row spread">
        <h2 style={{ margin: 0 }}>Games</h2>
        <button
          className="btn ghost small"
          onClick={() => navigate({ name: 'season', teamId })}
        >
          Season stats ›
        </button>
      </div>
      {games?.length === 0 && <div className="empty">No games yet.</div>}
      <div className="plist">
        {games?.map((game) => (
          <button
            key={game.id}
            className="prow"
            onClick={() =>
              navigate(
                game.status === 'final'
                  ? { name: 'summary', gameId: game.id }
                  : game.status === 'live'
                    ? { name: 'live', gameId: game.id }
                    : { name: 'setup', gameId: game.id },
              )
            }
          >
            <span className="grow">
              <span className="name">vs {game.opponent || 'TBD'}</span>
              <span className="small muted" style={{ display: 'block' }}>
                {new Date(game.kickoffAt).toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </span>
            <span className={`pos${game.status === 'final' ? ' bench' : ''}`}>
              {game.status === 'setup' ? 'SETUP' : game.status === 'live' ? 'LIVE' : 'FINAL'}
            </span>
          </button>
        ))}
      </div>
      <button
        className="btn primary block"
        disabled={roster.length === 0}
        onClick={() => setSheet('game')}
      >
        + New game
      </button>
      <button
        className="btn block"
        disabled={roster.length === 0}
        onClick={() => setSheet('pastGame')}
      >
        Log a past game
      </button>
      {roster.length === 0 && (
        <p className="small muted center">Add players before creating a game.</p>
      )}

      <h2 style={{ marginTop: 10 }}>Roster · {roster.length}</h2>
      <div className="plist">
        {roster.map((player) => (
          <RosterRow key={player.id} player={player} onTap={() => setEditing(player)}>
            <button
              className="btn ghost small"
              style={{ minHeight: 36, padding: '0 10px' }}
              onClick={(e) => {
                e.stopPropagation();
                void remove(player);
              }}
            >
              Remove
            </button>
          </RosterRow>
        ))}
      </div>
      <button className="btn block" onClick={() => setSheet('player')}>
        + Add player
      </button>

      {retired.length > 0 && (
        <>
          <h2 style={{ marginTop: 10 }}>Retired · {retired.length}</h2>
          <p className="small muted" style={{ marginTop: -6 }}>
            Off the roster, still named in the games they played.
          </p>
          <div className="plist">
            {retired.map((player) => (
              <RosterRow
                key={player.id}
                player={player}
                dim
                onTap={() => setEditing(player)}
              >
                <button
                  className="btn ghost small"
                  style={{ minHeight: 36, padding: '0 10px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void restorePlayer(player.id);
                  }}
                >
                  Restore
                </button>
              </RosterRow>
            ))}
          </div>
        </>
      )}

      {sheet === 'player' && (
        <AddPlayerSheet teamId={teamId} onClose={() => setSheet(null)} />
      )}
      {sheet === 'game' && <NewGameSheet team={team} onClose={() => setSheet(null)} />}
      {sheet === 'pastGame' && (
        <LogPastGameSheet team={team} roster={roster} onClose={() => setSheet(null)} />
      )}
      {sheet === 'settings' && <SettingsSheet team={team} onClose={() => setSheet(null)} />}
      {editing && <EditPlayerSheet player={editing} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

/**
 * A row is not a `<button>` itself — it holds a real `<button>` (Remove or
 * Restore) inside, and nested buttons are invalid HTML that browsers recover
 * from by silently breaking one of the two. `role="button"` + a key handler
 * gets the same tap target and keyboard access without that trap.
 */
function RosterRow({
  player,
  dim,
  onTap,
  children,
}: {
  player: Player;
  dim?: boolean;
  onTap: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="prow"
      role="button"
      tabIndex={0}
      style={dim ? { opacity: 0.7 } : undefined}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTap();
        }
      }}
    >
      <span className="num-badge">{player.number || '–'}</span>
      <span className="grow">
        <span className="name">{player.name}</span>
      </span>
      {children}
    </div>
  );
}

/** Fixes a typo or a renumbering without touching the games already played. */
function EditPlayerSheet({ player, onClose }: { player: Player; onClose: () => void }) {
  const [name, setName] = useState(player.name);
  const [number, setNumber] = useState(player.number);

  const save = async () => {
    if (!name.trim()) return;
    await db.players.update(player.id, { name: name.trim(), number: number.trim() });
    onClose();
  };

  return (
    <Sheet title="Edit player" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="row">
          <label className="field" style={{ width: 92 }}>
            <span>Number</span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              inputMode="numeric"
              placeholder="7"
            />
          </label>
          <label className="field grow">
            <span>Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Morgan"
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
          </label>
        </div>
        <p className="small muted" style={{ marginTop: -6 }}>
          Games already recorded still show the same stints and stats —
          they'll just read the corrected name or number.
        </p>
        <button className="btn primary block" disabled={!name.trim()} onClick={() => void save()}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Adding players is the most repetitive job in the app, so the form stays open
 * and refocuses after each save — a whole roster goes in without leaving.
 */
function AddPlayerSheet({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [added, setAdded] = useState(0);

  const submit = async () => {
    if (!name.trim()) return;
    await db.players.add({
      id: uid(),
      teamId,
      name: name.trim(),
      number: number.trim(),
      active: 1,
    });
    setName('');
    setNumber('');
    setAdded((n) => n + 1);
    document.getElementById('player-name')?.focus();
  };

  return (
    <Sheet title="Add players" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="row">
          <label className="field" style={{ width: 92 }}>
            <span>Number</span>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              inputMode="numeric"
              placeholder="7"
            />
          </label>
          <label className="field grow">
            <span>Name</span>
            <input
              id="player-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Morgan"
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </label>
        </div>
        <button className="btn primary block" disabled={!name.trim()} onClick={() => void submit()}>
          Add player
        </button>
        {added > 0 && (
          <p className="small muted center">
            {added} player{added === 1 ? '' : 's'} added
          </p>
        )}
      </div>
    </Sheet>
  );
}

function NewGameSheet({ team, onClose }: { team: Team; onClose: () => void }) {
  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tag, setTag] = useState<GameTag | ''>('');

  const submit = async () => {
    const kickoffAt = new Date(`${date}T12:00:00`).getTime() || Date.now();
    const id = await createGame(team, opponent.trim(), kickoffAt, tag || undefined);
    onClose();
    navigate({ name: 'setup', gameId: id });
  };

  return (
    <Sheet title="New game" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <label className="field">
          <span>Opponent</span>
          <input
            autoFocus
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="Rovers"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </label>
        <div className="row">
          <label className="field grow">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field grow">
            <span>Tag</span>
            <select value={tag} onChange={(e) => setTag(e.target.value as GameTag | '')}>
              <option value="">None</option>
              {Object.entries(GAME_TAG_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="small muted">
          Uses this team's format: {team.config.periods.count} ×{' '}
          {Math.round(team.config.periods.lengthMs / 60_000)} min,{' '}
          {team.formation.slots.length} a side in {team.formation.name}.
        </p>
        <button className="btn primary block" onClick={() => void submit()}>
          Create game
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The configurability that justifies building this instead of buying it: period
 * shape, squad size, position vocabulary, and how much a minute in goal counts
 * toward a fair share.
 */
function SettingsSheet({ team, onClose }: { team: Team; onClose: () => void }) {
  const [periods, setPeriods] = useState(team.config.periods.count);
  const [lengthMin, setLengthMin] = useState(String(Math.round(team.config.periods.lengthMs / 60_000)));
  const [gkWeight, setGkWeight] = useState(team.config.fairness.gkWeight);

  const save = async () => {
    await db.teams.update(team.id, {
      config: {
        ...team.config,
        periods: { ...team.config.periods, count: periods, lengthMs: minutesOf(lengthMin) * 60_000 },
        fairness: { ...team.config.fairness, gkWeight },
      },
    });
    onClose();
  };

  // `team` is a live-query snapshot from the parent, so once
  // enable/disable/publish lands locally, this prop re-renders with it —
  // `justEnabled` only covers the gap before that reactive update
  // arrives, so the link appears the instant Enable resolves rather than
  // flickering "not yet enabled" for one render.
  const [dashBusy, setDashBusy] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);
  const [dashCopied, setDashCopied] = useState(false);
  const [scoreCopied, setScoreCopied] = useState(false);
  const [justEnabled, setJustEnabled] = useState<{
    dashboardUrl: string;
    scoreboardUrl: string;
  } | null>(null);
  const shareUrl = justEnabled?.dashboardUrl ?? dashboardUrl(team);
  const parentUrl = justEnabled?.scoreboardUrl ?? scoreboardUrl(team);

  const runDashAction = async (action: () => Promise<void>) => {
    setDashBusy(true);
    setDashError(null);
    try {
      await action();
    } catch (err) {
      setDashError((err as Error).message);
    } finally {
      setDashBusy(false);
    }
  };

  /** Shared by both links below — the OS share sheet where available, a
   *  clipboard copy (with its own 2s confirmation) otherwise. */
  const shareOrCopy = async (url: string, title: string, setCopied: (v: boolean) => void) => {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // A cancelled share sheet throws AbortError; fall through to copy
        // for anything else, same pattern as Summary.tsx's export flow.
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareLink = async () => {
    if (!shareUrl) return;
    await shareOrCopy(shareUrl, `${team.name} — season stats`, setDashCopied);
  };

  const handleShareScoreboardLink = async () => {
    if (!parentUrl) return;
    await shareOrCopy(parentUrl, `${team.name} — live score`, setScoreCopied);
  };

  return (
    <Sheet title="Team settings" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="row">
          <label className="field grow">
            <span>Periods</span>
            <select value={periods} onChange={(e) => setPeriods(Number(e.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2 halves</option>
              <option value={3}>3</option>
              <option value={4}>4 quarters</option>
            </select>
          </label>
          <label className="field grow">
            <span>Minutes each</span>
            {/* Held as text while editing. Clamping on every keystroke turned an
                empty field into "1", so clearing 30 to type 25 left you with 125
                and no way to reach a number below ten. Clamp on commit. */}
            <input
              type="number"
              min={1}
              value={lengthMin}
              onChange={(e) => setLengthMin(e.target.value)}
              onBlur={() => setLengthMin(String(minutesOf(lengthMin)))}
              inputMode="numeric"
            />
          </label>
        </div>

        <label className="field">
          <span>Keeper minutes count toward fair share</span>
          <select value={gkWeight} onChange={(e) => setGkWeight(Number(e.target.value))}>
            <option value={1}>Fully — a minute is a minute</option>
            <option value={0.5}>Half credit</option>
            <option value={0}>Not at all — the keeper is excluded</option>
          </select>
        </label>
        <p className="small muted" style={{ marginTop: -6 }}>
          Only affects the fairness targets and sub suggestions. Reported minutes
          are always the real ones. "Not at all" is for a dedicated keeper who
          isn't part of the rotation: whoever's in goal carries no target and no
          "owed time" tag of their own, and everyone else's target is worked out
          over the outfield spots only, not diluted by one that was never
          actually shared.
        </p>

        <button
          className="btn block"
          onClick={() => {
            onClose();
            navigate({ name: 'formation', teamId: team.id });
          }}
        >
          Formation: {team.formation.name} · {team.formation.slots.length} a side ›
        </button>
        <p className="small muted" style={{ marginTop: -6 }}>
          Squad size and positions live on the formation, where you can drag them
          into the shape you actually play.
        </p>

        {dashboardConfigured &&
          (team.dashboardEnabled && shareUrl ? (
            <>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn grow" onClick={() => void handleShareLink()}>
                  {dashCopied ? '✓ Copied' : 'Share coach link'}
                </button>
                <button
                  className="btn"
                  disabled={dashBusy}
                  onClick={() => void runDashAction(() => publishNow(team))}
                >
                  Publish now
                </button>
              </div>
              <p className="small muted" style={{ marginTop: -6, wordBreak: 'break-all' }}>
                {shareUrl}
              </p>

              {parentUrl && (
                <>
                  <button className="btn block" onClick={() => void handleShareScoreboardLink()}>
                    {scoreCopied ? '✓ Copied' : 'Share live score with parents'}
                  </button>
                  <p className="small muted" style={{ marginTop: -6, wordBreak: 'break-all' }}>
                    {parentUrl}
                  </p>
                  <p className="small muted" style={{ marginTop: -6 }}>
                    Score, clock, and who scored — nothing else. No roster,
                    no positions, no playing time. Safe to hand out to any
                    parent.
                  </p>
                </>
              )}

              <button
                className="btn ghost block"
                disabled={dashBusy}
                onClick={() => void runDashAction(() => disableDashboard(team))}
              >
                Turn off coaches dashboard
              </button>
            </>
          ) : (
            <button
              className="btn block"
              disabled={dashBusy}
              onClick={() => void runDashAction(async () => setJustEnabled(await enableDashboard(team)))}
            >
              {dashBusy ? 'Setting up…' : 'Share a live dashboard with other coaches'}
            </button>
          ))}
        {dashError && (
          <p className="small" style={{ color: 'var(--danger)', marginTop: -6 }}>
            {dashError}
          </p>
        )}
        <p className="small muted" style={{ marginTop: -6 }}>
          {dashboardConfigured
            ? 'Full game detail — player names, goals, subs, times — leaves this device once this is on, so another coach can open the link and see it. Turning it off leaves what’s already shared in place; it just stops the link from resolving.'
            : 'Coaches dashboard isn’t set up in this build yet.'}
        </p>

        <button className="btn primary block" onClick={() => void save()}>
          Save
        </button>
        <button
          className="btn danger block"
          onClick={() => {
            if (confirm(`Delete ${team.name} and all its games? This cannot be undone.`)) {
              void deleteTeam(team.id).then(() => navigate({ name: 'home' }));
            }
          }}
        >
          Delete team
        </button>
      </div>
    </Sheet>
  );
}
