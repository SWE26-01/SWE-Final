// Drop-down in the app's own style (the browser's <select> list can't be styled). Works like a
// listbox: arrow keys, Home/End, Enter/Space to pick, Escape or a click outside to close.
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

/** options: [{ value, label }]; onChange gets the picked value. */
export default function Select({ value, options, onChange, label, disabled = false, className = '' }) {
  const id = useId();
  const root = useRef(null);
  const list = useRef(null);
  const button = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return undefined;
    list.current?.focus();
    const close = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const show = () => { setActive(selected); setOpen(true); };
  const pick = (index) => {
    setOpen(false);
    button.current?.focus();
    if (options[index] && options[index].value !== value) onChange(options[index].value);
  };
  const onButtonKey = (event) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); }
  };
  const onListKey = (event) => {
    const last = options.length - 1;
    const moves = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last };
    if (event.key in moves) { event.preventDefault(); setActive(moves[event.key]); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(active); }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); }
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div className={`ui-select ${open ? 'open' : ''} ${className}`} ref={root}>
      <button
        type="button"
        ref={button}
        className="ui-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onButtonKey}
      >
        <span>{options[selected]?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <ul className="ui-select-list" role="listbox" aria-label={label} ref={list} tabIndex={-1} aria-activedescendant={`${id}-${active}`} onKeyDown={onListKey}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === selected}
              className={`${index === active ? 'active' : ''} ${index === selected ? 'selected' : ''}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(index)}
            >
              <span>{option.label}</span>
              {index === selected && <Check size={13} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
