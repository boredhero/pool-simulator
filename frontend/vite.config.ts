import { defineConfig } from 'vite';
const apiTarget=process.env.POOL_API_TARGET??'http://localhost:8000';
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/ws': { target: apiTarget.replace(/^http/,'ws'), ws: true, changeOrigin: false },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
