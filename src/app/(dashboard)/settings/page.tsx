import { withTenant, dbAdmin } from "@/lib/db";
import { getCurrentTenantId } from "@/lib/tenant";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function SettingsPage() {
  const tenantId = await getCurrentTenantId();

  const tenant = await dbAdmin.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, slug: true, billingStatus: true },
  });

  const phoneNumbers = await withTenant(tenantId, (db) =>
    db.phoneNumber.findMany(),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Business info, hours, AI personality, phone number.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business</CardTitle>
          <CardDescription>
            What the AI calls you when answering the phone.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Business name</Label>
            <Input defaultValue={tenant?.name ?? ""} disabled />
          </div>
          <div className="space-y-2">
            <Label>Slug</Label>
            <Input defaultValue={tenant?.slug ?? ""} disabled />
          </div>
          {/* TODO: hours, location, AI personality, default greeting */}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phone numbers</CardTitle>
          <CardDescription>
            Twilio numbers routed to this tenant&apos;s AI assistant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {phoneNumbers.length === 0 ? (
            <>
              <Badge variant="warning">No number provisioned</Badge>
              <p className="mt-3 text-sm text-muted-foreground">
                TODO (Phase 4): purchase a number via the Twilio API, create
                an AI Assistant for this tenant (or attach to a shared one —
                see open question #1), insert into{" "}
                <code>phone_numbers</code>.
              </p>
            </>
          ) : (
            <ul className="divide-y">
              {phoneNumbers.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span className="font-mono">{p.number}</span>
                  <span className="text-xs text-muted-foreground">
                    Twilio SID: {p.twilioSid}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI personality</CardTitle>
          <CardDescription>
            How the assistant talks to callers. Default: warm and
            professional, follows the caller&apos;s language fluidly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            TODO: editable system prompt, language behavior toggles, tone
            slider, test-call button.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
