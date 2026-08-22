// Campaign Post Tracking — ingest and queries. See CAMPAIGN-POST-TRACKING.md.
//
// QUERY DISCIPLINE: every read path here must issue a number of queries that does NOT grow
// with the number of tracked posts or accounts. The pool is 5 connections and /fan-pages
// already died on exactly this shape (six queries per tracked page, P2024 once ten pages
// existed). That is why TrackedPost carries denormalized cur*/prev* columns — the grid
// reads one table, and tracked_post_snapshots is touched only by the per-post trend view.
// Pinned by trackedPostsQueryCount.test.ts.

import { prisma } from "@/lib/prisma";
import type { TrackPlatform } from "@prisma/client";
import {
  aggregate,
  baselineDeltaPct,
  commentRatio,
  engagement,
  engagementRatePct,
  percentileRank,
  velocityPerDay,
  viewRate,
  type AggregateTotals,
} from "@/lib/tracking/insights";
import {
  accountKeyFor,
  facebookPageFrom,
  parseAccountUrl,
  parsePostUrl,
  postUrlFor,
  type TrackPlatformId,
} from "@/lib/tracking/postUrl";
import { normalizeCategoryName, type AccountCategory } from "@/lib/tracking/categories";
import { profileUrlKey } from "@/lib/scout/ingest";
import {
  getTrackedPostProvider,
  PlatformNotSupportedError,
  type TrackedPostScrape,
} from "@/lib/tracking/provider";

// Matches AGENCY_SCRAPE_BATCH_SIZE rather than inventing a second ceiling — same actor,
// same operational time box per run.
const SCRAPE_BATCH_SIZE = 200;

// An account's follower count is re-scraped at most this often. Followers move slowly and a
// profile scrape is a separate charge, so refreshing per post (rather than per account per
// day) would multiply the cost by the number of posts that account delivered for no gain.
const ACCOUNT_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface IngestOutcome {
  url: string;
  status: "added" | "duplicate" | "rejected" | "page-subscribed";
  reason?: string;
}

/**
 * Does this caption mention one of the campaign's hashtags?
 *
 * This is the automatic half of deciding whether a page-discovered post counts toward the
 * campaign. It is deliberately the ONLY automatic signal, and deliberately not trusted to be
 * complete: an influencer who forgets the hashtag produces a false negative, which is why
 * non-matching posts are still stored and shown under "other posts from this page" with a
 * one-click include, rather than being filtered away where nobody could see them.
 *
 * Matched with a word boundary so #np50 doesn't match #np500, and case-insensitively
 * because nobody types hashtags consistently.
 */
