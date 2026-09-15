"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent, type Ref } from "react";
import {
  cancelNewPassword,
  setNewPassword,
  signIn,
  type NewPasswordState,
  type SignInState,
} from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { PASSWORD_POLICY } from "@/lib/auth/password-policy";

export type LoginStep = "sign-in" | "new-password";

const inputClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus-visible:border-brand";

export function LoginPanel({ initialStep, notice }: { initialStep: LoginStep; notice?: string }) {
  const [step, setStep] = useState<LoginStep>(initialStep);

  return (
    <Card className="w-full max-w-sm shadow-sm">
      <CardContent className="flex flex-col gap-6 px-6 pt-7 pb-7 sm:px-8">
        <div className="flex flex-col gap-1">
          <span className="font-display text-2xl font-semibold tracking-tight text-brand">CTM365</span>
          <span className="text-sm text-muted">Continuous thermal monitoring</span>
        </div>

        {notice && step === initialStep && (
          <p role="status" className="rounded-md bg-brand-soft px-3 py-2 text-sm text-brand">
            {notice}
          </p>
        )}

        {step === "sign-in" ? (
          <SignInForm onNewPasswordRequired={() => setStep("new-password")} />
        ) : (
          <NewPasswordForm onCancel={() => setStep("sign-in")} />
        )}
      </CardContent>
    </Card>
  );
}

function SignInForm({ onNewPasswordRequired }: { onNewPasswordRequired: () => void }) {
  const [email, setEmail] = useState("");
  const [state, dispatch, pending] = useActionState(
    async (prev: SignInState, formData: FormData) => {
      const next = await signIn(prev, formData);
      if (next.status === "new-password") onNewPasswordRequired();
      return next;
    },
    { status: "idle" },
  );

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Dispatch manually so React doesn't reset the form (and the email) after an error.
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return (
    <form action={dispatch} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h1 className="font-display text-lg font-semibold text-ink">Sign in</h1>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-ink">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>

      <PasswordField id="password" name="password" label="Password" autoComplete="current-password" />

      <ErrorArea message={state.status === "error" ? state.message : undefined} />

      <Button type="submit" disabled={pending} className="h-10 w-full">
        {pending && <Spinner />}
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-xs text-muted">Need access? Contact your CTM365 administrator.</p>
    </form>
  );
}

function NewPasswordForm({ onCancel }: { onCancel: () => void }) {
  const [newPassword, setNewPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [clientError, setClientError] = useState<string>();
  const confirmRef = useRef<HTMLInputElement>(null);
  const [state, dispatch, pending] = useActionState<NewPasswordState, FormData>(setNewPassword, { status: "idle" });
  const [cancelling, setCancelling] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newPassword) {
      setClientError("Enter a new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setClientError("The passwords don't match.");
      confirmRef.current?.focus();
      return;
    }
    setClientError(undefined);
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  async function cancel() {
    setCancelling(true);
    try {
      await cancelNewPassword();
    } finally {
      onCancel();
    }
  }

  const error = clientError ?? (state.status === "error" ? state.message : undefined);

  return (
    <form action={dispatch} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-lg font-semibold text-ink">Set a new password</h1>
        <p className="text-sm text-muted">
          This is your first sign-in, so you need to replace your temporary password.
        </p>
      </div>

      <PasswordField
        id="new-password"
        name="newPassword"
        label="New password"
        autoComplete="new-password"
        value={newPassword}
        onChange={setNewPasswordValue}
        describedBy="password-policy"
      />
      <PasswordField
        id="confirm-password"
        name="confirmPassword"
        label="Confirm new password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        inputRef={confirmRef}
        invalid={clientError === "The passwords don't match."}
      />

      <p id="password-policy" className="text-xs text-muted">
        {PASSWORD_POLICY}
      </p>

      <ErrorArea message={error} />

      <Button type="submit" disabled={pending || cancelling} className="h-10 w-full">
        {pending && <Spinner />}
        {pending ? "Saving…" : "Set password and sign in"}
      </Button>
      <Button type="button" variant="ghost" onClick={cancel} disabled={pending || cancelling} className="w-full">
        Back to sign in
      </Button>
    </form>
  );
}

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  value,
  onChange,
  describedBy,
  inputRef,
  invalid,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  value?: string;
  onChange?: (value: string) => void;
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={256}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={onChange && ((e) => onChange(e.target.value))}
          className={cn(inputClass, "pr-16", invalid && "border-critical")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-controls={id}
          aria-pressed={visible}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-1 right-1 rounded px-2.5 text-xs font-medium text-muted hover:bg-sunken hover:text-ink"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

function ErrorArea({ message }: { message?: string }) {
  // The live region stays mounted so screen readers announce new messages.
  return (
    <div aria-live="assertive" aria-atomic="true">
      {message && (
        <p className="rounded-md bg-critical-soft px-3 py-2 text-sm text-critical">
          {message}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
    />
  );
}
