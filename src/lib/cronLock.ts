// Row-based mutex for cron routes — see prisma/schema.prisma's CronLock model comment for
// why this is a raw atomic UPDATE and not a Postgres session advisory lock (pgbouncer
// transaction pooling makes session-held locks unsafe here).
//
// Needed once cron intervals got short enough that a slow invocation can still be running
// when the next tick fires — Vercel doesn't skip an overlapping invocation on its own.
// Without this, two overlapping runs of the same route would both query the same
// "unclassified" candidates before either had written results, doubling Claude/Apify calls
// for zero extra throughput.
import { prisma } from "@/lib/prisma";

// Returns true if the lock was acquired (caller should proceed), false if another
// invocation currently holds it (caller should skip this tick, not error).
export async function tryAcquireCronLock(name: string, ttlSeconds: number): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - ttlSeconds * 1000);
  // INSERT .. ON CONFLICT DO UPDATE .. WHERE: the WHERE guards the update itself, not just
  // the conflict detection — if the existing row's lockedAt is neither null nor stale, the
  // conflicting row is left untouched and this affects 0 rows, which is exactly "someone
  // else holds the lock." One atomic statement, no read-then-write race.
  const rowsAffected: number = await prisma.$executeRaw`
    INSERT INTO cron_locks (name, locked_at) VALUES (${name}, ${now})
    ON CONFLICT (name) DO UPDATE SET locked_at = ${now}
    WHERE cron_locks.locked_at IS NULL OR cron_locks.locked_at < ${staleBefore}
  `;
  return rowsAffected > 0;
}

// Best-effort — called from a finally block. If this never runs (the function was killed
// rather than returning), the TTL above is what actually recovers the lock, not this.
export async function releaseCronLock(name: string): Promise<void> {
  await prisma.$executeRaw`UPDATE cron_locks SET locked_at = NULL WHERE name = ${name}`;
}