export function captionMentionsCampaign(caption: string | null, hashtags: string[]): boolean {
  if (!caption || hashtags.length === 0) return false;
  const text = caption.toLowerCase();
  return hashtags.some((tag) => {
    const clean = tag.replace(/^#/, "").toLowerCase();
    if (!clean) return false;
    return new RegExp(`#${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_])`, "i").test(text);
  });
}

export interface IngestResult {
  added: number;
  duplicates: number;
  rejected: number;
  /**
   * Subscriptions created by this submission, for the caller to run discovery on OFF the
   * request. A page yields up to TRACKED_DISCOVERY_LIMIT posts at ~6 sequential queries
   * each; scraping inline would time out and leave partial rows. See the server action.
   */
  pageSubscriptionIds: string[];
  outcomes: IngestOutcome[];
}

/**
 * Why a scrape came back without this post.
 *
 * Facebook gets its own answers because its failures are different in kind and usually
 * fixable by the operator. There is no Facebook actor that takes a post URL, so a post is
 * found by scraping its page and matching — which means a link that doesn't name its page
 * (`/reel/{id}`, `/watch/?v={id}`) can't be looked up at all. Telling someone their post
 * "may have been deleted" when the real problem is the URL format sends them to check the
 * wrong thing.
 */
function notFoundReason(platform: TrackPlatformId, url: string): string {
  if (platform === "facebook") {
    if (!facebookPageFrom(url)) {
      return "That Facebook link names the post but not the page it's on, and Facebook has no post-by-URL scraper — so there's no page to look it up in. Open the post on facebook.com and copy the URL from the address bar (it should look like facebook.com/thepage/posts/...).";
    }
    return "Not found among that page's recent posts. It may have been deleted, made non-public, or posted by a different page than the URL suggests.";
  }
  return "The platform returned nothing for that link — it may be deleted, private, or age-restricted.";
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Add tracked posts to a campaign from pasted links.
 *
 * Takes an array from day one even though the UI passes exactly one URL. Bulk upload later
 * is then a spreadsheet parser in front of this same function — the same discipline the fan
 * page bulk-add follows, and the reason a bulk path can't quietly diverge from the single
 * one. (parseAgencySheet.ts is the existing precedent for that parser.)
 *
 * Per-URL outcomes rather than a thrown error on the first bad link: pasting ten links and
 * having the whole batch rejected because one was a story URL is the wrong behaviour.
 */
export async function ingestTrackedPostUrls(
  campaignId: string,
  urls: string[],
): Promise<IngestResult> {
  const outcomes: IngestOutcome[] = [];
  const parsed: { url: string; platform: TrackPlatformId; postKey: string; canonicalUrl: string }[] = [];

  // Dedup within the submitted batch itself by postKey, not by URL string — the same post
  // pasted as /p/ and /reel/, or twice with different tracking params, is one post.
  const seen = new Set<string>();
  const pageSubscriptions: string[] = [];
  for (const url of urls) {
    const result = parsePostUrl(url);
    if (!result.ok) {
      // Not a post link — try it as a page/profile link before rejecting. The operator
      // pastes whatever they have into one box and never has to declare which kind it is.
      const asAccount = parseAccountUrl(url);
      if (asAccount.ok) {
        const { subscriptionId } = await subscribeToPage(
          campaignId,
          asAccount.value.platform,
          asAccount.value.handle,
        );
        pageSubscriptions.push(subscriptionId);
        outcomes.push({
          url,
          status: "page-subscribed",
          reason: `Tracking @${asAccount.value.handle} — pulling their posts now, and new ones automatically from here on.`,
        });
        continue;
      }
      // Report the POST-parse reason, not the account one: "that's a story link" is more
      // useful than "that's not a valid profile" for something that looks like a post.
      outcomes.push({ url, status: "rejected", reason: result.reason });
      continue;
    }
    const { platform, postKey, canonicalUrl } = result.value;
    const key = `${platform}:${postKey}`;
    if (seen.has(key)) {
      outcomes.push({ url, status: "duplicate", reason: "Same post appears twice in this batch." });
      continue;
    }
    seen.add(key);
    parsed.push({ url, platform, postKey, canonicalUrl });
  }

  // One query for the whole batch, not one per URL.
  const existing = await prisma.trackedPost.findMany({
    where: { OR: parsed.map((p) => ({ platform: p.platform as TrackPlatform, postKey: p.postKey })) },
    select: { platform: true, postKey: true, campaignId: true },
  });
  const existingKeys = new Map(existing.map((e) => [`${e.platform}:${e.postKey}`, e.campaignId]));

  const toScrape = parsed.filter((p) => {
    const owner = existingKeys.get(`${p.platform}:${p.postKey}`);
    if (owner === undefined) return true;
    outcomes.push({
      url: p.url,
      status: "duplicate",
      reason:
        owner === campaignId
          ? "Already tracked in this campaign."
          : "Already tracked under a different campaign.",
    });
    return false;
  });

  // Grouped by platform: each platform has its own actor/API and its own batch semantics.
  const byPlatform = new Map<TrackPlatformId, typeof toScrape>();
  for (const p of toScrape) {
    const list = byPlatform.get(p.platform) ?? [];
    list.push(p);
    byPlatform.set(p.platform, list);
  }

  for (const [platform, items] of byPlatform) {
    const provider = getTrackedPostProvider(platform);
    for (const batch of chunk(items, SCRAPE_BATCH_SIZE)) {
      let scrapes: TrackedPostScrape[];
      try {
        scrapes = await provider.scrapePosts(
          platform,
          batch.map((b) => ({ postKey: b.postKey, url: b.canonicalUrl })),
        );
      } catch (err) {
        // A platform with no scraper (Facebook, §4a) or a quota trip fails the whole batch
        // rather than storing rows with no metrics. A tracked post that silently reports
        // zero is indistinguishable from a real zero and would corrupt every total.
        const reason =
          err instanceof PlatformNotSupportedError
            ? err.message
            : `Scrape failed: ${err instanceof Error ? err.message : String(err)}`;
        for (const b of batch) outcomes.push({ url: b.url, status: "rejected", reason });
        continue;
      }

      const byKey = new Map(scrapes.map((s) => [s.postKey, s]));
      for (const b of batch) {
        const scrape = byKey.get(b.postKey);
        if (!scrape) {
          outcomes.push({ url: b.url, status: "rejected", reason: notFoundReason(platform, b.canonicalUrl) });
          continue;
        }
        await storeTrackedPost(campaignId, platform, b.canonicalUrl, scrape);
        outcomes.push({ url: b.url, status: "added" });
      }
    }
  }

  return {
    added: outcomes.filter((o) => o.status === "added").length,
    duplicates: outcomes.filter((o) => o.status === "duplicate").length,
    rejected: outcomes.filter((o) => o.status === "rejected").length,
    pageSubscriptionIds: pageSubscriptions,
    outcomes,
  };
}

/**
 * Subscribe a campaign to a whole page. Idempotent — re-pasting the same page link
 * reactivates the subscription rather than creating a second one.
 *
 * Only records the intent; the scrape happens in runPageDiscovery, which the caller runs
 * off-request. A page yields up to TRACKED_DISCOVERY_LIMIT posts and each one is ~6
 * sequential queries through storeTrackedPost, so doing this inline would time out on the
 * first real page and leave partial rows with no record of where it stopped.
 */
export async function subscribeToPage(
  campaignId: string,
  platform: TrackPlatformId,
  handle: string,
): Promise<{ subscriptionId: string; accountId: string }> {
  const accountKey = accountKeyFor(platform, handle);
  const existing = await prisma.trackedAccount.findUnique({ where: { accountKey }, select: { id: true } });
  const account =
    existing ??
    (await prisma.trackedAccount.create({
      data: {
        platform: platform as TrackPlatform,
        handle,
        accountKey,
        scoutCandidateId: await findScoutCandidateId(platform, handle),
      },
      select: { id: true },
    }));

  const sub = await prisma.trackedPageSubscription.upsert({
    where: { campaignId_accountId: { campaignId, accountId: account.id } },
    create: { campaignId, accountId: account.id },
    // Re-pasting a page that was previously stopped turns it back on. lastDiscoveryAt is
    // deliberately NOT reset: the discovery that follows will set it, and clearing it here
    // would make a failed run look like a page that had never been scanned.
    update: { isActive: true, lastError: null },
    select: { id: true },
  });

  return { subscriptionId: sub.id, accountId: account.id };
}

export interface DiscoveryResult {
  found: number;
  added: number;
  campaignPosts: number;
  otherPosts: number;
  alreadyTracked: number;
}

/**
 * Pull a subscribed page's recent posts and store them.
 *
 * Every post the page returns is stored — campaign work and the influencer's own content
 * alike. What differs is `isCampaignPost`: hashtag matches count toward campaign totals,
 * everything else is kept as "other posts from this page" so the operator can see what
 * isn't being counted and include it in one click. Storing only the matches would make a
 * forgotten hashtag indistinguishable from a post that never existed.
 *
 * A post already tracked is never re-classified. If someone clicked "count this one too",
 * `includedByUserAt` records a human decision, and a later discovery pass must not quietly
 * overrule it with a hashtag guess.
 */
export async function runPageDiscovery(subscriptionId: string): Promise<DiscoveryResult> {
  const sub = await prisma.trackedPageSubscription.findUnique({
    where: { id: subscriptionId },
    include: {
      account: { select: { id: true, platform: true, handle: true } },
      campaign: { select: { id: true, hashtags: true } },
    },
  });
  if (!sub) throw new Error(`subscription ${subscriptionId} not found`);

  const platform = sub.account.platform as TrackPlatformId;
  const result: DiscoveryResult = { found: 0, added: 0, campaignPosts: 0, otherPosts: 0, alreadyTracked: 0 };

  try {
    const scrapes = await getTrackedPostProvider(platform).discoverAccountPosts(
      platform,
      sub.account.handle,
      sub.discoverFrom,
    );
    result.found = scrapes.length;

    // One query for the whole batch — not a lookup per discovered post.
    const keys = scrapes.map((s) => s.postKey);
    const known = keys.length
      ? await prisma.trackedPost.findMany({
          where: { platform: platform as TrackPlatform, postKey: { in: keys } },
          select: { postKey: true },
        })
      : [];
    const knownKeys = new Set(known.map((k) => k.postKey));

    for (const scrape of scrapes) {
      if (knownKeys.has(scrape.postKey)) {
        result.alreadyTracked++;
        continue;
      }
      const isCampaignPost = captionMentionsCampaign(scrape.caption, sub.campaign.hashtags);
      // A discovered post has no pasted URL — it arrived as an item in a page scrape — so
      // its public URL is rebuilt from the key. For Facebook that URL must keep the page in
      // its path, because a later refresh reads the page back out of it.
      const url = postUrlFor(platform, scrape.postKey, sub.account.handle);
      await storeTrackedPost(sub.campaign.id, platform, url, scrape, {
        discoveredVia: "page-scan",
        isCampaignPost,
      });
      result.added++;
      if (isCampaignPost) result.campaignPosts++;
      else result.otherPosts++;
    }

    await prisma.trackedPageSubscription.update({
      where: { id: subscriptionId },
      data: { lastDiscoveryAt: new Date(), lastError: null },
    });
  } catch (err) {
    // lastDiscoveryAt is set on the failure path too — it records when discovery was
    // ATTEMPTED, not when it succeeded. Without that, a page that consistently fails would
    // re-qualify as the stalest subscription on every cron pass and starve every other page.
    await prisma.trackedPageSubscription.update({
      where: { id: subscriptionId },
      data: {
        lastDiscoveryAt: new Date(),
        lastError: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }

  return result;
}

/**
 * Resolve (or create) the posting account, refresh its follower snapshot if stale, then
 * write the post row and its first metrics snapshot.
 *
 * The account is derived from the scrape, never typed in — the operator only pastes a link,
 * and the actor tells us who posted it.
 */
async function storeTrackedPost(
  campaignId: string,
  platform: TrackPlatformId,
  url: string,
  scrape: TrackedPostScrape,
  opts: { discoveredVia?: string; isCampaignPost?: boolean } = {},
): Promise<void> {
  // Defaults describe a pasted link, which is the only way posts arrived before page
  // subscriptions existed: the operator pasting it IS the statement that it's campaign work.
  const discoveredVia = opts.discoveredVia ?? "pasted";
  const isCampaignPost = opts.isCampaignPost ?? true;
  const handle = scrape.authorHandle?.trim() || "unknown";
  const accountKey = accountKeyFor(platform, handle);

  // Looked up BEFORE the upsert only when the account is new. Inlining it as
  // `create: { scoutCandidateId: await findScoutCandidateId(...) }` would run the query on
  // every ingest — including every update, where the result is discarded — which is one
  // wasted round-trip per post on a path that is already query-heavy.
  const known = await prisma.trackedAccount.findUnique({
    where: { accountKey },
    select: { id: true },
  });

  const account = known
    ? await prisma.trackedAccount.update({
        where: { id: known.id },
        data: scrape.authorDisplayName ? { displayName: scrape.authorDisplayName } : {},
      })
    : await prisma.trackedAccount.create({
        data: {
          platform: platform as TrackPlatform,
          handle,
          displayName: scrape.authorDisplayName,
          accountKey,
          scoutCandidateId: await findScoutCandidateId(platform, handle),
        },
      });

  await refreshAccountSnapshotIfStale(account.id, platform, handle);

  const post = await prisma.trackedPost.upsert({
    where: { platform_postKey: { platform: platform as TrackPlatform, postKey: scrape.postKey } },
    create: {
      campaignId,
      accountId: account.id,
      platform: platform as TrackPlatform,
      url,
      postKey: scrape.postKey,
      mediaType: scrape.mediaType,
      caption: scrape.caption,
      postedAt: scrape.postedAt ? new Date(scrape.postedAt) : null,
      lastScrapedAt: new Date(),
      discoveredVia,
      isCampaignPost,
      curLikes: scrape.likes,
      curComments: scrape.comments,
      curShares: scrape.shares,
      curViews: scrape.views,
    },
    // On a re-scrape the current figures shift into prev* so the UI can show movement
    // without reading the snapshot table for every card.
    //
    // isCampaignPost and discoveredVia are NOT in this update. Once a post is tracked, what
    // it counts as has either been decided by a human or set at first sight, and a later
    // pass must not silently overrule it — a hashtag edited out of a caption would
    // otherwise drop a post out of the campaign totals with no trace.
    update: {
      lastScrapedAt: new Date(),
      lastError: null,
      curLikes: scrape.likes,
      curComments: scrape.comments,
      curShares: scrape.shares,
      curViews: scrape.views,
    },
  });

  await prisma.trackedPostSnapshot.create({
    data: {
      trackedPostId: post.id,
      likes: scrape.likes,
      comments: scrape.comments,
      shares: scrape.shares,
      views: scrape.views,
      reactions: scrape.reactions ?? undefined,
      raw: scrape.raw as object,
    },
  });
}

/**
 * Find the Scoutline candidate this account corresponds to, if it was ever scouted. This
 * link is what makes the "did the paid post beat their own baseline" comparison possible,
 * so a silent miss here removes the single most useful number in the feature.
 *
 * Uses Scoutline's OWN `profileUrlKey` rather than this module's `accountKeyFor`, even
 * though the two produce identical output for ordinary handles. They are not identical in
 * general — Scoutline strips trailing dots (`someone.` -> `someone`) while accountKeyFor
 * strips a leading `@` — and the two normalizations drifting apart would break this lookup
 * without erroring: it would just return null forever and the baseline chip would quietly
 * never render. Calling the function that owns the format makes them impossible to drift.
 *
 * YouTube never matches — Scoutline covers Instagram and Facebook only. That is correct,
 * not a gap.
 */
async function findScoutCandidateId(platform: TrackPlatformId, handle: string): Promise<string | null> {
  if (platform === "youtube") return null;
  const candidate = await prisma.scoutCandidate.findUnique({
    where: { profileUrlKey: profileUrlKey(handle, platform) },
    select: { id: true },
  });
  return candidate?.id ?? null;
}

async function refreshAccountSnapshotIfStale(
  accountId: string,
  platform: TrackPlatformId,
  handle: string,
): Promise<void> {
  const latest = await prisma.trackedAccountSnapshot.findFirst({
    where: { accountId },
    orderBy: { capturedAt: "desc" },
    select: { capturedAt: true },
  });
  if (latest && Date.now() - latest.capturedAt.getTime() < ACCOUNT_SNAPSHOT_MAX_AGE_MS) return;

  try {
    const snap = await getTrackedPostProvider(platform).scrapeAccount(platform, handle);
    await prisma.trackedAccountSnapshot.create({
      data: {
        accountId,
        followers: snap.followers,
        followersAvailable: snap.followersAvailable,
        raw: (snap.raw ?? undefined) as object | undefined,
      },
    });
    if (snap.displayName) {
      await prisma.trackedAccount.update({
        where: { id: accountId },
        data: { displayName: snap.displayName },
      });
    }
  } catch (err) {
    // A missing follower count costs engagement rate for this account, not the post itself.
    // Swallowed rather than failing the ingest — the post's own metrics are the primary
    // deliverable and they scraped fine.
    console.error(`tracked account snapshot failed for ${platform}:${handle}:`, err);
  }
}

/**
 * Include or exclude a post from its campaign's totals.
 *
 * Stamps includedByUserAt so the decision is recorded as a human's, not a hashtag match —
 * storeTrackedPost deliberately never updates isCampaignPost on a re-scrape, so nothing
 * downstream can quietly overrule this later.
 */
export async function setPostCampaignInclusion(trackedPostId: string, include: boolean): Promise<void> {
  await prisma.trackedPost.update({
    where: { id: trackedPostId },
    data: { isCampaignPost: include, includedByUserAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Account categories (§14)
// ---------------------------------------------------------------------------

/** The operator's category list, in the order sections render. */
export async function listAccountCategories(): Promise<AccountCategory[]> {
  const rows = await prisma.trackedAccountCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sortOrder: true },
  });
  return rows;
}

/**
 * File an account under a category, or clear it.
 *
 * On TrackedAccount, not on the campaign-account pair: an account IS a movie critic, and
 * saying so once should hold for every campaign they appear in rather than being retyped
 * per campaign. That's the whole reason this is worth storing at all.
 */
export async function setAccountCategory(accountId: string, categoryId: string | null): Promise<void> {
  await prisma.trackedAccount.update({
    where: { id: accountId },
    data: { categoryId },
  });
}

/**
 * Add a category, or return the existing one if it's already there.
 *
 * Matched case-INSENSITIVELY even though the unique index is case-sensitive: Postgres would
 * happily hold both "Movie Critics" and "movie critics", and they would render as two
 * sections holding what the operator thinks of as one group. Returning the existing row
 * makes a duplicate submission a no-op instead of an error the operator has to read.
 */
export async function createAccountCategory(rawName: string): Promise<AccountCategory | null> {
  const name = normalizeCategoryName(rawName);
  if (!name) return null;

  const existing = await prisma.trackedAccountCategory.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, sortOrder: true },
  });
  if (existing) return existing;

  // New categories land after the seeded five (10..50) and sort among themselves by name —
  // see byOrderThenName for why that tie-break is load-bearing.
  return prisma.trackedAccountCategory.create({
    data: { name },
    select: { id: true, name: true, sortOrder: true },
  });
}

/** Rename in place. The id is stable, so every account stays filed where it was. */
export async function renameAccountCategory(categoryId: string, rawName: string): Promise<void> {
  const name = normalizeCategoryName(rawName);
  if (!name) return;
  await prisma.trackedAccountCategory.update({ where: { id: categoryId }, data: { name } });
}

/**
 * Delete a category. Its accounts drop to Uncategorised — they are never deleted.
 *
 * That's enforced by the FK's ON DELETE SET NULL rather than by an UPDATE here, so it holds
 * even for a row deleted straight from the database console.
 */
export async function deleteAccountCategory(categoryId: string): Promise<void> {
  await prisma.trackedAccountCategory.delete({ where: { id: categoryId } });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface TrackedPostView {
  id: string;
  url: string;
  platform: TrackPlatformId;
  mediaType: string | null;
  caption: string | null;
  postedAt: Date | null;
  lastScrapedAt: Date | null;
  lastError: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  engagement: number | null;
  /** Movement since the previous scan. Null until a post has been scanned twice. */
  engagementDelta: number | null;
  engagementRatePct: number | null;
  commentRatio: number | null;
  viewRate: number | null;
  percentile: number | null;
  accountId: string;
  accountHandle: string;
  /** Counts toward campaign totals. False = "other post from this page" (§13). */
  isCampaignPost: boolean;
  /** "pasted" | "page-scan" — why this post is here, so the UI can explain itself. */
  discoveredVia: string;
  /** Set when a human clicked "count this one too", rather than a hashtag deciding it. */
  includedByUser: boolean;
}

export interface TrackedAccountView {
  id: string;
  handle: string;
  displayName: string | null;
  platform: TrackPlatformId;
  followers: number | null;
  followersAvailable: boolean;
  /** Scoutline's measured average engagement rate for this account, if it was scouted. */
  baselineErPct: number | null;
  baselineMeasuredAt: Date | null;
  /** This account's campaign posts' mean ER vs that baseline, as a percentage difference. */
  baselineDeltaPct: number | null;
  totals: AggregateTotals;
  /** Campaign posts — what totals are built from. */
  posts: TrackedPostView[];
  /** Everything else this page posted. Visible, never counted, one click from counting. */
  otherPosts: TrackedPostView[];
  /** True when this page is subscribed: new posts arrive automatically. */
  isSubscribed: boolean;
  /** Which section this account renders under. Null = unfiled (§14). */
  categoryId: string | null;
  /** Resolved name, so the UI never needs a second lookup to label a section. */
  categoryName: string | null;
  /**
   * Follower count over time, oldest first — the one page-level metric that isn't a rollup
   * of its posts. Comes free from the snapshots already written on every scan.
   *
   * Points where the platform hid the follower count are omitted rather than plotted as
   * zero, which would draw a cliff that never happened.
   */
  followerHistory: { at: Date; followers: number }[];
}

export interface CampaignTrackingView {
  campaign: { id: string; name: string; hashtags: string[] };
  /**
   * Every category the operator has defined, not just the ones in use here — the assignment
   * dropdown has to offer all of them, including ones no account in this campaign uses yet.
   * Which of them become SECTIONS is decided by groupByCategory, which drops the empty ones.
   */
  categories: AccountCategory[];
  totals: AggregateTotals;
  accounts: TrackedAccountView[];
  posts: TrackedPostView[];
  otherPosts: TrackedPostView[];
}

/**
 * Everything the tracker detail screen renders, in a fixed number of queries regardless of
 * how many posts or accounts the campaign has.
 *
 * Seven queries total: campaign, posts, accounts, latest account snapshots, Scoutline
 * baselines, page subscriptions, and the category list. The last two are set-wide `findMany`s filtered by an id list, then indexed in
 * memory — NOT a lookup per account, which is the shape that breaks this app.
 */
export async function getCampaignTracking(campaignId: string): Promise<CampaignTrackingView | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    // hashtags come along so the UI can say WHY a post was auto-counted, and what an
    // influencer would have to include for the next one to be.
    select: { id: true, name: true, hashtags: true },
  });
  if (!campaign) return null;

  const postRows = await prisma.trackedPost.findMany({
    where: { campaignId },
    orderBy: [{ postedAt: "desc" }, { addedAt: "desc" }],
  });

  const accountIds = [...new Set(postRows.map((p) => p.accountId))];
  const accountRows = accountIds.length
    ? await prisma.trackedAccount.findMany({ where: { id: { in: accountIds } } })
    : [];

  // Latest follower snapshot per account, in ONE query. Ordered newest-first and reduced in
  // memory, rather than a findFirst per account.
  const snapshotRows = accountIds.length
    ? await prisma.trackedAccountSnapshot.findMany({
        where: { accountId: { in: accountIds } },
        orderBy: { capturedAt: "desc" },
        select: { accountId: true, followers: true, followersAvailable: true, capturedAt: true },
      })
    : [];
  const latestSnapshot = new Map<string, (typeof snapshotRows)[number]>();
  for (const s of snapshotRows) if (!latestSnapshot.has(s.accountId)) latestSnapshot.set(s.accountId, s);

  // Full follower history per account, built from the SAME rows already fetched above — no
  // extra query. Reversed to oldest-first for plotting; unavailable points are dropped
  // rather than zeroed, so a hidden follower count doesn't draw a cliff to zero.
  const historyByAccount = new Map<string, { at: Date; followers: number }[]>();
  for (let i = snapshotRows.length - 1; i >= 0; i--) {
    const s = snapshotRows[i];
    if (!s.followersAvailable || s.followers === null) continue;
    const list = historyByAccount.get(s.accountId) ?? [];
    list.push({ at: s.capturedAt, followers: s.followers });
    historyByAccount.set(s.accountId, list);
  }

  // Scoutline baselines, also in one query. See the baseline caveats in insights.ts.
  const scoutIds = accountRows.map((a) => a.scoutCandidateId).filter((id): id is string => Boolean(id));
  const scoutRows = scoutIds.length
    ? await prisma.scoutSnapshot.findMany({
        where: { candidateId: { in: scoutIds } },
        orderBy: { scrapedAt: "desc" },
        select: { candidateId: true, engagementRatePct: true, scrapedAt: true },
      })
    : [];
  const latestScout = new Map<string, (typeof scoutRows)[number]>();
  for (const s of scoutRows) if (!latestScout.has(s.candidateId)) latestScout.set(s.candidateId, s);

  // Which of these pages are subscribed. One set-wide query, indexed in memory — not a
  // lookup per account, which is the shape that breaks screens here (see the query-count
  // test). Scoped to this campaign: the same influencer can be subscribed for NP50 and not
  // for Pluto.
  const subRows = await prisma.trackedPageSubscription.findMany({
    where: { campaignId, isActive: true },
    select: { accountId: true },
  });
  const subscribedAccountIds = new Set(subRows.map((s) => s.accountId));

  // The whole category list, in one query, regardless of how many accounts there are. Read
  // unconditionally rather than only when some account is filed: the dropdown that files an
  // account needs the options precisely when nothing is filed yet.
  const categories = await listAccountCategories();
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const accountById = new Map(accountRows.map((a) => [a.id, a]));
  const allEngagement = postRows.map((p) => engagement({ likes: p.curLikes, comments: p.curComments }));

  const posts: TrackedPostView[] = postRows.map((p) => {
    const account = accountById.get(p.accountId);
    const snap = latestSnapshot.get(p.accountId);
    const followers = snap?.followersAvailable ? snap.followers : null;
    const current = engagement({ likes: p.curLikes, comments: p.curComments });
    const previous = engagement({ likes: p.prevLikes, comments: p.prevComments });
    return {
      id: p.id,
      url: p.url,
      platform: p.platform as TrackPlatformId,
      mediaType: p.mediaType,
      caption: p.caption,
      postedAt: p.postedAt,
      lastScrapedAt: p.lastScrapedAt,
      lastError: p.lastError,
      likes: p.curLikes,
      comments: p.curComments,
      shares: p.curShares,
      views: p.curViews,
      engagement: current,
      engagementDelta: current !== null && previous !== null ? current - previous : null,
      engagementRatePct: engagementRatePct({ likes: p.curLikes, comments: p.curComments }, followers),
      commentRatio: commentRatio({ likes: p.curLikes, comments: p.curComments }),
      viewRate: viewRate(p.curViews, followers),
      percentile: percentileRank(current, allEngagement),
      accountId: p.accountId,
      accountHandle: account?.handle ?? "unknown",
      isCampaignPost: p.isCampaignPost,
      discoveredVia: p.discoveredVia,
      includedByUser: p.includedByUserAt !== null,
    };
  });

  const postsByAccount = new Map<string, TrackedPostView[]>();
  for (const p of posts) {
    const list = postsByAccount.get(p.accountId) ?? [];
    list.push(p);
    postsByAccount.set(p.accountId, list);
  }

  const accounts: TrackedAccountView[] = accountRows
    .map((a) => {
      const all = postsByAccount.get(a.id) ?? [];
      // Split, not filtered. `own` drives every campaign number; `other` is the influencer's
      // non-campaign content, kept visible so a forgotten hashtag is one click from being
      // counted rather than invisible. See §13.
      const own = all.filter((p) => p.isCampaignPost);
      const other = all.filter((p) => !p.isCampaignPost);
      const snap = latestSnapshot.get(a.id);
      const scout = a.scoutCandidateId ? latestScout.get(a.scoutCandidateId) : undefined;

      // Mean ER across this account's campaign posts, compared against the mean ER across
      // ~100 of their own posts that Scoutline measured. Same formula on both sides — see
      // insights.ts baselineDeltaPct for why that equivalence is what makes this legitimate.
      //
      // Campaign posts only: comparing their whole feed against their own baseline would
      // answer a different question than "did the post we paid for beat their normal work".
      const measuredErs = own.map((p) => p.engagementRatePct).filter((v): v is number => v !== null);
      const meanEr = measuredErs.length
        ? measuredErs.reduce((x, y) => x + y, 0) / measuredErs.length
        : null;

      return {
        id: a.id,
        handle: a.handle,
        displayName: a.displayName,
        platform: a.platform as TrackPlatformId,
        followers: snap?.followersAvailable ? snap.followers : null,
        followersAvailable: snap?.followersAvailable ?? false,
        baselineErPct: scout?.engagementRatePct ?? null,
        baselineMeasuredAt: scout?.scrapedAt ?? null,
        baselineDeltaPct: baselineDeltaPct(meanEr, scout?.engagementRatePct ?? null),
        totals: aggregate(
          own.map((p) => ({ likes: p.likes, comments: p.comments, shares: p.shares, views: p.views })),
        ),
        posts: own,
        otherPosts: other,
        isSubscribed: subscribedAccountIds.has(a.id),
        // Resolved against the list just read, not trusted from the column: an id left over
        // from a category deleted a moment ago resolves to null here and the account falls
        // into Uncategorised, rather than rendering a section with no name.
        categoryId: a.categoryId && categoryNameById.has(a.categoryId) ? a.categoryId : null,
        categoryName: a.categoryId ? categoryNameById.get(a.categoryId) ?? null : null,
        followerHistory: historyByAccount.get(a.id) ?? [],
      };
    })
    // Accounts with campaign posts first, best-performing at the top. A subscribed page
    // whose posts are all "other" still appears — it is being tracked, it just hasn't
    // produced anything the campaign counts yet, and hiding it would look like the
    // subscription failed.
    .sort((a, b) => (b.totals.engagement ?? -1) - (a.totals.engagement ?? -1));

  const campaignPosts = posts.filter((p) => p.isCampaignPost);

  return {
    campaign,
    categories,
    // Campaign totals count campaign posts only — the influencer's own unrelated content
    // must not inflate what the campaign is reported to have delivered.
    totals: aggregate(
      campaignPosts.map((p) => ({ likes: p.likes, comments: p.comments, shares: p.shares, views: p.views })),
    ),
    accounts,
    posts: campaignPosts,
    otherPosts: posts.filter((p) => !p.isCampaignPost),
  };
}

/** Campaigns that have tracked posts, with a count — the tracker index screen. */
export async function getTrackedCampaigns() {
  const grouped = await prisma.trackedPost.groupBy({
    by: ["campaignId"],
    _count: { _all: true },
  });
  const campaigns = await prisma.campaign.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true },
  });
  const counts = new Map(grouped.map((g) => [g.campaignId, g._count._all]));
  return campaigns.map((c) => ({ ...c, trackedPosts: counts.get(c.id) ?? 0 }));
}

