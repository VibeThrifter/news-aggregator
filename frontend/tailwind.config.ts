import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        night: {
          900: "#04030f",
          800: "#0b1120",
          700: "#121c33"
        },
        aurora: {
          500: "#38bdf8",
          600: "#6366f1",
          700: "#a855f7"
        }
      },
      boxShadow: {
        glow: "0 0 50px -10px rgba(56, 189, 248, 0.45)"
      },
      fontFamily: {
        sans: ["Inter", "var(--font-sans)"]
      }
    }
  },
  plugins: []
};

export default config;
