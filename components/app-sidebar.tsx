"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/contacts", label: "Contacts" },
  { href: "/groups", label: "Groups" },
  { href: "/investors", label: "Investors" },
];

export function AppSidebar() {
  const pathname = usePathname();

  if (pathname === "/login") {
    return null;
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card p-4">
      <div className="mb-4 text-lg font-semibold">Investor CRM</div>
      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1" />
    </aside>
  );
}
