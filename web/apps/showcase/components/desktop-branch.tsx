"use client"

import { useState } from "react"

const services = ["Calendar", "Slack", "Mail"] as const

function MonitorIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
}

export function DesktopBranch() {
  const [selected, setSelected] = useState<(typeof services)[number]>("Calendar")

  return (
    <aside className="desktop-branch" aria-label="Desktop 연결 서비스">
      <button className="desktop-node" type="button" aria-pressed={selected === "Calendar"} onClick={() => setSelected("Calendar")}>
        <MonitorIcon />
        <strong>Desktop</strong>
      </button>
      <div className="desktop-services">
        {services.map((service) => (
          <button key={service} type="button" className={selected === service ? "is-active" : ""} onClick={() => setSelected(service)} aria-pressed={selected === service}>
            {service}
          </button>
        ))}
      </div>
    </aside>
  )
}
