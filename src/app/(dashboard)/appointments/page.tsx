import { withTenant } from "@/lib/db";
import { getCurrentTenantId } from "@/lib/tenant";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AppointmentsPage() {
  const tenantId = await getCurrentTenantId();

  const appointments = await withTenant(tenantId, (db) =>
    db.appointment.findMany({
      orderBy: { startTime: "desc" },
      take: 100,
      include: { service: true },
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Appointments</h1>
        <p className="text-sm text-muted-foreground">
          Booked slots, AI-created and manually-added.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All appointments ({appointments.length})</CardTitle>
          <CardDescription>
            Use the calendar UI for richer interaction. This is the raw list.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No appointments yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">When</th>
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">Service</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {appointments.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3">
                      {a.startTime.toLocaleString()}
                    </td>
                    <td className="py-3">
                      <div className="font-medium">{a.customerName}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.customerPhone}
                      </div>
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {a.service.name}
                    </td>
                    <td className="py-3">
                      <Badge
                        variant={a.source === "AI" ? "default" : "secondary"}
                      >
                        {a.source}
                      </Badge>
                    </td>
                    <td className="py-3">
                      <Badge
                        variant={
                          a.status === "CANCELED"
                            ? "destructive"
                            : a.status === "CONFIRMED"
                              ? "success"
                              : "secondary"
                        }
                      >
                        {a.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
