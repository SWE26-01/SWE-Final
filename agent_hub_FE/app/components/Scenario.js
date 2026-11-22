"use client";

// The plan's morning-coffee scenario, run for real and shown as one moving picture:
// Coffee Agent (made in Studio, owns nothing) --A2A device.control--> Root Agent --delegates
// (on_behalf_of)--> Kitchen Agent (owns the machine; its policy decides) --Device Gateway--> LG DUOBO.
// "지금 7:30으로 실행" starts the alarm and the request packet at once; the run itself (Hub
// POST /agents/{id}/run) answers in a moment, and the rest of the path follows what really happened,
// timed from the lines the agents reported to the Event Collector (GET /flows/{request_id}).
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.js";
import { codeText, makerText, stateText } from "../../lib/labels.js";
import { Icon, Notice, useToast } from "./ui.js";

const MACHINE = "input_boolean.kitchen_coffee_machine";
const BEANS = "input_boolean.kitchen_beans_low";
const KITCHEN_SAYS = ["원두 부족으로 표시해 줘", "원두 채웠어. 부족 표시 꺼 줘", "커피머신 꺼 줘"];

// Each phase: how long it shows, which node is busy, which edge carries a packet (and which way).
const PHASES = {
  alarm: { ms: 700, node: 0 },
  toRoot: { ms: 1000, edge: 0, dir: "fwd" },
  rootCheck: { ms: 800, node: 1 },
  toKitchen: { ms: 1000, edge: 1, dir: "fwd" },
  kitchenCheck: { ms: 800, node: 2 },
  toMachine: { ms: 1000, edge: 2, dir: "fwd" },
  brew: { ms: 1400, node: 3 },
  backKitchen: { ms: 900, edge: 1, dir: "back" },
  backRoot: { ms: 900, edge: 0, dir: "back" },
  done: { ms: 0 },
};
// Shown at once; the Root Agent keeps "working" (pulsing) until the real run has answered.
const START = ["alarm", "toRoot", "rootCheck"];

function pathFor(outcome) {
  if (!outcome.rootOk) return [...START, "backRoot", "done"];
  if (!outcome.kitchenOk) return [...START, "toKitchen", "kitchenCheck", "backKitchen", "backRoot", "done"];
  return [...START, "toKitchen", "kitchenCheck", "toMachine", "brew", "backKitchen", "backRoot", "done"];
}

/** What really happened, from the Collector lines of this request. */
function outcomeOf(events, coffeeId, results) {
  const find = (agent, dir, peer) => events.find((e) => e.agent === agent && e.dir === dir && (!peer || e.to === peer || e.from === peer));
  const rootIn = find("root", "in", coffeeId);
  const kitchenExec = find("kitchen", "exec");
  const last = results?.[0] ?? {};
  const t0 = events.length ? Date.parse(events[0].ts) : 0;
  const at = (e) => (e ? `+${Math.max(0, Date.parse(e.ts) - t0)}ms` : "");
  return {
    // Root passed it on (to the owner): its own checks were fine, whatever the owner decided.
    rootOk: Boolean(find("root", "out", "kitchen") || last.delegated_to),
    kitchenOk: kitchenExec ? kitchenExec.accepted !== false : Boolean(last.accepted),
    final: last,
    lines: {
      toRoot: at(find(coffeeId, "out")),
      // "in" lines are written when the answer is ready, so they carry no arrival time here.
      toKitchen: at(find("root", "out", "kitchen")),
      toMachine: at(kitchenExec),
      brew: at(kitchenExec),
      backKitchen: at(find("root", "out-result", "kitchen")),
      backRoot: at(find(coffeeId, "out-result")),
    },
    kitchenWhy: kitchenExec?.message || codeText(kitchenExec?.reason_code),
    rootWhy: rootIn?.message || codeText(rootIn?.reason_code),
  };
}

