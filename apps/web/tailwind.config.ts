import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#eef9f3",
          100: "#d5f0e1",
          400: "#34c47c",
          500: "#16a45f",
          600: "#0f8a4d",
          700: "#0c6a3d",
        },
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
