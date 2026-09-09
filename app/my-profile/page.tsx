"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/src/lib/supabase/client";

export default function MyProfilePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">My Profile</h1>
      <p className="text-muted-foreground mt-2">{email ?? "Loading..."}</p>
      <Button type="button" variant="outline" className="mt-6" onClick={handleLogout}>
        Log Out
      </Button>
    </div>
  );
}
