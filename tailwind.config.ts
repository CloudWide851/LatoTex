import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eefcf8",
          100: "#d5f6eb",
          200: "#ace9d6",
          300: "#7fd7bc",
          400: "#4fbe9f",
          500: "#10a37f",
          600: "#0c8c6d",
          700: "#0d6f58",
          800: "#0f5847",
          900: "#0f493c"
        }
      },
      boxShadow: {
        soft: "0 10px 24px rgba(15, 23, 42, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
