// Twilio signs every inbound webhook with X-Twilio-Signature.
// Without verification, anyone who knows your URL can fire your TwiML
// endpoint and rack up calls. Always verify in production.
//
// Twilio's algorithm: HMAC-SHA1 of the full URL concatenated with
// alphabetically-sorted POST parameters, signed with your auth token,
// base64-encoded. The `twilio` SDK has a helper.

import twilio from "twilio";

export function verifyTwilioSignature(opts: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (process.env.SKIP_TWILIO_SIGNATURE_CHECK === "true") {
    console.warn(
      "[twilio-signature] check skipped — SKIP_TWILIO_SIGNATURE_CHECK=true",
    );
    return true;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("[twilio-signature] TWILIO_AUTH_TOKEN not set");
    return false;
  }
  if (!opts.signature) return false;

  return twilio.validateRequest(
    authToken,
    opts.signature,
    opts.url,
    opts.params,
  );
}
