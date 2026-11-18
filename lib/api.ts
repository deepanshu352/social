import { NextResponse } from "next/server";
import { ForbiddenError } from "./auth";

export function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Wraps a route handler: maps permission & validation errors to JSON responses. */
export function handle<A extends unknown[]>(fn: (...a: A) => Promise<Response>) {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof ForbiddenError) return jsonError("FORBIDDEN", e.message, e.perm === "auth" ? 401 : 403);
      console.error(e);
      return jsonError("BAD_REQUEST", e instanceof Error ? e.message : "Request failed", 400);
    }
  };
}

export const json = (data: unknown, status = 200) =>
  new NextResponse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), { status, headers: { "content-type": "application/json" } });
