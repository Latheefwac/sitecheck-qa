import { Suspense } from "react";
import { CompareView } from "./view";

export const metadata = { title: "Compare Reports" };

export default function ComparePage() {
  return (
    <Suspense>
      <CompareView />
    </Suspense>
  );
}
