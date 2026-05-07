import { dbAdmin, withTenant } from "@/lib/db";
import { getCurrentTenantId } from "@/lib/tenant";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function BillingPage() {
  const tenantId = await getCurrentTenantId();

  const tenant = await dbAdmin.tenant.findUnique({
    where: { id: tenantId },
    select: { billingStatus: true },
  });

  // Sum minutes consumed this calendar month from call_logs.
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const minutesThisMonth = await withTenant(tenantId, async (db) => {
    const calls = await db.callLog.findMany({
      where: { startedAt: { gte: startOfMonth } },
      select: { durationSeconds: true },
    });
    const seconds = calls.reduce((s, c) => s + c.durationSeconds, 0);
    return Math.ceil(seconds / 60);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Subscription and usage.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>
              Stripe integration coming in Phase 7.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge
              variant={
                tenant?.billingStatus === "ACTIVE"
                  ? "success"
                  : tenant?.billingStatus === "PAST_DUE"
                    ? "destructive"
                    : "secondary"
              }
            >
              {tenant?.billingStatus ?? "UNKNOWN"}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Usage this month</CardTitle>
            <CardDescription>
              Call minutes consumed since the 1st.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{minutesThisMonth}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              At Twilio cost (~$0.15–$0.30/min) and target retail of
              $1–$2/min, mark this up materially before charging.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
