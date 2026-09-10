"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { deleteGroups } from "@/app/groups/actions";
import { GroupDetailsDialog, type GroupRow } from "@/components/group-details-dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIconTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export function GroupsTable({ groups, search }: { groups: GroupRow[]; search: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const groupIds = groups.map((group) => group.id);
  const selectedVisibleCount = groupIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = groupIds.length > 0 && selectedVisibleCount === groupIds.length;
  const someSelected = selectedVisibleCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function toggleGroup(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allSelected) groupIds.forEach((id) => next.delete(id));
      else groupIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteGroups([...selectedIds]);
    setDeleting(false);

    if (result.error) {
      setConfirmingDelete(false);
      toast("Failed to delete groups", "error");
      return;
    }

    setSelectedIds(new Set());
    setConfirmingDelete(false);
    toast(`${result.deleted} group${result.deleted === 1 ? "" : "s"} deleted successfully`);
    router.refresh();
  }

  return (
    <>
      {selectedIds.size > 0 && (
        <div
          className="mb-3 flex shrink-0 items-center justify-between rounded-lg border bg-background px-4 py-2.5"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-sm font-medium">
            {selectedIds.size} group{selectedIds.size === 1 ? "" : "s"} selected
          </p>
          <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmingDelete(true)} disabled={deleting}>
            Delete
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background">
        <div className="min-w-2xl">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b bg-background text-left text-muted-foreground">
                <th className="w-12 px-5 py-3 font-medium">
                  <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all groups" className="size-4 cursor-pointer accent-primary" />
                </th>
                <th className="w-[43%] px-5 py-3 font-medium">Group Name</th>
                <th className="w-[23%] px-5 py-3 font-medium">Contacts</th>
                <th className="w-[25%] px-5 py-3 font-medium">Date Created</th>
                <th className="w-12 px-3 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {groups.length ? groups.map((group) => (
                <GroupDetailsDialog key={group.id} group={group}>
                  {({ onEdit, onDelete }) => (
                    <tr className="cursor-pointer border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-5 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(group.id)}
                          onChange={() => toggleGroup(group.id)}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select ${group.name}`}
                          className="size-4 cursor-pointer accent-primary"
                        />
                      </td>
                      <td className="px-5 py-4 font-medium">{group.name}</td>
                      <td className="px-5 py-4">{group.contact_groups.length}</td>
                      <td className="whitespace-nowrap px-5 py-4">{new Date(group.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td className="px-3 py-2" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuIconTrigger label={`Actions for ${group.name}`} />
                          <DropdownMenuContent>
                            <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={onDelete} className="text-destructive">Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  )}
                </GroupDetailsDialog>
              )) : (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">{search ? "No groups found." : "No groups yet."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} group{selectedIds.size === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>This will remove the selected groups and their contact associations. Contacts themselves will not be deleted.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting..." : "Delete Groups"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}