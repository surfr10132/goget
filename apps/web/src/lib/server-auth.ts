export interface OtpRuntimeConfig {
  demoMode: boolean;
  hasSupabaseConfig: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/**
 * Centralized server-side OTP runtime config.
 * Demo mode is enabled when either required Supabase env var is missing.
 */
export function getOtpRuntimeConfig(): OtpRuntimeConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

  return {
    demoMode: !hasSupabaseConfig,
    hasSupabaseConfig,
    supabaseUrl,
    supabaseAnonKey,
  };
}
