"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";

export function TopNav() {
  const pathname = usePathname();

  if (pathname === "/login") {
    return null;
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4">
      <span
        className="text-3xl text-foreground tracking-wide"
        style={{ fontFamily: "var(--font-playfair), 'Playfair Display', Georgia, serif", fontWeight: 400 }}
      >
        CREST
      </span>
      <Link
        href="/my-profile"
        className="flex h-9 w-9 items-center justify-center rounded-full border bg-background hover:bg-accent"
      >
        <User className="h-4 w-4" />
      </Link>
    </header>
  );
}
