import { describe, it, expect } from "vitest";
import {
  groupByCategory,
  byOrderThenName,
  matchesCategoryFilter,
  normalizeCategoryName,
  UNCATEGORISED_KEY,
  UNCATEGORISED_LABEL,
  type AccountCategory,
} from "./categories";

const CATS: AccountCategory[] = [
  { id: "c-inf", name: "Influencers", sortOrder: 10 },
  { id: "c-vlog", name: "Vloggers", sortOrder: 20 },
  { id: "c-crit", name: "Movie Critics", sortOrder: 50 },
];

function acct(id: string, categoryId: string | null) {
  return { id, categoryId };
}

describe("groupByCategory", () => {
  it("puts each account in its category, in sortOrder", () => {
    const sections = groupByCategory(
      [acct("a", "c-crit"), acct("b", "c-inf"), acct("c", "c-vlog")],
      CATS,
    );
    expect(sections.map((s) => s.name)).toEqual(["Influencers", "Vloggers", "Movie Critics"]);
  });

  // A campaign that used three of a dozen categories should show three sections, not
  // twelve with nine empty boxes.
  it("drops categories that no account in this campaign uses", () => {
    const sections = groupByCategory([acct("a", "c-vlog")], CATS);
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("Vloggers");
  });

  it("collects unfiled accounts under Uncategorised", () => {
    const sections = groupByCategory([acct("a", null), acct("b", "c-inf")], CATS);
    const last = sections[sections.length - 1];
    expect(last.key).toBe(UNCATEGORISED_KEY);
    expect(last.name).toBe(UNCATEGORISED_LABEL);
    expect(last.isReal).toBe(false);
    expect(last.accounts.map((a) => a.id)).toEqual(["a"]);
  });

  // Uncategorised is a to-do list, not a peer — it sorts last regardless of what sortOrder
  // the real categories happen to carry.
  it("keeps Uncategorised last even when every category sorts after it numerically", () => {
    const late: AccountCategory[] = [{ id: "c-x", name: "Late", sortOrder: 9999 }];
    const sections = groupByCategory([acct("a", null), acct("b", "c-x")], late);
    expect(sections.map((s) => s.name)).toEqual(["Late", UNCATEGORISED_LABEL]);
  });

  // Losing an account off the screen entirely reads as "its posts stopped being tracked",
  // which is a worse failure than showing it as unfiled.
  it("falls back to Uncategorised for a category id that no longer exists", () => {
    const sections = groupByCategory([acct("a", "c-deleted")], CATS);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe(UNCATEGORISED_KEY);
    expect(sections[0].accounts.map((a) => a.id)).toEqual(["a"]);
  });

  it("preserves the caller's ordering inside a section", () => {
    const sections = groupByCategory(
      [acct("first", "c-inf"), acct("second", "c-inf"), acct("third", "c-inf")],
      CATS,
    );
    expect(sections[0].accounts.map((a) => a.id)).toEqual(["first", "second", "third"]);
  });

  it("returns nothing for no accounts", () => {
    expect(groupByCategory([], CATS)).toEqual([]);
  });

  // Grouping must never lose or duplicate an account — section totals are summed from
  // these buckets, so a duplicate would double-count real engagement.
  it("places every account exactly once", () => {
    const accounts = [acct("a", "c-inf"), acct("b", null), acct("c", "c-inf"), acct("d", "c-gone")];
    const placed = groupByCategory(accounts, CATS).flatMap((s) => s.accounts.map((a) => a.id));
    expect(placed.sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("byOrderThenName", () => {
  // Every category added after the seeded five takes the schema default of 100, so without
  // the name tie-break they'd shuffle between page loads.
  it("breaks ties on name so equal sortOrders are stable", () => {
    const same: AccountCategory[] = [
      { id: "2", name: "Zebra", sortOrder: 100 },
      { id: "1", name: "Alpha", sortOrder: 100 },
    ];
    expect([...same].sort(byOrderThenName).map((c) => c.name)).toEqual(["Alpha", "Zebra"]);
  });
});

describe("normalizeCategoryName", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeCategoryName("  movie   critics ")).toBe("movie critics");
  });

  it("leaves the operator's capitalisation alone", () => {
    expect(normalizeCategoryName("FX Pages")).toBe("FX Pages");
  });
});

// This is the one rule that has to hold identically for the KPI row, the grid, the
// all-posts table and the account totals — see matchesCategoryFilter's docblock.
describe("matchesCategoryFilter", () => {
  it("passes everything when no category is selected", () => {
    expect(matchesCategoryFilter("all", "c-inf")).toBe(true);
    expect(matchesCategoryFilter("all", null)).toBe(true);
  });

  it("matches on category id", () => {
    expect(matchesCategoryFilter("c-inf", "c-inf")).toBe(true);
    expect(matchesCategoryFilter("c-inf", "c-vlog")).toBe(false);
  });

  // Filtering to Uncategorised must show the unfiled accounts, not nothing — the whole
  // point of that filter is to find what still needs filing.
  it("treats an unfiled account as Uncategorised", () => {
    expect(matchesCategoryFilter(UNCATEGORISED_KEY, null)).toBe(true);
    expect(matchesCategoryFilter(UNCATEGORISED_KEY, "c-inf")).toBe(false);
    expect(matchesCategoryFilter("c-inf", null)).toBe(false);
  });
});
