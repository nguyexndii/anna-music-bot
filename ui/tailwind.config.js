/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
      },
      colors: {
        anna: {
          bg: '#111214',
          surface: '#1E1F22',
          card: '#2B2D31',
          hover: '#35373C',
          border: '#3F4147',
          accent: '#5865F2',
          accentHover: '#4752C4',
          pink: '#EB459E',
          green: '#23A55A',
          yellow: '#FEE75C',
          red: '#F23F43',
          text: '#DBDEE1',
          muted: '#949BA4'
        }
      },
      animation: {
        'spin-slow': 'spin 14s linear infinite',
      }
    },
  },
  plugins: [],
}
