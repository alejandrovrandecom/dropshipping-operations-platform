// Test support for the running local Supabase stack.
//
// Credentials are read from the CLI at run time instead of being committed, so
// no key value ever reaches the repository, a bundle, or CI logs.
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

function localStackEnv(): Record<string, string> {
  const raw = execFileSync("npx", ["--yes", "supabase", "status", "-o", "env"], { encoding: "utf8" });
  const pairs = raw.split("\n").filter((line) => /^[A-Z_]+="/.test(line));
  if (pairs.length === 0) throw new Error("local Supabase stack is not running; run 'pnpm db:setup'");
  return Object.fromEntries(pairs.map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, "")];
  }));
}

const env = localStackEnv();

/** Runs SQL as the migration role. Used to read catalogs and to seed auth rows. */
export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: env.DB_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

export const anonClient = (): SupabaseClient =>
  createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });

export const clientWithToken = (accessToken: string): SupabaseClient =>
  createClient(env.API_URL, env.ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

const TOKEN_LIFETIME_SECONDS = 3600;

/** Mints a one-hour token for `userId` expiring `expiresInSeconds` from now, signed with `secret`. */
function mintToken(userId: string, expiresInSeconds: number, secret: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: userId, role: "authenticated", aud: "authenticated", iat: exp - TOKEN_LIFETIME_SECONDS, exp,
  })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

/** A correctly signed token that expired an hour ago. */
export const expiredToken = (userId: string): string =>
  mintToken(userId, -TOKEN_LIFETIME_SECONDS, env.JWT_SECRET);

/** Structurally valid and unexpired, but signed with the wrong secret: only the signature fails. */
export const tamperedToken = (userId: string): string =>
  mintToken(userId, TOKEN_LIFETIME_SECONDS, `${env.JWT_SECRET}-tampered`);

/** Creates a confirmed user and returns a client carrying that user's verified JWT. */
export async function signIn(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const password = "isolation-test-password";
  const client = anonClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user) throw error ?? new Error("sign up returned no user");
  await sql("update auth.users set email_confirmed_at = now() where id = $1", [data.user.id]);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, userId: data.user.id };
}

export const uniqueEmail = (label: string): string =>
  `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.test`;

/** A fresh name inside the reservation registry's `[a-z0-9_]{3,30}` alphabet. */
export const uniqueUsername = (): string =>
  `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
