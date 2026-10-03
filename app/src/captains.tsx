import { useRef, useState } from 'react';
import { Sheet } from './components';
import { db, type Game } from './db';

/**
 * Who captains this game. Stored on the game itself, not as an event: it's a
 * fact about the match, not something that happens at a moment on the clock,
 * and keeping it off the event log keeps it out of every minutes calculation.
 * Saved on each tap, so closing the sheet any way never loses a pick.
 */
export function CaptainsSheet({
  game,
  players,
  onClose,
}: {
  game: Game;
  players: { id: string; name: string; number: string }[];
  onClose: () => void;
}) {
  // Held in a ref, not re-read from `game` or a render-time snapshot: two
  // taps landing before the next render would otherwise both start from the
  // same stale list, and the second would silently undo the first.
  const pickedRef = useRef(new Set(game.captainIds ?? []));
  const [, rerender] = useState(0);
  const picked = pickedRef.current;
  const toggle = (id: string) => {
    const next = new Set(pickedRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    pickedRef.current = next;
    rerender((n) => n + 1);
    void db.games.update(game.id, { captainIds: [...next] });
  };

  return (
    <Sheet title="Captains" onClose={onClose}>
      <p className="small muted">Tap to pick or unpick. Usually one or two.</p>
      <div className="chips" style={{ marginTop: 10 }}>
        {players.map((p) => (
          <button
            key={p.id}
            className={`chip${picked.has(p.id) ? ' sel' : ''}`}
            onClick={() => toggle(p.id)}
          >
            {p.number && <b>{p.number}</b>} {p.name}
          </button>
        ))}
      </div>
      <button className="btn primary block" style={{ marginTop: 14 }} onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}

/** "Captains: Leo Selby, Sam Jones" — or null when none are set. */
export function captainsLine(game: Game, nameOf: (id: string) => string): string | null {
  const ids = game.captainIds ?? [];
  return ids.length ? `Captain${ids.length === 1 ? '' : 's'}: ${ids.map(nameOf).join(', ')}` : null;
}
