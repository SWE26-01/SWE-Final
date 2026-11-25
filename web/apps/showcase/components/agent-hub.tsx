"use client"

import { useState } from "react"

const agents = [
  { id: "coffee", label: "커피에이전트", icon: "coffee" },
  { id: "fitness", label: "운동에이전트", icon: "fitness" },
  { id: "schedule", label: "일정관리에이전트", icon: "calendar" },
] as const

const tools = ["layers", "energy", "security", "people"] as const
type IconName = (typeof agents)[number]["icon"] | (typeof tools)[number] | "home" | "left" | "right"

function DiagramIcon({ name }: { name: IconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
      {name === "coffee" && <><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" /><path d="M16 11h2a3 3 0 0 1 0 6h-3M8 5c-1 1-.8 2 0 3M12 4c-1 1-.8 2 0 3" /></>}
      {name === "fitness" && <><path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" /><path d="M8 7v10M16 7v10" /></>}
      {name === "calendar" && <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>}
      {name === "home" && <><path d="m4 11 8-7 8 7" /><path d="M6 10v10h12V10M10 20v-6h4v6" /></>}
      {name === "layers" && <><path d="m12 4 8 4-8 4-8-4z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" /></>}
      {name === "energy" && <path d="m13 2-8 12h6l-1 8 9-13h-6z" />}
      {name === "security" && <><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" /><path d="m9 12 2 2 4-4" /></>}
      {name === "people" && <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a5 5 0 0 1 10 0v2M16 11a3 3 0 0 0 0-6M15 15a5 5 0 0 1 6 5" /></>}
      {name === "left" && <path d="m15 5-7 7 7 7" />}
      {name === "right" && <path d="m9 5 7 7-7 7" />}
    </svg>
  )
}

export function AgentHub() {
  const [selectedAgent, setSelectedAgent] = useState(0)
  const move = (direction: number) => setSelectedAgent((current) => (current + direction + agents.length) % agents.length)

  return (
    <section className="agent-diagram" aria-label="에이전트와 스마트홈 Hub 연결">
      <div className="agent-carousel">
        <button className="carousel-arrow" type="button" onClick={() => move(-1)} aria-label="이전 에이전트"><DiagramIcon name="left" /></button>
        <div className="agent-cards">
          {agents.map((agent, index) => (
            <button key={agent.id} type="button" className={`agent-card${selectedAgent === index ? " agent-card--active" : ""}`} onClick={() => setSelectedAgent(index)} aria-pressed={selectedAgent === index}>
              <span className="agent-card__icon"><DiagramIcon name={agent.icon} /></span>
              <span>{agent.label}</span>
            </button>
          ))}
        </div>
        <button className="carousel-arrow" type="button" onClick={() => move(1)} aria-label="다음 에이전트"><DiagramIcon name="right" /></button>
      </div>

      <div className="agent-dots" aria-hidden="true">
        {agents.map((agent, index) => <i key={agent.id} className={selectedAgent === index ? "is-active" : ""} />)}
      </div>

      <div className="hub-connector hub-connector--top" aria-hidden="true" />
      <div className="hub-core">
        <div className="hub-panel">
          <div className="hub-title"><strong>Cloud</strong></div>
        </div>
        <div className="hub-connector hub-connector--bottom" aria-hidden="true" />
      </div>
    </section>
  )
}
