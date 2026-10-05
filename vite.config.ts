import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  // Relative assets work both at / and at /repository-name/ on GitHub Pages.
  base:'./',plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
  build:{outDir:'dist',emptyOutDir:true},
  server:{port:5173,proxy:{'/api':{target:'http://127.0.0.1:4174',changeOrigin:false}}}
});
