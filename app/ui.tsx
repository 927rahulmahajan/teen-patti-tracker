// Shared-phone UI primitives: large touch targets, high contrast. Hand-rolled
// Tailwind — no shadcn/ui, no Radix. ponytail: add a component lib only if the
// component count ever outgrows these few.
import { forwardRef } from "react";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
};

export function Button({ variant = "primary", className = "", ...props }: BtnProps) {
  const base =
    "min-h-14 rounded-2xl px-5 text-lg font-semibold transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100";
  const styles = {
    primary: "bg-amber-400 text-black hover:bg-amber-300",
    ghost: "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
    danger: "bg-neutral-800 text-red-400 hover:bg-neutral-700",
  }[variant];
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return (
      <input
        ref={ref}
        className={`min-h-14 w-full rounded-2xl bg-neutral-800 px-4 text-lg text-neutral-100 placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-amber-400 ${className}`}
        {...props}
      />
    );
  },
);

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex min-h-14 w-full items-center justify-between rounded-2xl bg-neutral-800 px-4 text-lg text-neutral-100"
    >
      <span>{label}</span>
      <span
        className={`h-7 w-12 rounded-full p-1 transition ${checked ? "bg-amber-400" : "bg-neutral-600"}`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white transition ${checked ? "translate-x-5" : ""}`}
        />
      </span>
    </button>
  );
}
