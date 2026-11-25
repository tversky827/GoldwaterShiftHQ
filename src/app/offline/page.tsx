export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[24px] font-semibold tracking-tight">You’re offline</h1>
      <p className="mt-1 max-w-sm text-[15px] text-muted">Reconnect to see your latest schedule. Schedules aren’t stored on this device, so you always see current information.</p>
    </main>
  );
}
