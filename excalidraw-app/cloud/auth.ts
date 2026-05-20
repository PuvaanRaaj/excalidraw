import { createInternalNeonAuth } from "@neondatabase/auth";

const authUrl = import.meta.env.VITE_NEON_AUTH_URL;

export const cloudAuth = authUrl ? createInternalNeonAuth(authUrl) : null;

export type CloudUser = {
  id: string;
  email: string;
  name?: string;
};
