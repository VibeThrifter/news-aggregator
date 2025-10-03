import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "./styles/**/*.{css,scss}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af"
        },
        ink: {
          900: "#0f172a",
          700: "#1e293b",
          500: "#334155",
          400: "#475569"
        },
        surface: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0"
        }
      },
      fontFamily: {
        sans: ["Inter", "var(--font-sans)", "system-ui", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "sans-serif"]
      },
      boxShadow: {
        card: "0 10px 30px -18px rgba(15, 23, 42, 0.25)"
      }
    }
  },
  plugins: []
};

export default config;
