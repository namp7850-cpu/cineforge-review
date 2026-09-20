import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[opacity,transform,background-color,color,border-color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-fg hover:opacity-90 shadow-[0_1px_0_rgb(255_255_255/0.12)_inset]",
        secondary:
          "bg-surface-2 text-fg border border-border hover:border-border-strong",
        ghost: "bg-transparent text-muted hover:text-fg hover:bg-surface",
        rec: "bg-rec text-fg hover:opacity-90",
      },
      size: {
        sm: "h-9 rounded-[8px] px-3 text-xs",
        md: "h-11 rounded-[12px] px-4 text-sm",
        lg: "h-12 rounded-[14px] px-5 text-sm",
        icon: "size-11 rounded-[12px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
