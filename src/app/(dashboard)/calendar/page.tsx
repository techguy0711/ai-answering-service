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

export default async function CalendarPage() {
  const tenantId = await getCurrentTenantId();

  const conn = await withTenant(tenantId, (db) =>
    db.googleCalendarConnection.findUnique({ where: { tenantId } }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          The Google Calendar the AI books against.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Google Calendar connection</CardTitle>
          <CardDescription>
            One calendar per tenant. Two-way sync: manual events block AI
            bookings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {conn ? (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="success">Connected</Badge>
                <span className="text-sm text-muted-foreground">
                  {conn.googleAccountEmail} — calendar{" "}
                  <code>{conn.calendarId}</code>
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Last synced:{" "}
                {conn.lastSyncedAt
                  ? conn.lastSyncedAt.toLocaleString()
                  : "never"}
              </p>
              <Button variant="outline" disabled>
                Reconnect (TODO: Phase 3)
              </Button>
            </>
          ) : (
            <>
              <Badge variant="warning">Not connected</Badge>
              <p className="text-sm text-muted-foreground">
                Connect a Google account to let the AI check availability and
                book appointments.
              </p>
              <Button disabled title="Google OAuth flow not yet implemented">
                Connect Google Calendar
              </Button>
              <p className="text-xs text-muted-foreground">
                TODO (Phase 3): OAuth handshake, token storage in
                <code> google_calendar_connections </code>
                (encrypted via <code>TENANT_SECRETS_KEY</code>), pick
                calendar.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
