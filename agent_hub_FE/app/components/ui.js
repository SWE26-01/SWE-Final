"use client";

// The screen's building blocks: sheets (a drawer on wide screens, a bottom sheet on phones), modals,
// a confirm dialog, toasts, segmented controls and agent avatars. Used by the Hub and the /home app.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Icon, agentIcon } from "../home/icons.js";

export { Icon };

export function SearchIcon() {
  return <Icon name="search" size={18} />;
}

export function ArrowIcon() {
  return <Icon name="arrow" size={18} />;
}

/** Kept for older callers: a text mark for an agent. */
export function agentSymbol(agent) {
  return { studio: "✧", external: "◇" }[agent?.origin] ?? "✦";
}

export function AgentAvatar({ agent, size = "md" }) {
  return (
    <span className={`avatar avatar-${size} avatar-${agent?.origin ?? "platform"}`} aria-hidden="true">
      <Icon name={agent ? agentIcon(agent) : "hub"} size={size === "lg" ? 28 : size === "sm" ? 16 : 20} />
    </span>
  );
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

/** Running (Online), not answering (Offline); nothing while unknown. */
export function Status({ online }) {
  if (online === undefined) return null;
  return (
    <span className={`status ${online ? "is-online" : "is-offline"}`}>
      <i />
      {online ? "Online" : "Offline"}
    </span>
  );
}

// Open overlays, innermost last: Escape closes only the top one (a confirm over a sheet).
const overlays = [];

/** Close on Escape when this is the top overlay, and keep the page behind it from scrolling. */
export function useEscape(onClose) {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const entry = { close: () => latest.current?.() };
    overlays.push(entry);
    const esc = (e) => {
      if (e.key === "Escape" && overlays[overlays.length - 1] === entry) {
        e.stopPropagation();
        entry.close();
      }
    };
    window.addEventListener("keydown", esc);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      overlays.splice(overlays.indexOf(entry), 1);
      document.body.style.overflow = overflow;
    };
  }, []);
}

export function Modal({ title, children, onClose, actions, tone }) {
  useEscape(onClose);
  return (
    <div className="overlay overlay-center" role="presentation" onClick={onClose}>
      <section className={`modal ${tone ? `modal-${tone}` : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <strong>{title}</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><Icon name="close" size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {actions && <footer className="modal-actions">{actions}</footer>}
      </section>
    </div>
  );
}

/** A drawer from the right on wide screens, a bottom sheet on phones. */
export function Sheet({ title, onClose, header, children, label }) {
  useEscape(onClose);
  return (
    <div className="overlay overlay-sheet" role="presentation" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={label ?? title} onClick={(e) => e.stopPropagation()}>
        <span className="sheet-grabber" aria-hidden="true" />
        <header className="sheet-head">
          {header ?? <strong>{title}</strong>}
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><Icon name="close" size={18} /></button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

/** [dialog, ask]: `await ask({title, body, confirm, danger})` resolves true when confirmed. */
export function useConfirm() {
  const [pending, setPending] = useState(null);
  const ask = useCallback((opts) => new Promise((resolve) => setPending({ ...opts, resolve })), []);
  const done = (answer) => {
    pending?.resolve(answer);
    setPending(null);
  };
  const dialog = pending && (
    <Modal
      title={pending.title}
      tone={pending.danger ? "danger" : undefined}
      onClose={() => done(false)}
      actions={
        <>
          <button type="button" className="ghost-button" onClick={() => done(false)}>{pending.cancel ?? "취소"}</button>
          <button type="button" className={pending.danger ? "danger-button" : "primary-button"} onClick={() => done(true)} autoFocus>{pending.confirm ?? "확인"}</button>
        </>
      }
    >
      {typeof pending.body === "string" ? <p>{pending.body}</p> : pending.body}
    </Modal>
  );
  return [dialog, ask];
}

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((text, tone = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === "error" ? "close" : "check"} size={16} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** show(text, tone?): a short message at the bottom. A no-op outside a ToastProvider. */
export const useToast = () => useContext(ToastContext);

export function Segmented({ items, value, onChange, label, size }) {
  return (
    <div className={`segmented ${size ? `segmented-${size}` : ""}`} role="tablist" aria-label={label}>
      {items.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} className={value === id ? "active" : ""} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
