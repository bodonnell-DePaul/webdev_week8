// =============================================================================
// useLog — tiny scrollable log component + hook
// -----------------------------------------------------------------------------
// Every demo page uses this to show the timeline of events flowing through
// the chosen technology. Each entry can be tagged 'good' / 'bad' / 'muted'.
// =============================================================================
import { useCallback, useRef, useState, useEffect } from 'react';

export type LogLevel = 'info' | 'good' | 'bad' | 'muted';
export type LogEntry = { time: string; level: LogLevel; text: string };

export function useLog(initial: LogEntry[] = []) {
  const [entries, setEntries] = useState<LogEntry[]>(initial);
  const ref = useRef<HTMLDivElement | null>(null);

  const push = useCallback((text: string, level: LogLevel = 'info') => {
    setEntries((es) => {
      const next = [...es, { time: new Date().toLocaleTimeString(), level, text }];
      // Keep last 500 lines so demos that run a long time don't eat memory.
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  // Auto-scroll to bottom on each append.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [entries]);

  const Log = () => (
    <div className="log" ref={ref}>
      {entries.map((e, i) => (
        <div key={i} className={`l-${e.level}`}>
          [{e.time}] {e.text}
        </div>
      ))}
    </div>
  );

  return { entries, push, clear, Log };
}
