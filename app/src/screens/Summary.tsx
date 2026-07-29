import { elapsedGameMs, fairnessIndex, formatClock, playerStats } from '@pitchside/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { HoldButton, mins, mmss, Screen, Sheet } from '../components';
import { db, deleteGame, type Game } from '../db';
import { useGameLog, useNow } from '../hooks';
import { navigate } from '../router';

const DEFAULT_CFG = {
  periods: { count: 2, lengthMs: 1_800_000, fieldPlayers: 9 },
  fairness: { gkWeight: 1, mode: 'equal' as const },
  gkPosition: 'GK',
};

/** A plain number, which a spreadsheet should keep as a number. */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * One CSV cell: quoted only where the syntax requires it, and defused for the
 * spreadsheet where the content requires that.
 *
 * Excel and Sheets evaluate an imported cell that opens with `=`, `+`, `-` or
 * `@` as a formula, so a player entered as `=1+1` — or anything less innocent —
 * runs on import. A leading apostrophe forces it to text; Excel's own import
 * logic already treats that as a formatting hint, quoted or not.
 *
 * Quoting *every* cell — the previous behaviour — produced a file that was
 * technically valid and unreadable as plain text: `"Ana","24","0","GK 24m"`
 * for a row with nothing in it that needed escaping. A cell is quoted here
 * only when it contains a comma, a quote, or a newline, which is what makes
 * the raw file scannable in a text preview and not just once it's imported.
 *
 * The formula guard is exempted from that: a value that is simply a number is
 * left alone regardless, so a genuinely negative stat stays a number instead
 * of text — quoting it would break the first SUM the head coach writes.
 */
