import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = ({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn("flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50", className)} {...p} />
);
export const Textarea = ({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn("flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...p} />
);
export const Label = ({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label className={cn("text-xs font-medium text-foreground", className)} {...p} />;
export const NativeSelect = ({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn("h-9 rounded-md border border-input bg-card px-2.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...p} />
);
