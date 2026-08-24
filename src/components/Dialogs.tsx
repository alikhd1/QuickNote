import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { AttachMode } from "../types";

// The webview offers no window.prompt or window.confirm, so these are built on the
// native <dialog> element and handed back to callers as promises.

type Pending =
  | {
      kind: "ask";
      title: string;
      okLabel: string;
      initial: string;
      resolve: (value: string | null) => void;
    }
  | {
      kind: "confirm";
      title: string;
      body: string;
      okLabel: string;
      resolve: (value: boolean) => void;
    }
  | { kind: "choose"; title: string; body: string; resolve: (value: AttachMode) => void };

export interface Dialogs {
  ask: (title: string, okLabel?: string, initial?: string) => Promise<string | null>;
  confirm: (title: string, body: string, okLabel?: string) => Promise<boolean>;
  choose: (title: string, body: string) => Promise<AttachMode>;
  element: ReactNode;
}

export function useDialogs(): Dialogs {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback(
    (title: string, okLabel = "OK", initial = "") =>
      new Promise<string | null>((resolve) =>
        setPending({ kind: "ask", title, okLabel, initial, resolve }),
      ),
    [],
  );

  const confirm = useCallback(
    (title: string, body: string, okLabel = "Delete") =>
      new Promise<boolean>((resolve) =>
        setPending({ kind: "confirm", title, body, okLabel, resolve }),
      ),
    [],
  );

  const choose = useCallback(
    (title: string, body: string) =>
      new Promise<AttachMode>((resolve) =>
        setPending({ kind: "choose", title, body, resolve }),
      ),
    [],
  );

  const element = (
    <DialogHost pending={pending} onClosed={() => setPending(null)} />
  );

  return { ask, confirm, choose, element };
}

function DialogHost({
  pending,
  onClosed,
}: {
  pending: Pending | null;
  onClosed: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (pending) {
      setText(pending.kind === "ask" ? pending.initial : "");
      dialog.returnValue = "cancel";
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [pending]);

  // Every exit route lands here: a submit button sets returnValue, and Esc leaves the
  // "cancel" we primed above. One handler means the promise is settled exactly once.
  function handleClose() {
    if (!pending) return;
    const result = ref.current?.returnValue ?? "cancel";

    if (pending.kind === "ask") {
      const trimmed = text.trim();
      pending.resolve(result === "ok" && trimmed ? trimmed : null);
    } else if (pending.kind === "confirm") {
      pending.resolve(result === "ok");
    } else {
      pending.resolve(result === "copy" || result === "link" ? result : "cancel");
    }
    onClosed();
  }

  // Pulled out of the JSX so each narrowing is a single plain check TypeScript can
  // follow: every variant has `title`, everything but "ask" has `body`, and everything
  // but "choose" has `okLabel`.
  const title = pending?.title ?? "";
  const body = pending && pending.kind !== "ask" ? pending.body : null;
  const okLabel = pending && pending.kind !== "choose" ? pending.okLabel : "OK";

  return (
    <dialog ref={ref} onClose={handleClose}>
      <form method="dialog" className="dialog-form">
        <h3>{title}</h3>

        {pending?.kind === "ask" ? (
          <input
            type="text"
            autoComplete="off"
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        ) : null}

        {body ? <p className="dialog-body">{body}</p> : null}

        <menu>
          {pending?.kind === "choose" ? (
            <>
              <button value="copy" className="primary" type="submit">
                Copy into notes
              </button>
              <button value="link" type="submit">
                Link where it is
              </button>
            </>
          ) : (
            <button
              value="ok"
              className={pending?.kind === "confirm" ? "danger" : "primary"}
              type="submit"
            >
              {okLabel}
            </button>
          )}
          <button value="cancel" className="ghost" type="submit">
            Cancel
          </button>
        </menu>
      </form>
    </dialog>
  );
}