function describe(phase, o) {
  switch (phase) {
    case "alarm": return { text: "07:30 — Coffee Agent의 루틴 시간이 됐어요" };
    case "toRoot": return { text: "Coffee Agent → Root Agent: “커피머신 켜 줘” (A2A device.control)" };
    case "rootCheck": return o.rootOk ? { text: "Root Agent: 사용자가 승인한 요청 권한이 있어요. 커피머신의 주인을 찾아요" } : { text: `Root Agent가 거절: ${o.rootWhy}`, bad: true };
    case "toKitchen": return { text: "Root Agent → Kitchen Agent: 주인에게 위임 (Coffee Agent 대신)" };
    case "kitchenCheck": return o.kitchenOk ? { text: "Kitchen Agent: 주방 정책 확인, 원두 충분" } : { text: `Kitchen Agent가 거절: ${o.kitchenWhy || "주방 정책"}`, bad: true };
    case "toMachine": return { text: "Kitchen Agent → Device Gateway: LG DUOBO 켜기 (자기 토큰으로)" };
    case "brew": return { text: "LG DUOBO가 커피를 내려요 ☕" };
    case "backKitchen": return { text: `Kitchen → Root: ${o.kitchenOk ? "허용" : "거절"}`, bad: !o.kitchenOk };
    case "backRoot": return { text: `Root → Coffee Agent: ${codeText(o.final.reason_code) || (o.final.accepted ? "허용" : "거절")}`, bad: !o.final.accepted };
    default: return null;
  }
}

const BUBBLES = { toRoot: "커피머신 켜 줘", toKitchen: "위임", toMachine: "TURN_ON" };

function Node({ icon, title, sub, badge, state, extra }) {
  return (
    <div className={`sc-node ${state}`}>
      <span className="sc-node-icon">
        <Icon name={icon} size={26} />
        {extra}
      </span>
      <strong>{title}</strong>
      <small>{sub}</small>
      {badge && <span className="badge">{badge}</span>}
    </div>
  );
}

function Edge({ label, state, packet }) {
  return (
    <div className={`sc-edge ${state}`} aria-hidden="true">
      <span className="sc-edge-line">
        <i />
        {packet && (
          <span key={packet.key} className={`sc-packet is-${packet.dir} ${packet.bad ? "is-bad" : ""}`} style={{ animationDuration: `${packet.ms}ms` }}>
            <b>{packet.label}</b>
          </span>
        )}
      </span>
      <small>{label}</small>
    </div>
  );
}

