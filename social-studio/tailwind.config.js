/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ivory: '#f8f5ef',
        ink: '#171717',
        silver: '#a7a9ac',
        champagne: '#b59b6a'
      },
      boxShadow: {
        soft: '0 18px 50px rgba(23, 23, 23, 0.08)'
      }
    }
  },
  plugins: []
};
