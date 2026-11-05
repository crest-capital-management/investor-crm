"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, User } from "lucide-react";
import { getSession } from "next-auth/react";
import { NotificationBell } from "@/components/notification-bell";
import { useSidebar } from "@/components/sidebar-provider";
import { cn } from "@/lib/utils";
import { isPublicPath } from "@/lib/public-routes";

import { getUserDisplayName, getUserInitials } from "@/lib/user";

function getInitialsFromUser(user: {
  email?: string | null;
  name?: string | null;
} | null | undefined): string {
  if (!user) return "";
  const displayName = getUserDisplayName(user);
  return getUserInitials(displayName);
}

export function TopNav() {
  const pathname = usePathname();
  const [initials, setInitials] = useState<string | null>(null);
  const { toggle } = useSidebar();

  // Re-read on navigation so the initials appear right after logging in and clear after logging out.
  useEffect(() => {
    let cancelled = false;
    getSession().then((session) => {
      if (!cancelled) setInitials(session?.user ? getInitialsFromUser(session.user) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (isPublicPath(pathname)) {
    return null;
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:hidden cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span
          className="text-3xl text-foreground tracking-wide select-none"
          style={{ fontFamily: "var(--font-maharlika), var(--font-playfair), 'Playfair Display', Georgia, serif", fontWeight: 400 }}
        >
          CREST
        </span>
      </div>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <Link
          href="/my-profile"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
            initials
              ? "bg-primary/10 text-xs font-semibold text-primary hover:bg-accent hover:text-accent-foreground"
              : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
          title="My Profile"
        >
          {initials ? initials : <User className="h-4 w-4" />}
        </Link>
      </div>
    </header>
  );
}
