import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

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
          900: "#1a1a1a",
          800: "#262626",
          700: "#333333",
          600: "#4a4a4a",
          500: "#666666",
          400: "#808080",
          300: "#999999",
          200: "#b3b3b3"
        },
        paper: {
          50: "#ffffff",
          100: "#fafafa",
          200: "#f5f5f5",
          300: "#eeeeee"
        },
        accent: {
          red: "#E30613",
          blue: "#1F75CE",
          orange: "#FF6600"
        },
        surface: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0"
        }
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "'Segoe UI'", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "Cambria", "'Times New Roman'", "Times", "serif"]
      },
      fontSize: {
        "masthead": ["2.75rem", { lineHeight: "1.1", fontWeight: "700" }],
        "headline-xl": ["1.875rem", { lineHeight: "1.15", fontWeight: "700" }],
        "headline-lg": ["1.5rem", { lineHeight: "1.2", fontWeight: "700" }],
        "headline-md": ["1.25rem", { lineHeight: "1.25", fontWeight: "600" }],
        "headline-sm": ["1.125rem", { lineHeight: "1.3", fontWeight: "600" }],
        "category": ["0.6875rem", { lineHeight: "1", fontWeight: "600", letterSpacing: "0.05em" }]
      },
      boxShadow: {
        card: "0 10px 30px -18px rgba(15, 23, 42, 0.25)",
        "card-light": "0 1px 3px rgba(0, 0, 0, 0.08)"
      }
    }
  },
  plugins: [typography]
};

export default config;
