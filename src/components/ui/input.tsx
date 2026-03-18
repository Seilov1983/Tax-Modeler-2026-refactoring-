import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "w-full rounded-xl border border-black/8 dark:border-white/10",
          "bg-white/80 dark:bg-white/5",
          "px-3 py-2 text-sm text-gray-900 dark:text-gray-100",
          "outline-none placeholder:text-muted-foreground",
          "focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15",
          "transition-all",
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
