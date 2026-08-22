"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAccountCategoryAction, setAccountCategoryAction } from "@/lib/actions/trackedPosts";
import { UNCATEGORISED_LABEL, type AccountCategory } from "@/lib/tracking/categories";

const NEW_CATEGORY = "__new__";

/**
 * Files one account under a category.
 *
 * Rendered on both the grid's account header and the account-totals table, on purpose: the
 * grid is where the operator looks at one account closely, but the totals table is where
 * they land after a page subscription has just created ten accounts at once, and filing all
 * ten from a single screen is the difference between this feature being used and not.
 *
 * The category is stored on the ACCOUNT, not on the account-for-this-campaign — so filing
 * someone here also files them in every other campaign they appear in. Said in the title
 * attribute rather than left to be discovered.
 */
export function CategoryPicker({
  campaignId,
  accountId,
  categoryId,
  categories,
  compact = false,
}: {
  campaignId: string;
  accountId: string;
  categoryId: string | null;
  categories: AccountCategory[];
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function assign(nextCategoryId: string | null) {
    startTransition(async () => {
      await setAccountCategoryAction(campaignId, accountId, nextCategoryId);
      router.refresh();
    });
  }

  function addAndAssign() {
    const name = draft.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    startTransition(async () => {
      // Created and assigned in one step. Creating a category the operator then has to go
      // and pick from a dropdown would make adding one a two-step chore, and the only
      // reason to add one here is to put this account in it.
      const created = await createAccountCategoryAction(campaignId, name);
      if (created) await setAccountCategoryAction(campaignId, accountId, created.id);
      setDraft("");
      setAdding(false);
      router.refresh();
    });
  }

  if (adding) {
    return (
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addAndAssign();
            if (e.key === "Escape") {
              setDraft("");
              setAdding(false);
            }
          }}
          placeholder="New category…"
          maxLength={60}
          style={{ fontSize: 12, width: compact ? 120 : 150 }}
        />
        <button className="btn" style={{ fontSize: 11 }} onClick={addAndAssign} disabled={pending}>
          Add
        </button>
      </span>
    );
  }

  return (
    <select
      value={categoryId ?? ""}
      disabled={pending}
      title="What kind of account this is. Stored on the account, so it applies to every campaign they appear in."
      onChange={(e) => {
        const value = e.target.value;
        if (value === NEW_CATEGORY) {
          setAdding(true);
          return;
        }
        assign(value === "" ? null : value);
      }}
      style={{ fontSize: compact ? 11 : 12, maxWidth: compact ? 140 : 180 }}
    >
      {/* An empty value, not a "none" category row — Uncategorised is the absence of a
          category, and giving it an id would make it something accounts could be filed
          INTO and something totals could be attributed to. */}
      <option value="">{UNCATEGORISED_LABEL}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value={NEW_CATEGORY}>+ New category…</option>
    </select>
  );
}
