// Provider-neutral invitation delivery boundary. Callers depend on this port, never on a
// vendor SDK, so adopting a provider later is a change to this file alone. Local and test
// environments capture deterministically, which keeps the flow runtime-testable with no
// external delivery; every other environment must be configured explicitly and fails loudly,
// because reporting a delivery that never happened is worse than refusing to send.
// Production readiness is tracked in `docs/security/database-security.md`.
export type InvitationMessage = { to: string; teamId: string; acceptUrl: string };
export type DeliveryPort = { readonly channel: string; send(message: InvitationMessage): Promise<void> };
export type CaptureDelivery = DeliveryPort & { readonly sent: InvitationMessage[] };

export class DeliveryNotConfigured extends Error {
  constructor(environment: string) {
    super(`invitation delivery is not configured for '${environment}'; no email was sent`);
    this.name = "DeliveryNotConfigured";
  }
}

/** Records instead of sending. The token leaves the process only through this log line. */
export function createCaptureDelivery(): CaptureDelivery {
  const sent: InvitationMessage[] = [];
  const send = async (message: InvitationMessage): Promise<void> => {
    sent.push(message);
    console.log(`[invitation:capture] ${JSON.stringify(message)}`);
  };
  return { channel: "capture", sent, send };
}

/** Resolves the adapter for an environment, failing closed when no provider is configured. */
export function resolveDelivery(env: Record<string, string | undefined>): DeliveryPort {
  const environment = env.INVITATION_ENV ?? "unset";
  if (environment === "local" || environment === "test") return createCaptureDelivery();
  throw new DeliveryNotConfigured(environment);
}
