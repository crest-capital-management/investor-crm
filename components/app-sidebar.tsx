"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Users, Folder, TrendingUp, Megaphone } from "lucide-react";
import { useSidebar } from "@/components/sidebar-provider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/groups", label: "Groups", icon: Folder },
  { href: "/investors", label: "Investors", icon: TrendingUp },
  { href: "/broadcasts", label: "Broadcasts", icon: Megaphone },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { isOpen, setIsOpen, close } = useSidebar();

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1024) {
        close();
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [close]);

  if (pathname === "/login") {
    return null;
  }

  const renderNavLinks = (isMobile = false) => (
    <nav className="flex flex-col gap-1">
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={isMobile ? close : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar (1024px and above) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r bg-card p-4">
        <div className="mb-4 text-lg font-semibold">Investor CRM</div>
        {renderNavLinks(false)}
        <div className="flex-1" />
      </aside>

      {/* Tablet & Mobile Drawer (below 1024px) */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="left" className="flex w-72 flex-col p-4">
          <SheetHeader className="p-0 text-left">
            <SheetTitle className="text-lg font-semibold">Investor CRM</SheetTitle>
            <SheetDescription className="sr-only">Main navigation menu</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {renderNavLinks(true)}
          </div>
          <div className="flex-1" />
        </SheetContent>
      </Sheet>
    </>
  );
}
