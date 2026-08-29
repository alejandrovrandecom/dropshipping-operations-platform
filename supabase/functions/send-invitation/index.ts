// Edge Function boundary for sending a team invitation. It holds no privileged key: it
// forwards the caller's verified JWT to `create_invitation`, so the database -- not this
// function -- decides whether the caller owns the team. Delivery is resolved BEFORE the
// invitation is issued, so an environment with no provider configured can neither leave a
// dangling invitation behind nor report a send that never happened.
import { createClient } from "npm:@supabase/supabase-js@2";
import { DeliveryNotConfigured, resolveDelivery } from "./delivery.ts";

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (request: Request): Promise<Response> => {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ delivered: false, error: "authentication required" }, 401);
  let delivery;
  try {
    delivery = resolveDelivery(Deno.env.toObject());
  } catch (error) {
    if (error instanceof DeliveryNotConfigured) return json({ delivered: false, error: error.message }, 503);
    throw error;
  }
  const { team_id, email } = await request.json().catch(() => ({}));
  if (typeof team_id !== "string" || typeof email !== "string")
    return json({ delivered: false, error: "team_id and email are required" }, 400);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: token, error } = await client.rpc("create_invitation", { target_team_id: team_id, invitee_email: email });
  if (error) return json({ delivered: false, error: error.message }, 403);
  const site = Deno.env.get("INVITATION_SITE_URL") ?? "http://127.0.0.1:3000";
  await delivery.send({ to: email, teamId: team_id, acceptUrl: `${site}/invitations/${token}` });
  return json({ delivered: true, channel: delivery.channel }, 200);
});
