"use client";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export const TabsList = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) => <TabsPrimitive.List className={cn("inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground overflow-x-auto max-w-full", className)} {...p} />;
export const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger className={cn("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm cursor-pointer", className)} {...p} />
);
export const TabsContent = ({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Content>) => <TabsPrimitive.Content className={cn("mt-4 focus-visible:outline-none", className)} {...p} />;
