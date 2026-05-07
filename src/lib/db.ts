// Prisma client + tenant-scoped query helper.
//
// Two ways to run a query:
//
//   1. `withTenant(tenantId, async (db) => db.service.findMany())`
//      — wraps the query in a transaction that runs
//        `SET LOCAL app.current_tenant = '<tenantId>'` first.
//        This is what RLS reads. Use this for ALL request-scoped queries.
//
//   2. `dbAdmin` — raw Prisma client with no tenant context.
//      Use ONLY for:
//        - Auth lookups (find user by email before we know their tenant)
//        - Twilio webhook lookups (find tenant by called number)
//        - Migrations / seed
//        - Cross-tenant admin tools (none yet)
//      Be careful: in dev (superuser connection) this works for everything;
//      in production (limited role) anything tenant-scoped via dbAdmin will
//      return zero rows. That's the safety net biting — fix the call site.

import { PrismaClient, Prisma } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const dbAdmin =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = dbAdmin;
}

/**
 * Run `fn` against a Prisma transaction client that has
 * `app.current_tenant` set to `tenantId`. RLS policies will scope every
 * query to that tenant.
 *
 * IMPORTANT: only the tx client passed to `fn` carries the tenant context.
 * If you call `dbAdmin.x.findMany()` inside `fn`, that query bypasses the
 * context.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!isCuidLike(tenantId)) {
    // Defensive — tenantId is interpolated into SQL via $executeRawUnsafe-style
    // setting, so we sanity-check the shape. Real defense is the cast inside
    // the SET below + Prisma's parameter binding.
    throw new Error(`Invalid tenantId: ${tenantId}`);
  }

  return dbAdmin.$transaction(async (tx) => {
    // Prisma.sql safely parameterizes. PG's set_config(name, value, is_local)
    // is the parameterized form of SET LOCAL.
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return fn(tx);
  });
}

function isCuidLike(s: string): boolean {
  // cuid format: c + 24 alphanumeric. Loose check.
  return typeof s === "string" && /^[a-z0-9]{8,}$/i.test(s) && s.length <= 64;
}
