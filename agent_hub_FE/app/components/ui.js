"use client";

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.2 4.2" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13m-5-5 5 5-5 5" />
    </svg>
  );
}

/** ✦ for the home's own agents, ✧ for agents made in Studio, ◇ for external ones. */
export function agentSymbol(agent) {
  return { studio: "✧", external: "◇" }[agent?.origin] ?? "✦";
}

export function Notice({ error, children, tone = "error" }) {
  const text = error?.message ?? children;
  if (!text) return null;
  return (
    <p className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {text}
    </p>
  );
}

export function Status({ online }) {
  if (online === undefined) return null;
  return (
    <span className={`my-agent-status ${online ? "" : "is-offline"}`}>
      <i />
      {online ? "Online" : "Offline"}
    </span>
  );
}

export function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}
