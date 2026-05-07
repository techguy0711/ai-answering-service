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

export default async function CallsPage() {
  const tenantId = await getCurrentTenantId();

  const calls = await withTenant(tenantId, (db) =>
    db.callLog.findMany({ orderBy: { startedAt: "desc" }, take: 50 }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Calls</h1>
        <p className="text-sm text-muted-foreground">
          Most recent 50 calls with transcripts and outcomes.
        </p>
      </div>

      {calls.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No calls yet</CardTitle>
            <CardDescription>
              Once Twilio is wired up (Phase 4), every inbound call writes a
              row here via{" "}
              <code>POST /api/voice/webhooks/call-completed</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {calls.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {c.startedAt.toLocaleString()}
                  </CardTitle>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary">
                      {c.languageDetected ?? "?"}
                    </Badge>
                    <Badge variant="outline">
                      {Math.round(c.durationSeconds / 60)}m
                    </Badge>
                    <Badge>{c.outcome ?? "no outcome"}</Badge>
                  </div>
                </div>
              </CardHeader>
              {c.transcript ? (
                <CardContent>
                  <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {c.transcript}
                  </pre>
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
