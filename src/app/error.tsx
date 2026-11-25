"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown when a page fails unexpectedly. The reference code matches the server log entry. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-caution-soft text-caution">
        <AlertTriangle className="size-6" />
      </div>
      <h1 className="text-[22px] font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-[15px] text-muted">Nothing you entered was lost. Please try again. If it keeps happening, tell your administrator.</p>
      {error.digest && <p className="mt-3 font-mono text-[12px] text-faint">Reference: {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
