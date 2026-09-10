"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, User } from "lucide-react";
import { createClient } from "@/src/lib/supabase/client";
import { useSidebar } from "@/components/sidebar-provider";
import { cn } from "@/lib/utils";

function getInitialsFromUser(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
} | null): string {
  if (!user) return "";
  const meta = user.user_metadata ?? {};
  const rawName = String(meta.full_name || meta.name || "").trim();
  const email = user.email ?? "";

  let displayName = rawName;
  if (!displayName && email) {
    const handle = email.split("@")[0] || "";
    displayName = handle
      .split(/[._-]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }
  if (!displayName) {
    displayName = "User";
  }

  const nameParts = displayName.trim().split(/\s+/);
  let initials = "U";
  if (nameParts.length >= 2) {
    initials = `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase();
  } else if (nameParts[0]) {
    initials = nameParts[0].slice(0, 2).toUpperCase();
  }
  return initials;
}

export function TopNav() {
  const pathname = usePathname();
  const [initials, setInitials] = useState<string | null>(null);
  const { toggle } = useSidebar();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setInitials(getInitialsFromUser(data.user));
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setInitials(getInitialsFromUser(session.user));
      } else {
        setInitials(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (pathname === "/login") {
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
          style={{ fontFamily: "var(--font-playfair), 'Playfair Display', Georgia, serif", fontWeight: 400 }}
        >
          CREST
        </span>
      </div>
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
    </header>
  );
}
