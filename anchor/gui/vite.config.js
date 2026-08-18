import { sveltekit } from '@sveltejs/kit/vite';

/** @type {import('vite').UserConfig} */
export default {
  plugins: [sveltekit()],
  server: {
    proxy: { '/v1': 'http://127.0.0.1:8300' }
  }
};
