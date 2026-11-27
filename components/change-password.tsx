"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { KeyRound, Loader2 } from "lucide-react";

import { changeOwnPassword } from "@/app/my-profile/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * My Profile: change your own password. Afterwards every session of the
 * account ends (this one too), so the user is signed out and signs in again
 * with the new password.
 */
export function ChangePassword() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(value: boolean) {
    if (saving || done) return;
    setOpen(value);
    setCurrent("");
    setNext("");
    setRepeat("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (next.length < 12) return setError("The new password must be at least 12 characters.");
    if (next !== repeat) return setError("The two new passwords are not the same.");

    setSaving(true);
    const result = await changeOwnPassword(current, next, repeat);
    setSaving(false);
    if (result.error) {
      setCurrent("");
      setError(result.error);
      return;
    }
    setDone(true);
    // The change ended this session too: sign out and go to the login page.
    setTimeout(async () => {
      await signOut({ redirect: false });
      router.replace("/login");
      router.refresh();
    }, 2000);
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => handleOpenChange(true)}>
        <KeyRound className="h-3.5 w-3.5" />
        Change password
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              At least 12 characters. Afterwards you are signed out on every device, this one too, and sign
              in again with the new password.
            </DialogDescription>
          </DialogHeader>

          {done ? (
            <p role="status" className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">
              Password changed. Signing you out…
            </p>
          ) : (
            <form id="change-password-form" onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="current-password" className="text-sm">
                  Current password
                </label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  disabled={saving}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="new-password" className="text-sm">
                  New password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  disabled={saving}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="repeat-password" className="text-sm">
                  New password again
                </label>
                <Input
                  id="repeat-password"
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  disabled={saving}
                  required
                />
              </div>
              {error && (
                <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </p>
              )}
            </form>
          )}

          {!done && (
            <DialogFooter>
              <DialogClose render={<Button variant="outline" disabled={saving} />}>Cancel</DialogClose>
              <Button type="submit" form="change-password-form" disabled={saving || !current || !next || !repeat}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? "Changing…" : "Change password"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
