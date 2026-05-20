import { cloudAuth } from "./auth";

export type CloudDrawingSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  folder?: string | null;
  tags?: string[] | null;
  starred?: boolean | null;
  is_starred?: boolean | null;
  trashed_at?: string | null;
  deleted_at?: string | null;
};

export type CloudDrawing = CloudDrawingSummary & {
  elements: readonly unknown[];
  app_state: Record<string, unknown>;
  files: Record<string, unknown>;
};

export type CloudDrawingMetadata = {
  folder?: string;
  tags?: string[];
  starred?: boolean;
  isStarred?: boolean;
};

export type CloudDrawingPayload = CloudDrawingMetadata & {
  title: string;
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export type CloudSharePermission = "view" | "edit";

export type CloudShareLink = {
  id?: string;
  shareId?: string;
  share_id?: string;
  permission: CloudSharePermission;
  created_at?: string;
};

export type CloudDrawingVersion = {
  id?: string;
  versionId?: string;
  version_id?: string;
  created_at: string;
  title?: string;
};

const getAuthHeaders = async () => {
  if (!cloudAuth) {
    throw new Error("VITE_NEON_AUTH_URL is not configured");
  }

  const token = await cloudAuth.getJWTToken();

  if (!token) {
    throw new Error("You need to sign in before using cloud drawings");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
};

const cloudFetch = async <T>(path: string, init: RequestInit = {}) => {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(async () => {
      const text = await response.text().catch(() => "");
      return text ? { error: text } : null;
    });
    const detail = body?.error
      ? `: ${String(body.error).slice(0, 180)}`
      : "";

    throw new Error(`Cloud request failed (${response.status})${detail}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
};

export const listDrawings = async () => {
  const [activeData, trashData] = await Promise.all([
    cloudFetch<{ drawings: CloudDrawingSummary[] }>("/api/drawings"),
    cloudFetch<{ drawings: CloudDrawingSummary[] }>("/api/drawings?trash=1"),
  ]);
  return [...activeData.drawings, ...trashData.drawings];
};

export const createDrawing = async (payload: CloudDrawingPayload) => {
  const data = await cloudFetch<{ drawing: CloudDrawing }>("/api/drawings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.drawing;
};

export const getDrawing = async (id: string) => {
  const data = await cloudFetch<{ drawing: CloudDrawing }>(
    `/api/drawings/${id}`,
  );
  return data.drawing;
};

export const updateDrawing = async (
  id: string,
  payload: CloudDrawingPayload,
) => {
  const data = await cloudFetch<{ drawing: CloudDrawing }>(
    `/api/drawings/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
  return data.drawing;
};

export const deleteDrawing = async (id: string) => {
  await cloudFetch<null>(`/api/drawings/${id}`, { method: "DELETE" });
};

export const restoreDrawing = async (id: string) => {
  const data = await cloudFetch<{ drawing?: CloudDrawing }>(
    `/api/drawings/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ deleted: false }),
    },
  );
  return data?.drawing || null;
};

const normalizeShareLinks = (data: {
  shares?: CloudShareLink[];
  shareLinks?: CloudShareLink[];
  share?: CloudShareLink;
}) => data.shares || data.shareLinks || (data.share ? [data.share] : []);

export const listShareLinks = async (id: string) => {
  const data = await cloudFetch<{
    shares?: CloudShareLink[];
    shareLinks?: CloudShareLink[];
    share?: CloudShareLink;
  }>(`/api/drawings/${id}/share`);
  return normalizeShareLinks(data);
};

export const createShareLink = async (
  id: string,
  permission: CloudSharePermission,
) => {
  const data = await cloudFetch<{
    share?: CloudShareLink;
    shareLink?: CloudShareLink;
  }>(
    `/api/drawings/${id}/share`,
    {
      method: "POST",
      body: JSON.stringify({ permission }),
    },
  );
  return data.share || data.shareLink;
};

export const deleteShareLink = async (id: string, shareId: string) => {
  await cloudFetch<null>(
    `/api/drawings/${id}/share?shareId=${encodeURIComponent(shareId)}`,
    { method: "DELETE" },
  );
};

export const listDrawingVersions = async (id: string) => {
  const data = await cloudFetch<{ versions?: CloudDrawingVersion[] }>(
    `/api/drawings/${id}/versions`,
  );
  return data.versions || [];
};

export const restoreDrawingVersion = async (id: string, versionId: string) => {
  const data = await cloudFetch<{ drawing: CloudDrawing }>(
    `/api/drawings/${id}/versions`,
    {
      method: "POST",
      body: JSON.stringify({ versionId }),
    },
  );
  return data.drawing;
};
