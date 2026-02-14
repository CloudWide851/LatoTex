import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#edf7ff",
          100: "#d7edff",
          200: "#b6dcff",
          300: "#8bc4ff",
          400: "#5aa2ff",
          500: "#337eff",
          600: "#1f60f6",
          700: "#1a4be2",
          800: "#1d3fb7",
          900: "#1d388f"
        }
      },
      boxShadow: {
        soft: "0 10px 30px rgba(31, 41, 55, 0.10)"
      }
    }
  },
  plugins: []
};

export default config;
