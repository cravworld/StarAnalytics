"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createAccountCategoryAction,
  deleteAccountCategoryAction,
  renameAccountCategoryAction,
} from "@/lib/actions/trackedPosts";
import type { AccountCategory } from "@/lib/tracking/categories";

/**
 * Rename, delete and add the categories themselves.
 *
 * Shipped with the first version rather than left for later because the five starting
 * categories are the operator's own words taken from a chat message — at least one of them
 * ("FX Pages") is ambiguous enough that renaming it is a matter of when, not if. A list
 * that can't be renamed would force that correction into a migration.
 *
 * Deleting is safe by construction: the foreign key is ON DELETE SET NULL, so a deleted
 * category's accounts fall back to Uncategorised. No account and no post is ever removed
 * with it, which is why this doesn't ask for confirmation — it's undone by re-adding the
 * name and re-filing, not by a restore.
 */
export function CategoryManager({
  campaignId,
  categories,
  counts,
}: {
  campaignId: string;
  categories: AccountCategory[];
  /** categoryId -> how many accounts in THIS campaign are filed under it. */
  counts: Map<string, number>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newName, setNewName] = useState("");

  function commitRename(categoryId: string) {
    const name = draft.trim();
    setEditingId(null);
    if (!name) return;
    startTransition(async () => {
      await renameAccountCategoryAction(campaignId, categoryId, name);
      router.refresh();
    });
  }

  function remove(categoryId: string) {
    startTransition(async () => {
      await deleteAccountCategoryAction(campaignId, categoryId);
      router.refresh();
    });
  }

  function add() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      await createAccountCategoryAction(campaignId, name);
      setNewName("");
      router.refresh();
    });
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <button className="btn" style={{ fontSize: 12 }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "▾" : "▸"} Manage categories
      </button>

      {open ? (
        <div
          className="card"
          style={{ marginTop: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}
        >
          {categories.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No categories yet — add one below.</div>
          ) : null}

          {categories.map((c) => {
            const used = counts.get(c.id) ?? 0;
            return (
              <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {editingId === c.id ? (
                  <>
                    <input
                      autoFocus
                      value={draft}
                      maxLength={60}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(c.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      style={{ fontSize: 12, width: 180 }}
                    />
                    <button className="btn" style={{ fontSize: 11 }} onClick={() => commitRename(c.id)}>
                      Save
                    </button>
                    <button className="btn" style={{ fontSize: 11 }} onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 150 }}>{c.name}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 110 }}>
                      {used} account{used === 1 ? "" : "s"} in this campaign
                    </span>
                    <button
                      className="btn"
                      style={{ fontSize: 11 }}
                      disabled={pending}
                      onClick={() => {
                        setDraft(c.name);
                        setEditingId(c.id);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: 11 }}
                      disabled={pending}
                      title="Accounts filed here move to Uncategorised. Nothing is deleted with it."
                      onClick={() => remove(c.id)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            );
          })}

          <div style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid var(--rule)", paddingTop: 8 }}>
            <input
              value={newName}
              maxLength={60}
              placeholder="Add a category…"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              style={{ fontSize: 12, width: 180 }}
            />
            <button className="btn" style={{ fontSize: 11 }} onClick={add} disabled={pending || !newName.trim()}>
              Add
            </button>
          </div>

          <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
            A category belongs to the account, not to this campaign — filing someone as a
            movie critic here files them everywhere they&apos;re tracked. Deleting a category
            moves its accounts to Uncategorised; it never deletes an account or a post.
          </div>
        </div>
      ) : null}
    </div>
  );
}
