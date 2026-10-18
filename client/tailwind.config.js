/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './report/index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      keyframes: {
        flash: {
          '0%': { backgroundColor: 'rgb(254 243 199)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'slide-in': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        flash: 'flash 2.5s ease-out',
        'slide-in': 'slide-in 0.2s ease-out',
        marquee: 'marquee 60s linear infinite',
      },
    },
  },
  plugins: [],
};
