// Agents on the 3D house (LIVE): where each agent lives, what it says to whom (speech bubbles and a
// dot travelling between agents), what its LLM is doing in a Runner run (thinking, then its answer),
// and which device changed or was refused. Home3D draws it on the house; labels face the viewer.
import React, { useEffect, useRef } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { devicePinSpot, roomRect } from '../Home3D';
import { AGENT_ORDER, agentName, sceneFlash, sceneLine } from './mapping';
import { useAgentScene } from './useAgentScene';
import './scene.css';

// Where each agent stands, in % of the house plan (Home3D layout).
const SPOT = {
  orchestrator: [13, 70], // living room
  room1: [86, 78], // bedroom 3 = My Room
  room2: [78, 40], // bedroom 2 = protected room
  desktop: [62, 91], // the PC in My Room
  smartphone: [49, 52], // the hall, with the person
};
// Room each agent stands in: zoomed into a room (Home3D), only that room's agents are shown.
const ROOM = { orchestrator: 'living', room1: 'bedroom3', room2: 'bedroom2', desktop: 'bedroom3', smartphone: null };
// Desktop and My Room stand close together, so their bubbles lean apart.
const BUBBLE_SHIFT = { desktop: '-38%', room1: '38%' };
const REPLY_MS = 8000;
const shortName = (id) => agentName(id).replace(' Agent', '');
const plain = (text) => text.replace(/[*_`#>|]/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/\s+/g, ' ').trim();
const clip = (text, length = 80) => (text.length > length ? `${text.slice(0, length)}…` : text);

/**
 * Answers to show now: step key -> when this screen first saw the answer. Answers already there when
 * the screen opened are not replayed.
 */
function useNewAnswers(run) {
  const seen = useRef(null);
  useEffect(() => {
    if (!run) return; // the Runner's snapshot is not in yet
    const first = seen.current === null;
    if (first) seen.current = new Map();
    run.steps.forEach((step, index) => {
      const key = `${run.id}-${index}`;
      if (step.reply && !seen.current.has(key)) seen.current.set(key, first ? 0 : Date.now());
    });
  }, [run]);
  return seen.current || new Map();
}

function Billboard({ x, y, className = '', children }) {
  return (
    <div className={`scene-anchor ${className}`} style={{ left: `${x}%`, top: `${y}%` }}>
      <div className="scene-billboard">{children}<i className="scene-stem" /></div>
    </div>
  );
}

export default function AgentScene({ events, devices, rooms, run, offline, focusRoom = null }) {
  const { shown, now } = useAgentScene(events);
  const answers = useNewAnswers(run);
  const visible = (id) => !focusRoom || ROOM[id] === focusRoom;

  const lines = {};
  shown.forEach((event) => {
    const line = sceneLine(event, devices);
    if (line) (lines[event.agent] ||= []).push({ key: event.id, ...line });
  });
  const pulses = shown.filter((event) => event.dir === 'out' && SPOT[event.agent] && SPOT[event.to] && visible(event.agent) && visible(event.to));
  const flashes = new Map(); // pin -> latest change
  shown.filter((event) => event.dir === 'exec').forEach((event) => {
    const flash = sceneFlash(event, devices);
    const spot = flash && devicePinSpot(rooms, flash.pin);
    if (spot && (!focusRoom || spot.room === focusRoom)) flashes.set(flash.pin, { key: event.id, ...flash, ...spot });
  });
  const llm = {}; // agent -> what its LLM is doing in the current run
  run?.steps.forEach((step, index) => {
    const seenAt = answers.get(`${run.id}-${index}`);
    if (step.status === 'running') llm[step.agent] = { thinking: true, said: step.say };
    else if (step.reply && seenAt && now - seenAt < REPLY_MS) llm[step.agent] = { reply: clip(plain(step.reply)) };
  });

  return (
    <div className="agent-scene" aria-hidden="true">
      {[...flashes.values()].map((flash) => {
        const rect = roomRect(flash.room);
        return <i key={`room-${flash.key}`} className={`scene-room ${flash.ok ? 'ok' : 'no'}`} style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }} />;
      })}
      <svg className="scene-links" viewBox="0 0 100 100" preserveAspectRatio="none">
        {pulses.map((pulse) => {
          const [from, to] = [SPOT[pulse.agent], SPOT[pulse.to]];
          return <line key={pulse.id} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} className={pulse.type === 'device.control' ? 'control' : 'context'} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      {pulses.map((pulse) => {
        const [from, to] = [SPOT[pulse.agent], SPOT[pulse.to]];
        return <i key={`dot-${pulse.id}`} className={`scene-pulse ${pulse.type === 'device.control' ? 'control' : 'context'}`} style={{ '--x1': `${from[0]}%`, '--y1': `${from[1]}%`, '--x2': `${to[0]}%`, '--y2': `${to[1]}%` }} />;
      })}
      {[...flashes.values()].map((flash) => (
        <React.Fragment key={`flash-${flash.key}`}>
          <i className={`scene-ring ${flash.ok ? 'ok' : 'no'}`} style={{ left: `${flash.x}%`, top: `${flash.y}%` }} />
          <Billboard x={flash.x} y={flash.y} className="scene-flash"><span className={`scene-tag ${flash.ok ? 'ok' : 'no'}`}>{flash.text}</span></Billboard>
        </React.Fragment>
      ))}
      {AGENT_ORDER.filter(visible).map((id) => {
        const [x, y] = SPOT[id];
        const said = lines[id]?.slice(-3) || [];
        const mind = llm[id];
        const speaking = said.length > 0 || Boolean(mind);
        return (
          <React.Fragment key={id}>
            <i className="scene-base" style={{ left: `${x}%`, top: `${y}%` }} />
            <Billboard x={x} y={y}>
              {speaking && (
                <div className="scene-bubble" style={BUBBLE_SHIFT[id] ? { '--shift': BUBBLE_SHIFT[id] } : undefined}>
                  {mind?.thinking && (
                    <>
                      {mind.said && <p className="said">“{mind.said}”</p>}
                      <p className="think"><Loader2 size={9} className="live-spin" /> 생각하는 중…</p>
                    </>
                  )}
                  {mind?.reply && <p className="reply">{mind.reply}</p>}
                  {said.map((line) => <p key={line.key} className={line.ok === false ? 'no' : ''}>{line.text}</p>)}
                </div>
              )}
              <span className={`scene-chip ${speaking ? 'speaking' : ''} ${offline.has(id) ? 'offline' : ''}`}><Bot size={10} />{shortName(id)}</span>
            </Billboard>
          </React.Fragment>
        );
      })}
    </div>
  );
}
