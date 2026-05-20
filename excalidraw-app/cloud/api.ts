import { cloudAuth } from "./auth";

export type CloudDrawingSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type CloudDrawing = CloudDrawingSummary & {
  elements: readonly unknown[];
  app_state: Record<string, unknown>;
  files: Record<string, unknown>;
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
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Request failed (${response.status})`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
};

export const listDrawings = async () => {
  const data = await cloudFetch<{ drawings: CloudDrawingSummary[] }>(
    "/api/drawings",
  );
  return data.drawings;
};

export const createDrawing = async (payload: {
  title: string;
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}) => {
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
  payload: {
    title: string;
    elements: readonly unknown[];
    appState: Record<string, unknown>;
    files: Record<string, unknown>;
  },
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
