import { formatClock } from '@subtime/core';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function Screen({
  title,
  subtitle,
  onBack,
  action,
  children,
  footer,
  fill,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Lock the body to the viewport and let the content size itself to the space
   * between header and footer, instead of scrolling. Used by the game screen,
   * where scrolling to find a player mid-match is unacceptable.
   */
  fill?: boolean;
}) {
  return (
    <div className="app">
      <header className="top">
        {onBack && (
          <button className="back" onClick={onBack} aria-label="Back">
            ‹
          </button>
        )}
        <h1>
          {title}
          {subtitle && <span className="sub">{subtitle}</span>}
        </h1>
        {action}
      </header>
      <main className={fill ? 'fill' : undefined}>{children}</main>
      {footer}
    </div>
  );
}

/*
 * Sheets are counted rather than flagged. Swapping one sheet for another —
 * picking a scorer from a goal sheet, say — mounts the new one before the old
 * one unmounts, and a boolean would be cleared by the departing sheet and leave
 * the page marked closed while a sheet is still up.
 */
let openSheets = 0;

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape closes, and the page behind must not scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    openSheets += 1;
    document.body.classList.add('sheet-open');
    return () => {
      openSheets -= 1;
      if (openSheets === 0) document.body.classList.remove('sheet-open');
    };
  }, []);

  /*
   * Rendered into <body>, not into the screen that opened it.
   *
   * The header and the footer action bar are blurred (`backdrop-filter`), and
   * WebKit promotes a blurred element to its own compositing layer that can
   * paint above content with a higher z-index. A sheet nested inside <main>,
   * between those two bars, lost to them on iOS: the Delete game button sat
   * underneath Copy summary and Export CSV and could not be tapped, while
   * Chromium sorted the same markup correctly and showed nothing wrong.
   *
   * A portal makes the sheet a sibling of the app shell rather than a
   * descendant of a scroll container between two composited bars. `.sheet-open`
   * on the body then takes those bars out of the running entirely — belt and
   * braces, and invisible either way, since a bottom-anchored full-width sheet
   * covers that strip regardless.
   */
  return createPortal(
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h3>{title}</h3>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const mmss = (ms: number): string => formatClock(Math.max(0, ms));

/**
 * Short label for a period: 1H/2H for halves, Q1..Q4 for quarters, else P1..
 *
 * The clock reads per-period and this sits beside it. That pairing is what
 * makes the reading unambiguous without inventing a running total from
 * configured period lengths that a real game rarely honours.
 */
export const periodTag = (periods: number, period: number): string => {
  if (period < 1) return 'Pre';
  if (periods === 2) return `${period}H`;
  if (periods === 4) return `Q${period}`;
  return `P${period}`;
};

/** Whole minutes, for tables where seconds are noise. */
export const mins = (ms: number): number => Math.round(ms / 60_000);

/**
 * Colour for a player's fairness deficit: warm when they are owed time, cool
 * when they have had more than their share. The point is that a coach can scan
 * the list without reading a single number.
 */
export function heatColor(deficitMs: number): string {
  const d = deficitMs / (10 * 60_000); // saturate at ten minutes either way
  if (d > 0.08) return `hsl(${Math.round(42 - 42 * Math.min(d, 1))} 88% 55%)`;
  if (d < -0.08) return 'hsl(162 45% 38%)';
  return 'var(--line)';
}

export function PlayerRow({
  name,
  number,
  position,
  playedMs,
  deficitMs,
  picked,
  onClick,
  onPositionClick,
  right,
}: {
  name: string;
  number: string;
  position?: string;
  playedMs: number;
  deficitMs?: number;
  picked?: boolean;
  onClick?: () => void;
  onPositionClick?: () => void;
  right?: ReactNode;
}) {
  /*
   * The deficit is a *projection* — where this player lands at full time if
   * nothing changes — not a statement about right now. Labelling it "6:00 over"
   * at kickoff, before anyone has played a second, reads as a description of the
   * present and is baffling. "ends 6:00 over" says what it actually means.
   */
  const projection =
    deficitMs === undefined
      ? null
      : Math.abs(deficitMs) < 30_000
        ? 'on track'
        : deficitMs > 0
          ? `ends ${mmss(deficitMs)} short`
          : `ends ${mmss(-deficitMs)} over`;

  return (
    <button
      className={`prow${position ? ' on' : ''}${picked ? ' picked' : ''}`}
      onClick={onClick}
      type="button"
    >
      {deficitMs !== undefined && (
        <span className="heat" style={{ background: heatColor(deficitMs) }} />
      )}
      <span className="num-badge">{number || '–'}</span>
      <span className="grow">
        <span className="name">{name}</span>
        {projection && (
          <span className="small muted" style={{ display: 'block' }}>
            {projection}
          </span>
        )}
      </span>
      {position &&
        (onPositionClick ? (
          <span
            className="pos"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onPositionClick();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                e.preventDefault();
                onPositionClick();
              }
            }}
          >
            {position}
          </span>
        ) : (
          <span className="pos">{position}</span>
        ))}
      {!position && <span className="pos bench">BENCH</span>}
      <span className="mins">
        <b>{mmss(playedMs)}</b>
      </span>
      {right}
    </button>
  );
}

/** Short WebAudio blip for the shift alarm. */
let audioCtx: AudioContext | null = null;

export function beep(times = 1): void {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    // iOS suspends the context until a user gesture resumes it; period start
    // and every sub are taps, so by the time an alarm fires it is running.
    void audioCtx.resume();
    for (let i = 0; i < times; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const start = audioCtx.currentTime + i * 0.22;
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    }
  } catch {
    // Audio is a convenience; never let it break the game screen.
  }
}
