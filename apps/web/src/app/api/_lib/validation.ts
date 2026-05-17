import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type ValidationSuccess<T> = { success: true; data: T };
type ValidationFailure = { success: false; response: NextResponse };
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function issues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "root",
    message: issue.message,
  }));
}

function invalidRequest(error: z.ZodError): NextResponse {
  return NextResponse.json(
    { error: "invalid_request", issues: issues(error) },
    { status: 400 },
  );
}

export async function parseJsonBody<TSchema extends z.ZodTypeAny>(
  req: NextRequest,
  schema: TSchema,
): Promise<ValidationResult<z.infer<TSchema>>> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, response: invalidRequest(parsed.error) };
  }
  return { success: true, data: parsed.data };
}

export function parseSearchParams<TSchema extends z.ZodTypeAny>(
  req: NextRequest,
  schema: TSchema,
): ValidationResult<z.infer<TSchema>> {
  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, response: invalidRequest(parsed.error) };
  }
  return { success: true, data: parsed.data };
}
