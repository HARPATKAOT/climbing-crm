import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Lets an isolated worktree reuse the host project's public browser config
  // without copying credentials into the worktree. Production keeps '.'.
  envDir: process.env.VITE_ENV_DIR || '.',
  plugins: [react()],
  server: {
    port: 3000,
    // נכשל במקום לזחול ל-3001/3002 כשהפורט תפוס, כדי שהכתובת תישאר קבועה
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:5001',
        changeOrigin: true
      }
    }
  }
});
