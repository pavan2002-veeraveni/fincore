import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        fincore: {
          navy: '#0B1F3A',
          slate: '#132E52',
          emerald: '#059669',
          amber: '#D97706',
          crimson: '#DC2626',
        },
      },
    },
  },
  plugins: [],
};

export default config;
