// Tenant resolution helpers.
//
// The dashboard resolves tenant from the authenticated session.
// The voice webhooks resolve tenant from the called Twilio number.

import { auth } from "@/auth";
import { dbAdmin } from "@/lib/db";

/**
 * Pulls tenantId from the current Auth.js session. Throws if there's no
 * session — callers are expected to be behind middleware that enforces auth.
 */
export async function getCurrentTenantId(): Promise<string> {
  const session = await auth();
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    throw new Error("No authenticated tenant in session");
  }
  return tenantId;
}

/**
 * Maps an inbound Twilio number (E.164) to a tenant_id.
 * Used by /api/voice/* endpoints.
 *
 * NOTE: this uses dbAdmin because we don't have tenant context yet — that's
 * literally what we're trying to figure out. Returning null lets the caller
 * decide whether to 404 or play a fallback message.
 */
export async function tenantIdForTwilioNumber(
  toNumber: string,
): Promise<string | null> {
  const row = await dbAdmin.phoneNumber.findUnique({
    where: { number: toNumber },
    select: { tenantId: true },
  });
  return row?.tenantId ?? null;
}
