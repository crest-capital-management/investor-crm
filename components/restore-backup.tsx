"use client";

import { useState } from "react";
import { AlertTriangle, History, Loader2 } from "lucide-react";

import {
  listStoredBackups,
  previewRestore,
  restoreFromBackup,
  type RestorePreview,
  type StoredBackup,
} from "@/app/settings/backup-actions";
import { backupLabel } from "@/components/stored-backups";
import { useToast } from "@/components/toast-provider";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Source = "stored" | "file";

/** Gzips the chosen file in the browser (unless it already is) and uploads it; returns its stored name. */
async function uploadBackupFile(file: File): Promise<string> {
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const isGzip = header[0] === 0x1f && header[1] === 0x8b;
  const body = isGzip ? file : await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();

  const response = await fetch("/api/backup/upload", {
    method: "PUT",
    headers: { "Content-Type": "application/gzip" },
    body,
  });
  const result = (await response.json().catch(() => ({}))) as { name?: string; error?: string };
  if (!response.ok || !result.name) throw new Error(result.error ?? "The file could not be uploaded.");
  return result.name;
}

function formatExportedAt(value: string | null) {
  if (!value) return "unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Replaces all CRM data with a backup: pick a saved backup or upload one,
 * see what it contains, type RESTORE. A safety backup is saved first.
 */
export function RestoreBackup() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>("stored");
  const [backups, setBackups] = useState<StoredBackup[] | null>(null);
  const [selected, setSelected] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The backup that was checked (its stored name) and what it holds.
  const [checked, setChecked] = useState<{ name: string; preview: RestorePreview } | null>(null);
  const [confirmation, setConfirmation] = useState("");

  const busy = checking || restoring;

  function reset() {
    setSource("stored");
    setSelected("");
    setFile(null);
    setError(null);
    setChecked(null);
    setConfirmation("");
  }

  async function handleOpenChange(next: boolean) {
    if (busy) return;
    setOpen(next);
    if (!next) {
      reset();
      return;
    }
    const result = await listStoredBackups();
    setBackups(result.backups ?? []);
    if (result.error) setError(result.error);
  }

  function changeSource(next: Source) {
    setSource(next);
    setChecked(null);
    setConfirmation("");
    setError(null);
  }

  async function handleCheck() {
    setError(null);
    setChecked(null);
    setConfirmation("");
    setChecking(true);
    try {
      let name = selected;
      if (source === "file") {
        if (!file) return;
        name = await uploadBackupFile(file);
      }
      if (!name) return;
      const result = await previewRestore(name);
      if (!result.preview) {
        setError(result.error ?? "The backup could not be read.");
        return;
      }
      setChecked({ name, preview: result.preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The backup could not be checked.");
    } finally {
      setChecking(false);
    }
  }

  async function handleRestore() {
    if (!checked || confirmation.trim() !== "RESTORE") return;
    setError(null);
    setRestoring(true);
    const result = await restoreFromBackup(checked.name, confirmation);
    if (result.error) {
      setRestoring(false);
      setError(result.error);
      return;
    }
    toast("Backup restored. Your previous data was saved as a safety backup.");
    // Reload so every page shows the restored data.
    window.location.reload();
  }

  const items = Object.fromEntries((backups ?? []).map((b) => [b.name, backupLabel(b)]));
  const canCheck = !busy && (source === "stored" ? Boolean(selected) : Boolean(file));

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Restore from backup</p>
          <p className="text-xs text-muted-foreground">
            Replace all CRM data with a saved backup or a backup file. A safety backup of the current
            data is saved first. Logins are not affected.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => handleOpenChange(true)}>
          <History className="size-4" />
          Restore…
        </Button>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Restore from backup</DialogTitle>
            <DialogDescription>
              This replaces <strong>all</strong> contacts, groups, notes, follow-ups, templates, broadcasts,
              WhatsApp messages, portfolio updates and settings with the backup. Anything added after the
              backup was taken is removed. Nothing changes until you type RESTORE and confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="restore-source"
                  checked={source === "stored"}
                  onChange={() => changeSource("stored")}
                  disabled={busy}
                  className="accent-primary"
                />
                A saved backup
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="restore-source"
                  checked={source === "file"}
                  onChange={() => changeSource("file")}
                  disabled={busy}
                  className="accent-primary"
                />
                A file from your computer
              </label>
            </div>

            {source === "stored" ? (
              backups === null ? (
                <p className="text-xs text-muted-foreground">Loading backups…</p>
              ) : backups.length === 0 ? (
                <p className="text-xs text-muted-foreground">There are no saved backups yet.</p>
              ) : (
                <Select
                  items={items}
                  value={selected}
                  onValueChange={(value) => {
                    setSelected(value ?? "");
                    setChecked(null);
                    setConfirmation("");
                  }}
                  disabled={busy}
                >
                  <SelectTrigger className="w-full" aria-label="Saved backup">
                    <SelectValue placeholder="Choose a backup" />
                  </SelectTrigger>
                  <SelectContent>
                    {backups.map((backup) => (
                      <SelectItem key={backup.name} value={backup.name}>
                        {backupLabel(backup)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            ) : (
              <div className="space-y-1">
                <Input
                  type="file"
                  accept=".json,.gz,application/json,application/gzip"
                  disabled={busy}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setChecked(null);
                    setConfirmation("");
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  A backup downloaded from this page (.json or .json.gz).
                </p>
              </div>
            )}

            {!checked && (
              <Button type="button" variant="outline" onClick={handleCheck} disabled={!canCheck}>
                {checking && <Loader2 className="size-4 animate-spin" />}
                {checking ? "Checking backup…" : "Check backup"}
              </Button>
            )}

            {checked && (
              <div className="space-y-3">
                <p className="text-sm">
                  Backup taken <strong>{formatExportedAt(checked.preview.exportedAt)}</strong>.
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 font-normal"></th>
                      <th className="py-1 text-right font-normal">In the backup</th>
                      <th className="py-1 text-right font-normal">In the CRM now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {checked.preview.tables.map((row) => (
                      <tr key={row.table}>
                        <td className="py-1">{row.label}</td>
                        <td className="py-1 text-right tabular-nums">{row.inBackup ?? "—"}</td>
                        <td className="py-1 text-right tabular-nums text-muted-foreground">{row.current ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {checked.preview.warnings.length > 0 && (
                  <ul className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                    {checked.preview.warnings.map((warning) => (
                      <li key={warning} className="flex gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                        {warning}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="restore-confirm" className="text-sm">
                    Type <strong>RESTORE</strong> to replace all data with this backup
                  </label>
                  <Input
                    id="restore-confirm"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                    disabled={restoring}
                  />
                </div>
              </div>
            )}

            {restoring && (
              <p className="text-sm text-muted-foreground">
                Saving a safety backup, then restoring. This can take a minute; please keep this page open.
              </p>
            )}

            {error && (
              <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>Cancel</DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={handleRestore}
              disabled={!checked || confirmation.trim() !== "RESTORE" || busy}
            >
              {restoring && <Loader2 className="size-4 animate-spin" />}
              {restoring ? "Restoring…" : "Replace all data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
