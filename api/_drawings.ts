import { neon } from "@neondatabase/serverless";
import { createRemoteJWKSet, jwtVerify } from "jose";

const databaseUrl = process.env.DATABASE_URL;
const authUrl = process.env.NEON_AUTH_URL || process.env.VITE_NEON_AUTH_URL;
const jwksUrl =
  process.env.NEON_AUTH_JWKS_URL ||
  (authUrl ? `${authUrl.replace(/\/$/, "")}/.well-known/jwks.json` : "");

export const sql = (...args: Parameters<ReturnType<typeof neon>>) => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  return neon(databaseUrl)(...args);
};

const getJwks = () => {
  if (!jwksUrl) {
    throw new Error("NEON_AUTH_JWKS_URL or NEON_AUTH_URL is not configured");
  }

  return createRemoteJWKSet(new URL(jwksUrl));
};

export const ensureDrawingsSchema = async () => {
  await sql`
    create extension if not exists pgcrypto;
  `;
  await sql`
    create table if not exists drawings (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null,
      title text not null default 'Untitled',
      elements jsonb not null default '[]'::jsonb,
      app_state jsonb not null default '{}'::jsonb,
      files jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;
  await sql`
    create index if not exists drawings_owner_updated_idx
      on drawings (owner_id, updated_at desc);
  `;
};

export const requireUserId = async (req: {
  headers: Record<string, string | string[] | undefined>;
}) => {
  const authorization = req.headers.authorization;
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    throw Object.assign(new Error("Missing authorization token"), {
      statusCode: 401,
    });
  }

  const { payload } = await jwtVerify(token, getJwks());

  if (!payload.sub) {
    throw Object.assign(new Error("Invalid authorization token"), {
      statusCode: 401,
    });
  }

  return payload.sub;
};

export const sendError = (res: any, error: unknown) => {
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as any).statusCode === "number"
      ? (error as any).statusCode
      : 500;

  console.error("[cloud-drawings]", error);

  res.status(statusCode).json({
    error: error instanceof Error ? error.message : "Unexpected error",
  });
};

export const requireString = (value: unknown, fallback: string) => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
};

export const requireJsonObject = (value: unknown, fallback: unknown) => {
  if (value && typeof value === "object") {
    return value;
  }
  return fallback;
};
