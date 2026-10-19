// Plays new agent events on the 3D house one step at a time. The events of one request reach the
// Collector within milliseconds; shown at once they can't be followed, so they are queued and played
// in the order a request travels: ask → Home decides → Home passes it on → the room decides →
// automation rules → devices change.
import { useEffect, useRef, useState } from 'react';

const GATHER_MS = 400; // wait for the rest of a burst before playing it
const STEP_MS = 1100; // between steps
export const SHOW_MS = 4500; // how long a step stays on screen

function stepOf(event) {
  if (event.dir === 'out' && ['device.control', 'context.update', 'context.query'].includes(event.type)) {
    return event.agent === 'desktop' || event.agent === 'smartphone' ? 0 : 2;
  }
  if (event.dir === 'in' && event.type === 'device.control') return event.agent === 'orchestrator' ? 1 : 3;
  if (event.dir === 'rule') return 4;
  if (event.dir === 'exec') return 5;
  return null;
}

/** Events on screen now (each with `at`, when it was shown) and a clock that ticks while LIVE. */
export function useAgentScene(events) {
  const lastId = useRef(null);
  const queue = useRef([]);
  const timer = useRef(null);
  const [shown, setShown] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const maxId = events.reduce((max, event) => Math.max(max, event.id), 0);
    if (!events.length) return; // snapshot not in yet
    if (lastId.current === null) { lastId.current = maxId; return; } // don't replay history
    const fresh = events.filter((event) => event.id > lastId.current && stepOf(event) !== null);
    lastId.current = Math.max(lastId.current, maxId);
    if (!fresh.length) return;
    queue.current.push(...fresh);
    if (timer.current) return;
    const play = () => {
      const step = Math.min(...queue.current.map(stepOf));
      const batch = queue.current.filter((event) => stepOf(event) === step);
      queue.current = queue.current.filter((event) => stepOf(event) !== step);
      const at = Date.now();
      setShown((current) => [...current.filter((event) => at - event.at < SHOW_MS), ...batch.map((event) => ({ ...event, at }))]);
      timer.current = queue.current.length ? window.setTimeout(play, STEP_MS) : null;
    };
    timer.current = window.setTimeout(play, GATHER_MS);
  }, [events]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const at = Date.now();
      setNow(at);
      setShown((current) => (current.some((event) => at - event.at >= SHOW_MS) ? current.filter((event) => at - event.at < SHOW_MS) : current));
    }, 500);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(timer.current);
    };
  }, []);

  return { shown, now };
}
