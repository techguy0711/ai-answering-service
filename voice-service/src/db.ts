// Prisma client + tenant-scoped query helper.
//
// Exact same pattern as the dashboard's src/lib/db.ts — kept independent so
// each service can be deployed/scaled separately. The two services share the
// same Postgres database and the same Prisma schema (we point `db:generate`
// at the dashboard's schema file).
//
// withTenant() wraps queries in a transaction that runs
//   SELECT set_config('app.current_tenant', $1, true)
// which the RLS policies on every per-tenant table read.

import { PrismaClient, Prisma } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const dbAdmin =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = dbAdmin;
}

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!isCuidLike(tenantId)) {
    throw new Error(`Invalid tenantId: ${tenantId}`);
  }
  // We use $transaction purely for its scoping behavior (SET LOCAL only
  // applies for the lifetime of the transaction). We don't let it own the
  // return type — Prisma's overloaded $transaction signature interferes
  // with T inference at call sites. So we capture the result in an outer
  // variable typed as T (from the user-facing generic), and just await the
  // transaction for side effects.
  let captured!: T;
  await dbAdmin.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    captured = await fn(tx);
  });
  return captured;
}

function isCuidLike(s: string): boolean {
  return typeof s === "string" && /^[a-z0-9]{8,}$/i.test(s) && s.length <= 64;
}
