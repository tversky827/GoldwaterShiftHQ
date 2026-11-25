import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={cn("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b8cf0" />
          <stop offset="1" stopColor="#0060c7" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="114" fill="url(#bm)" />
      <rect x="128" y="150" width="256" height="232" rx="36" fill="none" stroke="#fff" strokeWidth="28" />
      <path d="M128 220h256" stroke="#fff" strokeWidth="28" />
      <path d="M196 118v64M316 118v64" stroke="#fff" strokeWidth="28" strokeLinecap="round" />
      <path d="m206 296 34 34 68-72" fill="none" stroke="#fff" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DemoBanner() {
  return (
    <div className="bg-[#fff8e1] px-4 py-1.5 text-center text-[12px] font-medium text-[#7a5b00]">
      Demonstration data. Facilities, employees and punches shown here are fictional.
    </div>
  );
}
