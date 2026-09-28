import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Set BASE_PATH when deploying under a sub-path, e.g. BASE_PATH=/compcert-playground/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  worker: { format: 'es' },
});
