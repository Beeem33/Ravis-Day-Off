import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dev-only sink for frames the running game posts to itself.
 *
 * The browser can render the scene but has no way to put a file on disk, and
 * shuttling a screenshot back out through the console costs more than it is
 * worth. This gives the page somewhere to POST one: `window.shot()` renders a
 * frame, sends the base64 here, and it lands in `.shots/` where it can be
 * opened like any other file. Serve-time only — it never reaches a build.
 */
function shotSink(): Plugin {
  return {
    name: 'shot-sink',
    apply: 'serve',
    configureServer(server) {
      const dir = join(server.config.root, '.shots');
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
        });
        req.on('end', () => {
          try {
            const name = String(req.headers['x-shot-name'] ?? 'shot')
              .replace(/[^a-zA-Z0-9_-]/g, '')
              .slice(0, 60) || 'shot';
            mkdirSync(dir, { recursive: true });
            const file = join(dir, `${name}.jpg`);
            const buf = Buffer.from(body, 'base64');
            writeFileSync(file, buf);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file, bytes: buf.length }));
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [shotSink()],
  server: { port: 8180, strictPort: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 }
});
