import { useCallback, useEffect, useId, useRef, useState } from "react";

// A replacement for <select>.
//
// The native element cannot be styled where it matters: the popup list is drawn by the
// operating system, so it ignores the app's palette entirely and looks like a stray
// piece of another program — especially in dark mode. This renders the list itself,
// which means keyboard handling and dismissal have to be implemented rather than
// inherited, so both are done properly below.

interface DropdownProps {
  value: string;
  options: string[];
  disabled?: boolean;
  /** Accessible name, since there is no <label> association to inherit. */
  label: string;
  title?: string;
  onChange: (value: string) => void;
}

export function Dropdown({
  value,
  options,
  disabled = false,
  label,
  title,
  onChange,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openList = useCallback(() => {
    const current = options.indexOf(value);
    setActiveIndex(current >= 0 ? current : 0);
    setOpen(true);
  }, [options, value]);

  const commit = useCallback(
    (next: string) => {
      if (next !== value) onChange(next);
      close(true);
    },
    [value, onChange, close],
  );

  // Dismiss on an outside press or on losing window focus. Pointerdown rather than
  // click, so the list closes on press instead of lingering until release.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onWindowBlur() {
      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [open]);

  // Keep the highlighted row visible when moving through a long list by keyboard.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openList();
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (options[activeIndex] !== undefined) commit(options[activeIndex]);
        break;
      case "Tab":
        // Let focus leave, but do not leave a floating panel behind.
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={open ? "dropdown-trigger open" : "dropdown-trigger"}
        disabled={disabled}
        title={title}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="dropdown-value">{value}</span>
        <span className="dropdown-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <ul
          id={listId}
          ref={listRef}
          className="dropdown-panel"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <li
              key={option}
              role="option"
              aria-selected={option === value}
              className={
                "dropdown-option" +
                (index === activeIndex ? " active" : "") +
                (option === value ? " selected" : "")
              }
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => commit(option)}
            >
              <span className="dropdown-check" aria-hidden="true">
                {option === value ? "✓" : ""}
              </span>
              <span className="dropdown-option-label">{option}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
