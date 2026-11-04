"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    await signOut({ redirect: false });
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
      onClick={handleLogout}
      disabled={isLoggingOut}
    >
      <LogOut className="h-3.5 w-3.5" />
      {isLoggingOut ? "Logging out..." : "Log Out"}
    </Button>
  );
}
