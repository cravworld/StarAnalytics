// Grouping tracked accounts into the sections the tracker renders.
//
// Pure — no Prisma, no React — for the same reason insights.ts is: the rules about what
// lands in which section, what order sections come in, and where unfiled accounts go are
// decisions worth testing directly rather than inferring from a rendered page.

/** The name shown for accounts that haven't been filed yet. Not a category row. */
export const UNCATEGORISED_LABEL = "Uncategorised";

/** Sentinel used as a section key and as a filter value, since null can't be either. */
export const UNCATEGORISED_KEY = "__uncategorised__";

export interface AccountCategory {
  id: string;
  name: string;
  sortOrder: number;
}

/** The minimum an account must expose to be grouped. */
export interface CategorizableAccount {
  categoryId: string | null;
}

export interface CategorySection<T> {
  /** Category id, or UNCATEGORISED_KEY for the unfiled section. */
  key: string;
  name: string;
  /** False for the Uncategorised section, which has no row to rename or delete. */
  isReal: boolean;
  accounts: T[];
}

/**
 * Accounts split into ordered sections.
 *
 * Three rules, all deliberate:
 *
 *  - Empty categories are dropped. The operator's list can hold a dozen names; a campaign
 *    that used three of them should show three sections, not twelve, nine of them empty.
 *  - Uncategorised always sorts LAST, whatever sortOrder the real categories carry. It is
 *    a to-do list, not a peer of the others.
 *  - An account whose categoryId points at a category that isn't in `categories` (deleted
 *    between the two reads, or filtered out) falls into Uncategorised rather than being
 *    dropped. Losing an account off the screen entirely would be the worse failure — it
 *    would look like its posts stopped being tracked.
 *
 * Order WITHIN a section is left exactly as given, so the caller's sort (engagement, in
 * the tracker's case) survives grouping.
 */
export function groupByCategory<T extends CategorizableAccount>(
  accounts: T[],
  categories: AccountCategory[],
): CategorySection<T>[] {
  const byId = new Map(categories.map((c) => [c.id, c]));

  const buckets = new Map<string, T[]>();
  for (const account of accounts) {
    const key = account.categoryId && byId.has(account.categoryId) ? account.categoryId : UNCATEGORISED_KEY;
    const list = buckets.get(key) ?? [];
    list.push(account);
    buckets.set(key, list);
  }

  const sections: CategorySection<T>[] = [];
  for (const category of [...categories].sort(byOrderThenName)) {
    const bucket = buckets.get(category.id);
    if (!bucket?.length) continue;
    sections.push({ key: category.id, name: category.name, isReal: true, accounts: bucket });
  }

  const unfiled = buckets.get(UNCATEGORISED_KEY);
  if (unfiled?.length) {
    sections.push({
      key: UNCATEGORISED_KEY,
      name: UNCATEGORISED_LABEL,
      isReal: false,
      accounts: unfiled,
    });
  }

  return sections;
}

/**
 * sortOrder first, name as the tie-break.
 *
 * The tie-break matters more than it looks: every category the operator adds after the
 * seeded five takes the schema default of 100, so without it, newly added categories would
 * sit in whatever order the database happened to return them and shuffle between loads.
 */
export function byOrderThenName(a: AccountCategory, b: AccountCategory): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * Normalizes a category name typed by a human.
 *
 * Collapses internal whitespace and trims, so " movie  critics " and "movie critics" can't
 * both exist — the unique index on `name` is case-sensitive and would happily accept both.
 * Case itself is preserved: the operator's capitalisation is theirs to choose.
 */
export function normalizeCategoryName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Does an account's category satisfy the current filter?
 *
 * Extracted rather than inlined in the view because of the specific mistake it prevents.
 * The category lives on the ACCOUNT, so the natural way to filter by it is to narrow the
 * account list — and if that's all you do, the post-level list the KPI row and the
 * all-posts table are built from silently ignores the filter, leaving the top of the page
 * describing a different set of posts from the bottom. Keeping the rule here, applied
 * inside the POST predicate and tested directly, is what keeps those four surfaces
 * agreeing.
 *
 * `filter` is "all", a category id, or UNCATEGORISED_KEY — never null, because a select
 * element's value can't be one.
 */
export function matchesCategoryFilter(filter: string, categoryId: string | null): boolean {
  if (filter === "all") return true;
  return (categoryId ?? UNCATEGORISED_KEY) === filter;
}
