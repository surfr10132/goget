/// <reference types="expo/types" />

// Expo exposes EXPO_PUBLIC_* vars to the JS bundle at build time. Declaring the
// process.env surface keeps the mobile app compileable without @types/node
// (which would pull in dozens of irrelevant Node globals into RN code).
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  }
}

declare const process: { env: NodeJS.ProcessEnv };
