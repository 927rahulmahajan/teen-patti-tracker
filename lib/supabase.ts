import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Single anon client. No auth in this product (shared phone); RLS is open-anon.
// Missing env fails loudly at call time rather than silently no-op'ing.
export const supabase =
  url && anonKey
    ? createClient(url, anonKey)
    : (new Proxy(
        {},
        {
          get() {
            throw new Error(
              "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
            );
          },
        },
      ) as ReturnType<typeof createClient>);

export const supabaseConfigured = Boolean(url && anonKey);
