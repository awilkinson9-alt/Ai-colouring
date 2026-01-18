/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    function({ addVariant }) {
      // Landscape variant for small devices only (max-width: 1023px)
      addVariant('landscape', '@media (orientation: landscape) and (max-width: 1023px)')
    }
  ],
}
