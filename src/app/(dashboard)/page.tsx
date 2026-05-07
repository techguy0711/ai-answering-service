import { withTenant } from "@/lib/db";
import { getCurrentTenantId } from "@/lib/tenant";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrencyCents } from "@/lib/utils";

export default async function OverviewPage() {
  const tenantId = await getCurrentTenantId();

  const data = await withTenant(tenantId, async (db) => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const [todayBookings, recentCalls, todayAppointments] = await Promise.all([
      db.appointment.count({
        where: {
          startTime: { gte: startOfDay, lte: endOfDay },
          status: { not: "CANCELED" },
        },
      }),
      db.callLog.findMany({
        orderBy: { startedAt: "desc" },
        take: 5,
      }),
      db.appointment.findMany({
        where: {
          startTime: { gte: startOfDay, lte: endOfDay },
          status: { not: "CANCELED" },
        },
        include: { service: true },
        orderBy: { startTime: "asc" },
      }),
    ]);

    const todayRevenueCents = todayAppointments.reduce(
      (sum, a) => sum + a.service.priceCents,
      0,
    );

    return { todayBookings, recentCalls, todayRevenueCents };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Today&apos;s activity at a glance.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Today&apos;s bookings</CardDescription>
            <CardTitle className="text-3xl">{data.todayBookings}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Projected revenue today</CardDescription>
            <CardTitle className="text-3xl">
              {formatCurrencyCents(data.todayRevenueCents)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Recent calls</CardDescription>
            <CardTitle className="text-3xl">{data.recentCalls.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent calls</CardTitle>
          <CardDescription>
            Most recent {data.recentCalls.length} calls.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.recentCalls.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No calls yet. Once Twilio is wired up (Phase 4), they&apos;ll
              show up here.
            </p>
          ) : (
            <ul className="divide-y">
              {data.recentCalls.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span>{c.startedAt.toLocaleString()}</span>
                  <span className="text-muted-foreground">
                    {c.durationSeconds}s — {c.outcome ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
