import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          raised: "hsl(var(--surface-raised))",
        },
        tertiary: "hsl(var(--tertiary))",
        "border-subtle": "hsl(var(--border-subtle))",
        positive: "hsl(var(--positive))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
      },
      fontFamily: {
        barlow: ["Barlow-Regular"],
        "barlow-medium": ["Barlow-Medium"],
        "barlow-semibold": ["Barlow-SemiBold"],
        "barlow-bold": ["Barlow-Bold"],
        "barlow-sc-medium": ["BarlowSemiCondensed-Medium"],
        "barlow-sc-semibold": ["BarlowSemiCondensed-SemiBold"],
      },
    },
  },
  plugins: [],
} satisfies Config;
