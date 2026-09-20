import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function FieldLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-subtle",
        className,
      )}
    >
      {children}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-[12px] border border-border bg-bg px-3 text-sm text-fg placeholder:text-subtle outline-none transition-colors duration-150 focus:border-border-strong",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-32 w-full rounded-[16px] border border-border bg-bg px-3 py-3 text-sm leading-relaxed text-fg placeholder:text-subtle outline-none transition-colors duration-150 focus:border-border-strong",
        className,
      )}
      {...props}
    />
  );
}

export function RangeInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="range"
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-accent",
        className,
      )}
      {...props}
    />
  );
}
