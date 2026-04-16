"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // Base: slightly larger & always-visible border for Liquid Glass backdrops
      "peer inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full shadow-inner transition-colors",
      "border border-slate-400/70 dark:border-slate-500/70",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      // Unchecked track: visible grey on both themes
      "data-[state=unchecked]:bg-slate-300 dark:data-[state=unchecked]:bg-slate-600",
      // Checked track: solid bright blue
      "data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-700 dark:data-[state=checked]:border-blue-400",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        // Stark white thumb with strong drop shadow — pops on both themes
        "pointer-events-none block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-0 transition-transform",
        "data-[state=checked]:translate-x-[20px] data-[state=unchecked]:translate-x-[1px]",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