/**
 * Re-scrape every active tracked post in a campaign, shifting current metrics into prev*
 * so the UI can show movement.
 *
 * Called from a Server Action wrapped in after(), never inline in a page render — a route
 * killed mid-wait orphans a billed Apify run (apify/client.ts).
 */
export async function refreshCampaignTracking(campaignId: string): Promise<{ refreshed: number; failed: number }> {
  const posts = await prisma.trackedPost.findMany({
    where: { campaignId, isActive: true },
    select: {
      id: true,
      platform: true,
      postKey: true,
      url: true,
      // Facebook needs this: it bounds the page scrape to the oldest post tracked there.
      postedAt: true,
      curLikes: true,
      curComments: true,
      curViews: true,
    },
  });

  let refreshed = 0;
  let failed = 0;

  const byPlatform = new Map<TrackPlatformId, typeof posts>();
  for (const p of posts) {
    const platform = p.platform as TrackPlatformId;
    const list = byPlatform.get(platform) ?? [];
    list.push(p);
    byPlatform.set(platform, list);
  }

  for (const [platform, items] of byPlatform) {
    const provider = getTrackedPostProvider(platform);
    for (const batch of chunk(items, SCRAPE_BATCH_SIZE)) {
      let scrapes: TrackedPostScrape[];
      try {
        scrapes = await provider.scrapePosts(
          platform,
          batch.map((b) => ({
            postKey: b.postKey,
            url: b.url,
            postedAt: b.postedAt ? b.postedAt.toISOString() : null,
          })),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.trackedPost.updateMany({
          where: { id: { in: batch.map((b) => b.id) } },
          data: { lastError: message, lastScrapedAt: new Date() },
        });
        failed += batch.length;
        continue;
      }

      const byKey = new Map(scrapes.map((s) => [s.postKey, s]));
      for (const b of batch) {
        const s = byKey.get(b.postKey);
        if (!s) {
          await prisma.trackedPost.update({
            where: { id: b.id },
            data: {
              lastScrapedAt: new Date(),
              lastError: notFoundReason(platform, b.url),
            },
          });
          failed++;
          continue;
        }
        await prisma.trackedPost.update({
          where: { id: b.id },
          data: {
            lastScrapedAt: new Date(),
            lastError: null,
            prevLikes: b.curLikes,
            prevComments: b.curComments,
            prevViews: b.curViews,
            curLikes: s.likes,
            curComments: s.comments,
            curShares: s.shares,
            curViews: s.views,
          },
        });
        await prisma.trackedPostSnapshot.create({
          data: {
            trackedPostId: b.id,
            likes: s.likes,
            comments: s.comments,
            shares: s.shares,
            views: s.views,
            reactions: s.reactions ?? undefined,
            raw: s.raw as object,
          },
        });
        refreshed++;
      }
    }
  }

  return { refreshed, failed };
}

// How long a subscription may go without a discovery pass before the cron re-picks it.
// Influencers post roughly once a week on this account's own Scoutline data, so hourly
// would spend Apify credit to find nothing on most passes.
const PAGE_DISCOVERY_TTL_MS = Number(process.env.PAGE_DISCOVERY_TTL_HOURS || 12) * 60 * 60 * 1000;

/**
 * Discover new posts for the stalest N subscriptions.
 *
 * Batched on a frequent schedule rather than "walk every page hourly", for the reason
 * refresh-fan-pages' header spells out: one page is a full Apify run, so a single
 * invocation that walks every subscription cannot fit in any function time limit once
 * there are more than a handful. Selection is `lastDiscoveryAt` ascending, so successive
 * runs pick up where the last left off with no cursor to store, and a killed run changes
 * nothing — the pages it never reached keep their old timestamp and come back next time.
 *
 * A failing page still gets its lastDiscoveryAt bumped (see runPageDiscovery), so one
 * broken subscription cannot monopolise every batch and starve the rest.
 */
export async function discoverStalePages(batchSize: number): Promise<{
  attempted: number;
  added: number;
  failed: number;
}> {
  const cutoff = new Date(Date.now() - PAGE_DISCOVERY_TTL_MS);
  const due = await prisma.trackedPageSubscription.findMany({
    where: {
      isActive: true,
      OR: [{ lastDiscoveryAt: null }, { lastDiscoveryAt: { lt: cutoff } }],
    },
    // Nulls first: a page just subscribed has never been scanned and is the most urgent.
    orderBy: { lastDiscoveryAt: { sort: "asc", nulls: "first" } },
    take: batchSize,
    select: { id: true },
  });

  let added = 0;
  let failed = 0;
  for (const sub of due) {
    try {
      const result = await runPageDiscovery(sub.id);
      added += result.added;
    } catch {
      // Already recorded on the subscription's lastError. Swallowed so one broken page
      // doesn't abandon the rest of the batch — the same reason #51 exists for fan pages.
      failed++;
    }
  }

  return { attempted: due.length, added, failed };
}

/** Engagement history for one post — the only read path that touches the snapshot table. */
export async function getTrackedPostTrend(trackedPostId: string) {
  const snaps = await prisma.trackedPostSnapshot.findMany({
    where: { trackedPostId },
    orderBy: { capturedAt: "asc" },
    select: { capturedAt: true, likes: true, comments: true, views: true },
  });
  return snaps.map((s, i) => {
    const current = { engagement: engagement({ likes: s.likes, comments: s.comments }), at: s.capturedAt };
    const prior = i > 0 ? snaps[i - 1] : null;
    return {
      capturedAt: s.capturedAt,
      engagement: current.engagement,
      views: s.views,
      velocityPerDay: prior
        ? velocityPerDay(current, {
            engagement: engagement({ likes: prior.likes, comments: prior.comments }),
            at: prior.capturedAt,
          })
        : null,
    };
  });
}
