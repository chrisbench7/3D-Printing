import { defineConfig } from 'vite';

// BASE_PATH lets the GitHub Pages build serve from /3D-Printing/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  publicDir: false,
});
