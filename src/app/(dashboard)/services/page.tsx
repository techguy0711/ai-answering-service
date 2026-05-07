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
import { Button } from "@/components/ui/button";
import { formatCurrencyCents, formatDuration } from "@/lib/utils";

export default async function ServicesPage() {
  const tenantId = await getCurrentTenantId();

  const services = await withTenant(tenantId, (db) =>
    db.service.findMany({ orderBy: { name: "asc" } }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Services</h1>
          <p className="text-sm text-muted-foreground">
            The catalog the AI uses as ground truth when quoting prices.
          </p>
        </div>
        {/* TODO: open a "new service" modal — POST to /api/services */}
        <Button disabled title="CRUD endpoints not yet implemented">
          New service
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Catalog ({services.length})</CardTitle>
          <CardDescription>
            Add, edit, or deactivate services. Inactive services are hidden
            from the AI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No services yet. Run <code>npm run db:seed</code> for the
              barbershop starter set.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Duration</th>
                  <th className="pb-2">Price</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {services.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3 font-medium">{s.name}</td>
                    <td className="py-3 text-muted-foreground">
                      {formatDuration(s.durationMinutes)}
                    </td>
                    <td className="py-3">
                      {formatCurrencyCents(s.priceCents)}
                    </td>
                    <td className="py-3">
                      {s.active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
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
