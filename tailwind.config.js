/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
    './assets/js/**/*.js',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        darkbg: '#0f172a',
        darkcard: '#1e293b',
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f8fafc',
          border: '#e2e8f0',
        },
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      boxShadow: {
        flat: '0 1px 2px 0 rgb(15 23 42 / 0.04)',
        card: '0 1px 3px 0 rgb(15 23 42 / 0.06)',
      },
    },
  },
  safelist: [
    'bg-red-600',
    'bg-green-600',
    'translate-y-[-20px]',
    'opacity-0',
    'opacity-100',
    'scale-95',
    'scale-100',
    'animate-spin',
    'animate-fade-in',
    'nav-link-active',
    'badge-success',
    'badge-warning',
    'badge-danger',
    'badge-info',
    'badge-neutral',
    'badge-primary',
  ],
};
