import "server-only";
import { NextResponse } from "next/server";
import { FastnError } from "@/lib/fastn";
import { OnboardingError } from "@/lib/onboarding-server";

// One JSON error shape for every API route: { error, hint? }.
export function errorResponse(err: unknown) {
  if (err instanceof FastnError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return NextResponse.json({ error: err.message, hint: err.hint ?? null, code: err.code ?? null }, { status });
  }
  if (err instanceof OnboardingError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Something went wrong." },
    { status: 500 },
  );
}

export function unauthorized() {
  return NextResponse.json({ error: "You are not signed in." }, { status: 401 });
}
