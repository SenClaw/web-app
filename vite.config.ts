import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Dev/preview proxy target for /api — the daemon's UI port. Defaults to the
// real daemon's port (18788); point it at a disposable test daemon instead
// (e.g. one started with SENCLAW_UI_PORT=28788, per the migration plan's
// scratch-HOME convention) by setting VITE_DAEMON_URL, either in the shell
// or in a .env.local file (gitignored) at the repo root:
//   VITE_DAEMON_URL=http://127.0.0.1:28788 npm run dev
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = env.VITE_DAEMON_URL || 'http://127.0.0.1:18788';

  return {
    plugins: [react()],
    server: {
      // Dev mode: proxy /api to UIServer
      proxy: {
        '/api': target,
      },
    },
    // Also for preview mode
    preview: {
      proxy: {
        '/api': target,
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        },
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-markdown': ['react-markdown', 'remark-gfm', 'rehype-highlight', 'highlight.js'],
          },
        },
      },
    },
  };
});
