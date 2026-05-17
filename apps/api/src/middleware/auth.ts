import type { MiddlewareHandler } from "hono";
import { supabase } from "../clients";

export interface AuthContext {
  userId: string;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "missing bearer token" }, 401);
  }
  const token = header.slice("Bearer ".length);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return c.json({ error: "invalid token" }, 401);
  c.set("auth", { userId: data.user.id });
  await next();
};
