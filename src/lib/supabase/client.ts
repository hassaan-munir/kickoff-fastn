import { createBrowserClient } from "@supabase/ssr";

// Supabase client for Client Components. Uses the public anon key; row level
// security decides what the signed-in user can read and write.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
