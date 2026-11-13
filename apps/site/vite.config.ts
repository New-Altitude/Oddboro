import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Port 4501 is fixed. Every page prerenders to build/, so any static host
// serves the site as plain files. Each page carries its styles inline (about
// 11 KB compressed), so the first paint waits on no other request.
export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({ adapter: adapter({ strict: true }), inlineStyleThreshold: 64 * 1024 })
  ],
  server: { port: 4501, strictPort: true },
  preview: { port: 4501, strictPort: true }
});