export default function Scenario({ agents, devices, onOpenAgent, onChanged }) {
  const toast = useToast();
  const coffee = useMemo(() => {
    const askers = (agents ?? []).filter((a) => a.permissions.includes(`request:${MACHINE}`));
    return askers.find((a) => a.connected) ?? askers[0];
  }, [agents]);
  const kitchen = (agents ?? []).find((a) => a.id === "kitchen");
  const machine = devices?.find((d) => d.entity === MACHINE);
  const beans = devices?.find((d) => d.entity === BEANS);

  const [path, setPath] = useState([]); // phases to play
  const [index, setIndex] = useState(-1); // the phase now
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState(null);
  const [saying, setSaying] = useState(null);
  const run = useRef(0); // the run in progress (a new click starts over)
  const phase = path[index];
  const playing = index >= 0 && phase !== "done";

  // Advance through the path; wait after the opening phases until the real outcome is known.
  useEffect(() => {
    if (!phase || phase === "done") return undefined;
    const waiting = !outcome && index >= START.length - 1;
    if (waiting) return undefined;
    const t = window.setTimeout(() => setIndex((i) => i + 1), PHASES[phase].ms);
    return () => window.clearTimeout(t);
  }, [phase, index, outcome]);

  useEffect(() => {
    if (phase === "done") onChanged();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!coffee) return;
    const me = (run.current += 1);
    setError(null);
    setOutcome(null);
    setPath(START);
    setIndex(0);
    try {
      const { request_id: rid, results } = await api(`hub/agents/${coffee.id}/run`, { method: "POST" });
      let events = [];
      for (let i = 0; i < 8; i += 1) {
        const flow = await api(`collector/flows/${rid}`).catch(() => null);
        events = flow?.events ?? [];
        if (events.some((e) => e.agent === coffee.id && e.dir !== "out")) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      if (run.current !== me) return;
      const o = outcomeOf(events, coffee.id, results);
      setOutcome(o);
      setPath(pathFor(o));
    } catch (err) {
      if (run.current !== me) return;
      setError(err);
      setPath([]);
      setIndex(-1);
    }
  };

  const tellKitchen = async (message) => {
    setSaying(message);
    try {
      const { reply } = await api("hub/agents/kitchen/chat", { method: "POST", body: { message } });
      toast(reply.replace(/[*#|`]/g, "").slice(0, 90) || "주방 에이전트가 답했어요");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setSaying(null);
    }
  };

  const passed = path.slice(0, Math.max(index, 0));
  const seen = (name) => passed.includes(name) || phase === name;
  const bad = (name) => outcome && describe(name, outcome)?.bad;
  const nodeState = (i, check) => {
    const busy = PHASES[phase]?.node === i;
    const visited = passed.some((p) => PHASES[p].node === i || (PHASES[p].edge === i - 1 && PHASES[p].dir === "fwd"));
    return [busy ? "is-active" : "", visited ? "is-done" : "", check && bad(check) && seen(check) ? "is-bad" : ""].join(" ");
  };
  const edgeState = (i) => {
    const used = passed.filter((p) => PHASES[p].edge === i);
    const live = PHASES[phase]?.edge === i;
    const failed = used.some((p) => PHASES[p].dir === "back") && outcome && ((i === 0 && !outcome.final.accepted) || (i === 1 && !outcome.kitchenOk));
    return [used.length ? "is-done" : "", live ? "is-live" : "", failed ? "is-bad" : ""].join(" ");
  };
  const packet = (i) => {
    const p = PHASES[phase];
    if (!p || p.edge !== i) return null;
    const back = p.dir === "back";
    const label = back ? (i === 1 ? (outcome?.kitchenOk ? "OK" : "거절") : codeText(outcome?.final.reason_code) || "결과") : BUBBLES[phase];
    return { key: `${run.current}-${index}`, dir: p.dir, ms: p.ms, label, bad: back && ((i === 1 && !outcome?.kitchenOk) || (i === 0 && !outcome?.final.accepted)) };
  };
  const early = { alarm: describe("alarm", {}), toRoot: describe("toRoot", {}), rootCheck: { text: "Root Agent가 요청 권한을 확인하고 커피머신의 주인을 찾고 있어요…" } };
  const lines = path
    .slice(0, index + 1)
    .map((p) => ({ p, ...(outcome ? describe(p, outcome) : early[p]) }))
    .filter((l) => l.text);
  const brewing = phase === "brew" || (outcome?.kitchenOk && passed.includes("brew"));
  const final = phase === "done" && outcome;
  const beansLow = beans?.state === "on";

  return (
    <main className="page scenario" aria-label="Scenario">
      <section className="page-hero">
        <span className="eyebrow">SCENARIO · MORNING COFFEE</span>
        <h1>아침 7:30, 커피 한 잔</h1>
        <p>Coffee Agent는 기기를 갖지 않아요. Root Agent에게 부탁하면, Root가 커피머신의 주인인 Kitchen Agent에게 넘기고, Kitchen이 자기 정책을 확인한 뒤 LG DUOBO를 켜요.</p>
      </section>

      {!coffee && (
        <div className="panel sc-setup">
          <h3>먼저 Coffee Agent를 만들어 주세요</h3>
          <ol className="bullets">
            <li>Studio에서 <strong>“매일 아침 7시 반에 커피 내려 줘”</strong>로 만들고 승인해요.</li>
            <li>에이전트 화면에서 <strong>우리 집에 연결</strong>해요. 승인하는 권한은 “커피머신: 주인 에이전트에게 제어 요청” 하나예요.</li>
          </ol>
          <a className="primary-button" href={`/?tab=agent-studio&prompt=${encodeURIComponent("매일 아침 7시 반에 커피 내려 줘")}`}><Icon name="wand" size={16} /> Studio에서 만들기</a>
        </div>
      )}

      {coffee && (
        <>
          <section className={`panel sc-stage ${playing ? "is-playing" : ""}`} aria-label="Agents">
            <div className="sc-row">
              <Node icon="clock" title={coffee.name} sub={`Agent Cloud · ${makerText(coffee)}`} badge={phase === "alarm" ? "⏰ 07:30" : "매일 07:30"} state={nodeState(0) + (final ? (final.final.accepted ? " is-good" : " is-bad") : "")} />
              <Edge label="A2A 요청" state={edgeState(0)} packet={packet(0)} />
              <Node icon="hub" title="Root Agent" sub="거실 · 요청을 주인에게 전달" state={nodeState(1, "rootCheck")} />
              <Edge label="위임" state={edgeState(1)} packet={packet(1)} />
              <Node icon="kitchen" title="Kitchen Agent" sub="주방 · 커피머신의 주인" badge={beansLow ? "원두 부족" : "원두 충분"} state={nodeState(2, "kitchenCheck") + (beansLow ? " is-warn" : "")} />
              <Edge label="Gateway 명령" state={edgeState(2)} packet={packet(2)} />
              <Node
                icon="coffee_machine"
                title="LG DUOBO"
                sub="커피머신 (가상 기기)"
                badge={brewing ? "추출 중" : stateText(machine) || "—"}
                state={nodeState(3) + (brewing || machine?.state === "on" ? " is-good" : "")}
                extra={brewing && <span className="sc-steam"><i /><i /><i /></span>}
              />
            </div>
            <div className="sc-controls">
              <button type="button" className="primary-button" onClick={start} disabled={playing || !coffee.connected}>
                <Icon name="play" size={16} /> {playing ? "진행 중…" : index >= 0 ? "다시 실행" : "지금 7:30으로 실행"}
              </button>
              {!coffee.connected && <button type="button" className="ghost-button" onClick={() => onOpenAgent(coffee.id, "connect")}>먼저 연결하기</button>}
              <span className="muted">실제로 실행하고, 에이전트들이 남긴 기록 그대로 보여 줘요.</span>
            </div>
            <Notice error={error} />
            {final && (
              <div className={`sc-result ${final.final.accepted ? "is-good" : "is-bad"}`}>
                <Icon name={final.final.accepted ? "check" : "close"} size={20} />
                {final.final.accepted ? "LG DUOBO가 커피를 내리고 있어요." : `커피를 내리지 못했어요${beansLow || !final.kitchenOk ? ": 원두가 부족해요. 원두를 다시 주문해야 해요." : "."}`}
              </div>
            )}
          </section>

          <div className="sc-columns">
            <section className="panel" aria-label="Steps">
              <div className="panel-title"><h3>무슨 일이 있었나</h3></div>
              {lines.length === 0 && <p className="muted">“지금 7:30으로 실행”을 누르면 요청이 지나가는 길이 여기에 이어서 쌓여요.</p>}
              <ol className="timeline sc-log">
                {lines.map((l, i) => (
                  <li key={`${l.p}-${i}`} className={`${l.bad ? "is-rejected" : ""} ${i === lines.length - 1 && playing ? "is-now" : ""}`}>
                    <span className="timeline-dot" />
                    <span className="list-text"><strong>{l.text}</strong></span>
                    {outcome?.lines[l.p] && <span className="pill is-muted">{outcome.lines[l.p]}</span>}
                  </li>
                ))}
              </ol>
            </section>
            <section className="panel" aria-label="Kitchen">
              <div className="panel-title"><h3>주방 에이전트에게 말하기</h3></div>
              <p className="muted">주방 기기는 주인인 Kitchen Agent만 움직여요. 원두가 부족하면 누가 부탁해도 커피머신을 켜지 않아요.</p>
              <div className="chips sc-says">
                {KITCHEN_SAYS.map((m) => (
                  <button key={m} type="button" className="chip chip-button" disabled={Boolean(saying) || !kitchen?.connected} onClick={() => tellKitchen(m)}>
                    {saying === m ? "답을 기다리는 중…" : m}
                  </button>
                ))}
              </div>
              <button type="button" className="text-button" onClick={() => onOpenAgent(coffee.id, "overview")}>Coffee Agent 열기 <Icon name="arrow" size={14} /></button>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
