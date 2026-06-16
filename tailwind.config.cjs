/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui'],
        body: ['"Work Sans"', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        ink: '#0f172a',
        fog: '#e2e8f0',
        glow: '#7dd3fc',
        neon: '#f472b6',
      },
      boxShadow: {
        soft: '0 20px 60px -40px rgba(15, 23, 42, 0.6)',
      },
    },
  },
  plugins: [],
}
