const databaseUrl = process.env.DATABASE_URL;
const authUrl = process.env.NEON_AUTH_URL || process.env.VITE_NEON_AUTH_URL;
const jwksUrl =
  process.env.NEON_AUTH_JWKS_URL ||
  (authUrl ? `${authUrl.replace(/\/$/, "")}/.well-known/jwks.json` : "");

let sqlClient: any;
let remoteJwks: any;

export const sql = async (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!sqlClient) {
    const { neon } = await import("@neondatabase/serverless");
    sqlClient = neon(databaseUrl);
  }

  return sqlClient(strings, ...values);
};

const getJwks = async () => {
  if (!jwksUrl) {
    throw new Error("NEON_AUTH_JWKS_URL or NEON_AUTH_URL is not configured");
  }

  if (!remoteJwks) {
    const { createRemoteJWKSet } = await import("jose");
    remoteJwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  return remoteJwks;
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
    alter table drawings
      add column if not exists folder text,
      add column if not exists tags text[] not null default '{}'::text[],
      add column if not exists is_starred boolean not null default false,
      add column if not exists deleted_at timestamptz;
  `;
  await sql`
    create index if not exists drawings_owner_updated_idx
      on drawings (owner_id, updated_at desc);
  `;
  await sql`
    create index if not exists drawings_owner_deleted_updated_idx
      on drawings (owner_id, deleted_at, updated_at desc);
  `;
  await sql`
    create table if not exists drawing_shares (
      id uuid primary key default gen_random_uuid(),
      drawing_id uuid not null references drawings(id) on delete cascade,
      owner_id text not null,
      permission text not null check (permission in ('view', 'edit')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;
  await sql`
    create index if not exists drawing_shares_drawing_owner_idx
      on drawing_shares (drawing_id, owner_id, created_at desc);
  `;
  await sql`
    create table if not exists drawing_versions (
      id uuid primary key default gen_random_uuid(),
      drawing_id uuid not null references drawings(id) on delete cascade,
      owner_id text not null,
      title text not null,
      elements jsonb not null,
      app_state jsonb not null,
      files jsonb not null,
      created_at timestamptz not null default now()
    );
  `;
  await sql`
    create index if not exists drawing_versions_drawing_owner_created_idx
      on drawing_versions (drawing_id, owner_id, created_at desc);
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

  const { jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(token, await getJwks());

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

export const requireUuid = (value: unknown, fieldName: string) => {
  const id = requireString(value, "");

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    throw Object.assign(new Error(`${fieldName} must be a valid uuid`), {
      statusCode: 400,
    });
  }

  return id;
};

export const requireOptionalString = (
  value: unknown,
  fieldName: string,
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  throw Object.assign(new Error(`${fieldName} must be a string or null`), {
    statusCode: 400,
  });
};

export const requireStringArray = (value: unknown, fieldName: string) => {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`${fieldName} must be an array of strings`), {
      statusCode: 400,
    });
  }

  const tags = value.map((tag) => {
    if (typeof tag !== "string") {
      throw Object.assign(
        new Error(`${fieldName} must be an array of strings`),
        {
          statusCode: 400,
        },
      );
    }

    return tag.trim();
  });

  return Array.from(new Set(tags.filter(Boolean))).slice(0, 50);
};

export const requireBoolean = (value: unknown, fieldName: string) => {
  if (typeof value !== "boolean") {
    throw Object.assign(new Error(`${fieldName} must be a boolean`), {
      statusCode: 400,
    });
  }

  return value;
};

export const requirePermission = (value: unknown) => {
  if (value === "view" || value === "edit") {
    return value;
  }

  throw Object.assign(new Error("permission must be 'view' or 'edit'"), {
    statusCode: 400,
  });
};

export const insertDrawingVersion = async (
  drawingId: string,
  ownerId: string,
) => {
  const [drawing] = await sql`
    select title, elements, app_state, files
    from drawings
    where id = ${drawingId}::uuid and owner_id = ${ownerId}
  `;

  if (!drawing) {
    return false;
  }

  await sql`
    insert into drawing_versions (
      drawing_id,
      owner_id,
      title,
      elements,
      app_state,
      files
    )
    values (
      ${drawingId}::uuid,
      ${ownerId},
      ${drawing.title},
      ${JSON.stringify(drawing.elements)}::jsonb,
      ${JSON.stringify(drawing.app_state)}::jsonb,
      ${JSON.stringify(drawing.files)}::jsonb
    )
  `;

  return true;
};
