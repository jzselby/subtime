import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { lastBackupAt, readBackup, restoreBackup, saveBackup } from '../backup';
import { Screen, Sheet, useToast } from '../components';
import { createTeam, db } from '../db';
import { navigate } from '../router';

export function HomeScreen() {
  const teams = useLiveQuery(() => db.teams.orderBy('createdAt').toArray(), []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [fieldPlayers, setFieldPlayers] = useState(9);

  const { notify, toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [lastBackup, setLastBackup] = useState(lastBackupAt);
  const backupStale =
    Boolean(teams?.length) && (!lastBackup || Date.now() - lastBackup > 14 * 24 * 3600_000);

  const runBackup = async () => {
    setBusy(true);
    try {
      if (await saveBackup()) {
        setLastBackup(lastBackupAt());
        notify('Backup saved');
      }
    } catch (err) {
      alert(`Backup failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runRestore = async (file: File) => {
    setBusy(true);
    try {
      const backup = await readBackup(file);
      const when = new Date(backup.exportedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const ok = confirm(
        `Restore the backup from ${when}? It has ${backup.teams.length} team(s) and ` +
          `${backup.games.length} game(s).\n\nAnything in the backup replaces the same ` +
          'record on this phone. Nothing that is only on this phone is deleted.',
      );
      if (!ok) return;
      await restoreBackup(backup);
      notify('Backup restored');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) return;
    const id = await createTeam(name.trim(), ageGroup.trim(), fieldPlayers);
    setAdding(false);
    setName('');
    setAgeGroup('');
    navigate({ name: 'team', teamId: id });
  };

  return (
    <Screen title="Pitchside" subtitle="Playing time, subs, and stats">
      {teams?.length === 0 && (
        <div className="empty">
          No teams yet.
          <br />
          Add one to get started.
        </div>
      )}

      <div className="plist">
        {teams?.map((team) => (
          <button
            key={team.id}
            className="prow"
            onClick={() => navigate({ name: 'team', teamId: team.id })}
          >
            <span className="grow">
              <span className="name">{team.name}</span>
              {team.ageGroup && <span className="small muted"> · {team.ageGroup}</span>}
            </span>
            <span className="muted">›</span>
          </button>
        ))}
      </div>

      <button className="btn primary block" onClick={() => setAdding(true)}>
        + New team
      </button>

      <h2 style={{ marginTop: 18 }}>Backup</h2>
      <button
        className="btn block"
        disabled={busy || !teams?.length}
        onClick={() => void runBackup()}
      >
        Back up all data
      </button>
      <p className="small" style={{ marginTop: -4, color: backupStale ? 'var(--warn)' : 'var(--muted)' }}>
        {lastBackup
          ? `Last backup ${new Date(lastBackup).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`
          : 'No backup yet.'}{' '}
        Everything lives only on this phone — save a copy to Files or iCloud Drive now and then.
      </p>
      <button className="btn ghost block" disabled={busy} onClick={() => fileInput.current?.click()}>
        Restore from a backup…
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void runRestore(file);
        }}
      />
      {toast}

      {adding && (
        <Sheet title="New team" onClose={() => setAdding(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="field">
              <span>Team name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Thunder"
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </label>
            <label className="field">
              <span>Age group (optional)</span>
              <input
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value)}
                placeholder="U11"
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </label>
            <label className="field">
              <span>Format</span>
              <select
                value={fieldPlayers}
                onChange={(e) => setFieldPlayers(Number(e.target.value))}
              >
                {[4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                  <option key={n} value={n}>
                    {n} v {n}
                  </option>
                ))}
              </select>
            </label>
            <p className="small muted" style={{ marginTop: -6 }}>
              Sets the starting formation. You can change the shape and drag
              positions afterwards.
            </p>
            <button className="btn primary block" disabled={!name.trim()} onClick={() => void submit()}>
              Create team
            </button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
