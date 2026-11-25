"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function NavLink({ href, children, exact, className, activeClassName }: { href: string; children: ReactNode; exact?: boolean; className?: string; activeClassName?: string }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn(className, active && activeClassName)}>
      {children}
    </Link>
  );
}

export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
