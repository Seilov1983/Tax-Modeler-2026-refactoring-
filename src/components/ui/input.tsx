import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Aeros tactile: no harsh border; shadow-inner + soft glass fill = depth
          "flex h-10 w-full rounded-xl border border-transparent bg-black/5 dark:bg-white/5 px-3.5 py-1 text-sm shadow-inner",
          "text-slate-900 dark:text-slate-100",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-slate-400 dark:placeholder:text-slate-500",
          "hover:bg-black/[0.07] dark:hover:bg-white/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 focus-visible:bg-black/[0.08] dark:focus-visible:bg-white/[0.08]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
