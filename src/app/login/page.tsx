import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense><LoginForm /></Suspense>
    </div>
  );
}
