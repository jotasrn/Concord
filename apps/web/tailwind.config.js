/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Concord design tokens - neon teal primary over a cold graphite base.
        abyss: {
          900: '#080B10',
          800: '#0D121A',
          700: '#131A24',
          600: '#1A2230',
          500: '#232D3D',
          400: '#2F3B4D',
        },
        plasma: {
          400: '#3DF5DC',
          500: '#00E5D0',
          600: '#00B8A6',
        },
        ember: {
          400: '#FF6B9E',
          500: '#FF3D7F',
          600: '#D62B66',
        },
        status: {
          online: '#3BE38B',
          idle: '#F5C542',
          dnd: '#FF4757',
          offline: '#6B7688',
        },
        ink: {
          100: '#EDF1F7',
          200: '#C3CBD9',
          300: '#8E9AAD',
          400: '#667184',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(0, 229, 208, 0.45)',
        'glow-ember': '0 0 24px -4px rgba(255, 61, 127, 0.45)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
};
