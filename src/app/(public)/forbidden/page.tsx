import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "No access" };

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-fill text-muted">
        <Lock className="size-6" />
      </div>
      <h1 className="mt-5 text-[24px] font-semibold tracking-tight">You don’t have access to this page</h1>
      <p className="mt-1 max-w-sm text-[15px] text-muted">If you think you should, ask a corporate administrator to update your role.</p>
      <Button asChild className="mt-6">
        <Link href="/">Go to my home</Link>
      </Button>
    </main>
  );
}
