"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/components/ui/cn";

type Status = "idle" | "saving" | "saved" | "error";

/**
 * Inline label editor. Shows the value as text; click (or Tab + Enter) to
 * edit. Enter or blur saves, Escape cancels. On failure the draft stays so
 * the admin can retry.
 */
export function EditableText({
  value,
  onSave,
  label,
  maxLength,
  autoEdit = false,
  className,
}: {
  value: string;
  /** Throw with a user-facing message to report a failed save. */
  onSave: (next: string) => Promise<void>;
  /** Accessible name, e.g. "Sensor name". */
  label: string;
  maxLength?: number;
  /** Start in edit mode with the text selected (for newly added items). */
  autoEdit?: boolean;
  /** Typography for both the text and the input, so switching doesn't shift layout. */
  className?: string;
}) {
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const refocusButton = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocusButton.current) {
      refocusButton.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => setStatus("idle"), 1500);
    return () => clearTimeout(timer);
  }, [status]);

  function startEditing() {
    setDraft(value);
    setError(undefined);
    setStatus("idle");
    setEditing(true);
  }

  function cancel() {
    refocusButton.current = true;
    setDraft(value);
    setError(undefined);
    setStatus("idle");
    setEditing(false);
  }

  async function commit(fromKeyboard: boolean) {
    if (saving.current) return;
    const next = draft.trim();
    if (next === value) {
      refocusButton.current = fromKeyboard;
      setError(undefined);
      setStatus("idle");
      setEditing(false);
      return;
    }
    if (!next) {
      setStatus("error");
      setError(`${label} can't be empty.`);
      return;
    }

    saving.current = true;
    setStatus("saving");
    setError(undefined);
    try {
      await onSave(next);
      refocusButton.current = fromKeyboard;
      setStatus("saved");
      setEditing(false);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error && err.message ? err.message : "Couldn't save.");
    } finally {
      saving.current = false;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  return (
    <span className="inline-flex min-w-0 max-w-full flex-col">
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          aria-label={label}
          aria-invalid={status === "error" || undefined}
          aria-busy={status === "saving" || undefined}
          value={draft}
          maxLength={maxLength}
          readOnly={status === "saving"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => void commit(false)}
          className={cn(
            "-mx-1.5 min-w-0 rounded border border-brand bg-surface px-1.5 py-0.5 text-ink outline-none",
            status === "saving" && "opacity-60",
            status === "error" && "border-critical",
            className,
          )}
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={startEditing}
          aria-label={`${label}: ${value}. Press Enter to edit.`}
          className={cn(
            "group -mx-1.5 inline-flex min-w-0 items-baseline gap-2 rounded border border-transparent px-1.5 py-0.5 text-left text-ink hover:border-line hover:bg-sunken",
            className,
          )}
        >
          <span className="truncate">{value}</span>
          <span aria-hidden className="text-xs font-normal text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
            Edit
          </span>
        </button>
      )}
      <span aria-live="polite" className="text-xs">
        {status === "saving" && <span className="text-muted">Saving…</span>}
        {status === "saved" && <span className="text-ok">Saved</span>}
        {status === "error" && error && (
          <span className="text-critical">
            {error} {editing && "Press Enter to retry or Esc to cancel."}
          </span>
        )}
      </span>
    </span>
  );
}
