import { BrandMark } from "@/components/brand";
import { getDb } from "@/db";
import { findInvitation } from "@/server/auth/service";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findInvitation(await getDb(), token);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-14" />
          {inv ? (
            <>
              <h1 className="mt-5 text-[28px] font-semibold tracking-tight">Welcome, {inv.user.displayName.split(" ")[0]}</h1>
              <p className="mt-1 text-[15px] text-muted">Create a password to finish setting up your account for {inv.user.email}.</p>
            </>
          ) : (
            <>
              <h1 className="mt-5 text-[28px] font-semibold tracking-tight">This link has expired</h1>
              <p className="mt-1 text-[15px] text-muted">Invitation links work once and expire after 7 days. Ask your scheduler or administrator for a new one.</p>
            </>
          )}
        </div>
        {inv && (
          <div className="rounded-3xl border border-black/[0.04] bg-surface p-7 shadow-card">
            <InviteForm token={token} />
          </div>
        )}
      </div>
    </main>
  );
}
