import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function serverSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options?: object }[]) =>
          toSet.forEach(c => cookieStore.set(c.name, c.value, c.options as Parameters<typeof cookieStore.set>[2])),
      },
    },
  );
}
