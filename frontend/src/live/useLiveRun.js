// Live Simulation runs (services/runner): scenarios, the runs and their steps, and starting a run.
// What the agents then do comes from useLiveHome (Collector events, Gateway devices), not from here.
import { useCallback, useEffect, useState } from 'react';
import { RUN_AVAILABLE, getRunner, runnerWsUrl, startRun } from './config';
import { openSocket } from './socket';

const KEEP_RUNS = 20;

export function useLiveRun(enabled) {
  const [scenarios, setScenarios] = useState([]);
  const [runs, setRuns] = useState([]); // newest first
  const [status, setStatus] = useState('off');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setScenarios([]);
      setRuns([]);
      setStatus('off');
      setError('');
      return undefined;
    }
    return openSocket(runnerWsUrl(), {
      onStatus: (next) => {
        setStatus(next);
        if (next === 'open') getRunner('/scenarios').then(setScenarios).catch(() => {});
      },
      onMessage: (message) => {
        if (message.type === 'snapshot') setRuns(message.runs);
        else if (message.type === 'run.updated') setRuns((current) => upsert(current, message.run));
      },
    });
  }, [enabled]);

  /** Resolves true if the run started (the caller may then clear its input), false otherwise. */
  const start = useCallback(async (body) => {
    setError('');
    setStarting(true);
    try {
      const run = await startRun(body);
      // The WebSocket may already have a newer state of this run; never go back to the POST answer.
      setRuns((current) => (current.some((item) => item.id === run.id) ? current : upsert(current, run)));
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      setStarting(false);
    }
  }, []);

  const current = runs[0] || null;
  const busy = starting || current?.status === 'running';
  // allowed: this dev server can start runs at all; canRun: and the Runner is connected right now.
  const canRun = RUN_AVAILABLE && status === 'open';
  return { scenarios, runs, current, status, error, busy, allowed: RUN_AVAILABLE, canRun, start, clearError: () => setError('') };
}

// A run already shown is replaced where it is; a new one goes first.
function upsert(runs, run) {
  const index = runs.findIndex((item) => item.id === run.id);
  if (index < 0) return [run, ...runs].slice(0, KEEP_RUNS);
  const next = runs.slice();
  next[index] = run;
  return next;
}
