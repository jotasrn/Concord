/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Identidade Concord: base preta real, acentos em roxo.
        void: {
          950: '#000000',
          900: '#07070A',
          850: '#0C0C11',
          800: '#121218',
          700: '#1A1A22',
          600: '#24242E',
          500: '#32323E',
          400: '#45454F',
        },
        violet: {
          300: '#C4A6FF',
          400: '#A87BFF',
          500: '#8B5CF6',
          600: '#7333E8',
          700: '#5B21B6',
        },
        status: {
          online: '#3BE38B',
          idle: '#F5C542',
          dnd: '#FF4757',
          offline: '#5A5A66',
        },
        ink: {
          100: '#F2F0F7',
          200: '#C9C4D6',
          300: '#8E8899',
          400: '#5F5A6B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 28px -6px rgba(139, 92, 246, 0.55)',
        'glow-soft': '0 0 18px -8px rgba(168, 123, 255, 0.7)',
      },
      keyframes: {
        pulseRing: {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'pulse-ring': 'pulseRing 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
