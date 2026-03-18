import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-lg px-2.5 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        secondary: "bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300",
        destructive: "bg-red-500/10 text-red-600 dark:text-red-400",
        warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        success: "bg-green-500/10 text-green-600 dark:text-green-400",
        outline: "border border-black/8 dark:border-white/10 text-gray-600 dark:text-gray-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