export function csvCell(value: unknown): string {
  const raw = String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) && !NUMERIC.test(raw) ? `'${raw}` : raw;
  if (!/[",\n\r]/.test(safe)) return safe;
  return `"${safe.replace(/"/g, '""')}"`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/** One HTML cell's text content, safe to inline into a template string. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

export function SummaryScreen({ gameId }: { gameId: string }) {
  const game = useLiveQuery(() => db.games.get(gameId), [gameId]);
  const team = useLiveQuery(
    async () => (game ? db.teams.get(game.teamId) : undefined),
    [game?.teamId],
  );
  const players = useLiveQuery(
    async () => (game ? db.players.where('teamId').equals(game.teamId).toArray() : []),
    [game?.teamId],
  );

  const config = game?.config ?? DEFAULT_CFG;
  const { state, errors, record } = useGameLog(gameId, config);
  const now = useNow(state.status === 'running');
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [share, setShare] = useState(false);
  const [editingGame, setEditingGame] = useState(false);

  const nameOf = useMemo(() => {
    const map = new Map((players ?? []).map((p) => [p.id, p]));
    return (id: string) => map.get(id)?.name ?? id;
  }, [players]);

  const stats = useMemo(
    () => playerStats(state, now).filter((s) => state.attendance.get(s.playerId) !== 'absent'),
    [state, now],
  );

  /** "CM 12:30 · LB 8:00", longest spell first, top 3 — the rest is noise for a wall of positions. */
  const byPosition = (msByPosition: Record<string, number>): string =>
    Object.entries(msByPosition)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([code, ms]) => `${code} ${mmss(ms)}`)
      .join(' · ');

  if (!game || !team) return <Screen title="Loading…">{null}</Screen>;

  const elapsed = elapsedGameMs(state, now);
  const maxMs = Math.max(1, ...stats.map((s) => s.playedMs));
  const index = fairnessIndex(state, now);
  const byMinutes = [...stats].sort((a, b) => b.playedMs - a.playedMs);

  // Where each period begins on a single continuous timeline.
  const offsets = state.periodElapsedMs.reduce<number[]>((acc, ms, i) => {
    acc.push((acc[i - 1] ?? 0) + (i === 0 ? 0 : (state.periodElapsedMs[i - 1] ?? 0)));
    return acc;
  }, []);
  const timelineTotal = Math.max(1, elapsed);

  const summaryText = () => {
    const lines = [
      `${team.name} ${state.score.us}–${state.score.them} ${game.opponent || 'Opponent'}`,
      new Date(game.kickoffAt).toLocaleDateString(),
      '',
      'Playing time:',
      ...byMinutes.map((s) => `  ${nameOf(s.playerId)} — ${mmss(s.playedMs)}`),
    ];
    const scorers = stats.filter((s) => s.goals > 0 || s.assists > 0);
    if (scorers.length) {
      lines.push('', 'Goals and assists:');
      for (const s of scorers) {
        const bits = [s.goals && `${s.goals}G`, s.assists && `${s.assists}A`].filter(Boolean);
        lines.push(`  ${nameOf(s.playerId)} — ${bits.join(' ')}`);
      }
    }
    lines.push('', `Playing-time fairness: ${Math.round(index * 100)}%`);
    return lines.join('\n');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const numberOf = (id: string) => players?.find((p) => p.id === id)?.number ?? '';

  /** "CM 12m · LB 8m" for a CSV cell — whole minutes, matches the rest of the file. */
  const positionsForCsv = (msByPosition: Record<string, number>): string =>
    Object.entries(msByPosition)
      .sort((a, b) => b[1] - a[1])
      .map(([code, ms]) => `${code} ${mins(ms)}m`)
      .join(' · ');

  const csvRow = (cells: unknown[]): string => cells.map(csvCell).join(',');

  /*
   * A short metadata block above the table, not a bare data dump: opened cold
   * — forwarded by text, detached from the filename that named the game — the
   * file itself should say which game this is.
   */
  const csvText = () => {
    const lines = [
      csvRow(['Team', team.name]),
      csvRow(['Opponent', game.opponent || 'TBD']),
      csvRow(['Date', new Date(game.kickoffAt).toLocaleDateString()]),
      csvRow(['Final score', `${team.name} ${state.score.us} – ${game.opponent || 'Opponent'} ${state.score.them}`]),
      csvRow(['Playing-time fairness', `${Math.round(index * 100)}%`]),
      '',
      csvRow([
        'Player', 'Number', 'Minutes', 'Bench Minutes', 'Positions Played',
        'Goals', 'Assists', 'Shots', 'Saves', 'Stints',
      ]),
      ...byMinutes.map((s) =>
        csvRow([
          nameOf(s.playerId),
          numberOf(s.playerId),
          mins(s.playedMs),
          mins(s.benchMs),
          positionsForCsv(s.msByPosition) || '—',
          s.goals,
          s.assists,
          s.shots,
          s.saves,
          s.stintCount,
        ]),
      ),
    ];
    // CRLF: the RFC 4180 line ending, and what Excel on Windows expects.
    return lines.join('\r\n');
  };

  const fileStem = () =>
    `${team.name}-vs-${game.opponent || 'game'}-${new Date(game.kickoffAt).toISOString().slice(0, 10)}`
      .replace(/[^\w.-]+/g, '-');

  const csvName = () => `${fileStem()}.csv`;
  const reportName = () => `${fileStem()}.html`;

  /**
   * A styled, standalone HTML page — the one meant to be opened and read, not
   * imported. The CSV reads as raw comma-separated text the moment it lands
   * outside a spreadsheet app; this renders as an actual table with headers
   * and a title in any browser, on any platform, with no app required.
   */
  const reportHtml = () => {
    const title = `${team.name} ${state.score.us}–${state.score.them} ${game.opponent || 'Opponent'}`;
    const rows = byMinutes
      .map(
        (s) => `      <tr>
        <td>${escapeHtml(nameOf(s.playerId))}</td>
        <td class="num">${escapeHtml(numberOf(s.playerId) || '—')}</td>
        <td class="num">${mins(s.playedMs)}</td>
        <td class="num">${mins(s.benchMs)}</td>
        <td>${escapeHtml(positionsForCsv(s.msByPosition) || '—')}</td>
        <td class="num">${s.goals || ''}</td>
        <td class="num">${s.assists || ''}</td>
        <td class="num">${s.shots || ''}</td>
        <td class="num">${s.saves || ''}</td>
        <td class="num">${s.stintCount}</td>
      </tr>`,
      )
      .join('\n');
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    margin: 0; padding: 24px; color: #1a1a1a; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 14px; margin: 0; }
  .fair { display: inline-block; margin-top: 14px; padding: 8px 12px; border-radius: 8px;
    background: #eef6ee; color: #1a5c1a; font-size: 14px; }
  table { border-collapse: collapse; width: 100%; margin-top: 20px; font-size: 14px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #e2e2e2; text-align: left; white-space: nowrap; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  thead th { border-bottom: 2px solid #333; font-weight: 600; }
  tbody tr:nth-child(even) { background: #fafafa; }
  @media (prefers-color-scheme: dark) {
    body { background: #16181c; color: #e8e8e8; }
    .meta { color: #9a9a9a; }
    .fair { background: #17301a; color: #7fd98a; }
    th, td { border-bottom-color: #2c2f36; }
    thead th { border-bottom-color: #ccc; }
    tbody tr:nth-child(even) { background: #1c1f26; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${escapeHtml(
    new Date(game.kickoffAt).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
  )}</p>
  <div class="fair">Playing-time fairness: ${Math.round(index * 100)}%</div>
  <table>
    <thead>
      <tr>
        <th>Player</th><th class="num">#</th><th class="num">Min</th><th class="num">Bench</th>
        <th>Positions</th><th class="num">G</th><th class="num">A</th>
        <th class="num">Shots</th><th class="num">Saves</th><th class="num">Stints</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
  };

  /** Downloads a Blob with no side effect on the sheet — shared by every route below. */
  const saveFile = (contents: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveCsv = () => saveFile(csvText(), csvName(), 'text/csv');
  const saveReport = () => saveFile(reportHtml(), reportName(), 'text/html');

  const downloadReport = () => {
    saveReport();
    setShare(false);
  };

  const downloadCsv = () => {
    saveCsv();
    setShare(false);
  };

  /*
   * On a phone the share sheet is the only route to Messages, Mail, AirDrop and
   * Files, and it is the only one that can carry a file as a real attachment.
   * The report — not the CSV — is what goes out this way: it is the one meant
   * to be opened and read by someone else, and a wall of quoted CSV cells is
   * not something anyone wants pasted into a text thread as a fallback either.
   */
  const shareReport = async () => {
    const text = summaryText();
    const title = `${team.name} vs ${game.opponent || 'Opponent'}`;
    try {
      const file = new File([reportHtml()], reportName(), { type: 'text/html' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title, text, files: [file] });
      } else if (navigator.share) {
        saveReport();
        await navigator.share({ title, text: `${text}\n\n(Full stats report saved to your downloads.)` });
      } else {
        saveReport();
        await navigator.clipboard.writeText(text);
        alert('Sharing is not available in this browser — the summary was copied, and the report was saved to your downloads.');
      }
      setShare(false);
    } catch (err) {
      // A cancelled share sheet throws AbortError; that is not a failure.
      if ((err as Error)?.name !== 'AbortError') setShare(false);
    }
  };

  /*
   * mailto cannot attach a file — there is no header for it, on any platform —
   * so the report is saved to downloads and the body carries only the readable
   * summary. Earlier this inlined the raw CSV into the body below a length
   * threshold, which for a normal-sized roster was under the threshold every
   * time: every email got a wall of quoted cells instead of a draft.
   */
  const emailReport = () => {
    saveReport();
    const subject = `${team.name} ${state.score.us}–${state.score.them} ${game.opponent || 'Opponent'} — stats`;
    const body = `${summaryText()}\n\n(The full stats report was just saved to your downloads — attach it before sending.)`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setShare(false);
  };

  return (
    <Screen
      title={`${state.score.us}–${state.score.them} vs ${game.opponent || 'TBD'}`}
      subtitle={`${team.name} · ${formatClock(elapsed)} played`}
      onBack={() =>
        navigate(
          state.status === 'final'
            ? { name: 'team', teamId: game.teamId }
            : { name: 'live', gameId },
        )
      }
      action={
        <button className="btn ghost" onClick={() => setMenu(true)} aria-label="More">
          •••
        </button>
      }
      footer={
        <div className="actions">
          <button className="btn" onClick={() => void copy()}>
            {copied ? '✓ Copied' : 'Copy summary'}
          </button>
          <button className="btn" onClick={() => setShare(true)}>
            Export
          </button>
          {state.status !== 'final' && (
            <button className="btn primary" onClick={() => navigate({ name: 'live', gameId })}>
              Back to game
            </button>
          )}
        </div>
      }
    >
      {share && (
        <Sheet title="Export stats" onClose={() => setShare(false)}>
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn primary block stack" onClick={downloadReport}>
              Download report
              <span className="small muted" style={{ display: 'block' }}>
                A readable page with the full table — the one to send another
                coach. Opens in any browser.
              </span>
            </button>
            <button className="btn block stack" onClick={() => void shareReport()}>
              Text or share…
              <span className="small muted" style={{ display: 'block' }}>
                Messages, WhatsApp, AirDrop — anything in the share sheet.
              </span>
            </button>
            <button className="btn block stack" onClick={emailReport}>
              Email
              <span className="small muted" style={{ display: 'block' }}>
                Saves the report, then opens a draft with the summary — attach
                the file before sending.
              </span>
            </button>
            <button className="btn block stack" onClick={downloadCsv}>
              Download CSV
              <span className="small muted" style={{ display: 'block' }}>
                For your own spreadsheet — opens in Numbers, Excel or Sheets.
              </span>
            </button>
          </div>
        </Sheet>
      )}

      {menu && (
        <Sheet title={`vs ${game.opponent || 'TBD'}`} onClose={() => setMenu(false)}>
          <div style={{ display: 'grid', gap: 8 }}>
            {state.status !== 'final' && (
              <HoldButton
                className="btn danger block"
                onHold={() => {
                  setMenu(false);
                  // Unlike Live.tsx, this screen has no effect anywhere that
                  // syncs `game.status` to the derived state, so it has to be
                  // persisted directly here or it never happens at all.
                  void record({ type: 'GAME_END' }).then(() =>
                    db.games.update(gameId, { status: 'final' }),
                  );
                }}
              >
                Hold to end the game
              </HoldButton>
            )}
            <button
              className="btn block"
              onClick={() => {
                setMenu(false);
                setEditingGame(true);
              }}
            >
              Edit game
            </button>
            <button className="btn block" onClick={() => navigate({ name: 'events', gameId })}>
              Modify events
            </button>
            <button
              className="btn danger block"
              onClick={() => {
                if (confirm('Delete this game and everything recorded in it?')) {
                  void deleteGame(gameId).then(() =>
                    navigate({ name: 'team', teamId: game.teamId }),
                  );
                }
              }}
            >
              Delete game
            </button>
          </div>
        </Sheet>
      )}

      {editingGame && <EditGameSheet game={game} onClose={() => setEditingGame(false)} />}

      {errors.length > 0 && (
        <div className="banner error">
          {errors.length} event{errors.length === 1 ? '' : 's'} in this game's log could
          not be applied, so these numbers may be incomplete.
        </div>
      )}

      <div className={`banner${index >= 0.8 ? ' ok' : ''}`}>
        <b>Playing-time fairness: {Math.round(index * 100)}%</b>
        <br />
        The least-played available player got {Math.round(index * 100)}% of the
        most-played player's minutes.
      </div>

      <h2>Playing time</h2>
      <div className="card">
        <table className="tbl">
          <tbody>
            {byMinutes.map((s) => (
              <tr key={s.playerId}>
                <td>
                  {nameOf(s.playerId)}
                  {s.positionsPlayed > 0 && (
                    <span className="small muted" style={{ display: 'block' }}>
                      {byPosition(s.msByPosition)}
                    </span>
                  )}
                </td>
                <td className="bar" style={{ width: '52%' }}>
                  <span style={{ width: `${(s.playedMs / maxMs) * 100}%` }} />
                  <em>{mmss(s.playedMs)}</em>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.stints.length > 0 && (
        <>
          <h2>Who was on, when</h2>
          <div className="card">
            <div className="gantt">
              {byMinutes.map((s) => (
                <div key={s.playerId} className="grow-row">
                  <span className="glabel">{nameOf(s.playerId)}</span>
                  <span className="gtrack">
                    {state.stints
                      .filter((st) => st.playerId === s.playerId)
                      .map((st, i) => {
                        const start = (offsets[st.period - 1] ?? 0) + st.startMs;
                        const end =
                          (offsets[st.period - 1] ?? 0) +
                          (st.endMs ?? state.clockMs);
                        return (
                          <span
                            key={i}
                            className="gseg"
                            title={`${st.position} ${mmss(end - start)}`}
                            style={{
                              left: `${(start / timelineTotal) * 100}%`,
                              width: `${Math.max(0.8, ((end - start) / timelineTotal) * 100)}%`,
                            }}
                          >
                            {st.position}
                          </span>
                        );
                      })}
                  </span>
                </div>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              Each bar is one spell on the field. Labels show the position.
            </p>
          </div>
        </>
      )}

      <h2>Everything else</h2>
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Player</th>
              <th>Min</th>
              <th>G</th>
              <th>A</th>
              <th>Bench</th>
              <th>Positions</th>
            </tr>
          </thead>
          <tbody>
            {byMinutes.map((s) => (
              <tr key={s.playerId}>
                <td>{nameOf(s.playerId)}</td>
                <td>{mins(s.playedMs)}</td>
                <td>{s.goals || ''}</td>
                <td>{s.assists || ''}</td>
                <td className="muted">{mins(s.benchMs)}</td>
                <td style={{ textAlign: 'left' }}>{byPosition(s.msByPosition) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Positions show how long each player spent in each one — the development
        record.
      </p>
    </Screen>
  );
}

function EditGameSheet({ game, onClose }: { game: Game; onClose: () => void }) {
  const [opponent, setOpponent] = useState(game.opponent);

  const save = async () => {
    await db.games.update(game.id, { opponent: opponent.trim() });
    onClose();
  };

  return (
    <Sheet title="Edit game" onClose={onClose}>
      <div style={{ display: 'grid', gap: 12 }}>
        <label className="field">
          <span>Opponent</span>
          <input
            autoFocus
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="Rovers"
            onKeyDown={(e) => e.key === 'Enter' && void save()}
          />
        </label>
        <button className="btn primary block" onClick={() => void save()}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
