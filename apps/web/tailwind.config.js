/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Inter',
          'Roboto',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Custom brand palette — calm, premium, not neon.
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5d9e0',
          300: '#b0b7c4',
          400: '#7f8898',
          500: '#5b6474',
          600: '#454c5a',
          700: '#333944',
          800: '#22262e',
          900: '#12141a',
        },
        accent: {
          50: '#eff5ff',
          100: '#dbe7fe',
          200: '#bfd4fe',
          300: '#93b6fd',
          400: '#608efa',
          500: '#3d6ef5',
          600: '#2952ea',
          700: '#2141d6',
          800: '#2138ae',
          900: '#213489',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,20,30,.04), 0 4px 12px rgba(15,20,30,.06)',
        elev: '0 4px 12px rgba(15,20,30,.08), 0 12px 32px rgba(15,20,30,.10)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
};
