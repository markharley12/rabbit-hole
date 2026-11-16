import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Every file under a folder, as paths relative to it with forward slashes. */
function filesUnder(root: string, prefix = ''): string[] {
  return readdirSync(`${root}/${prefix}`, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(root, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]))
    .sort()
}

/**
 * Emit dist/sw.js: pwa/sw.js with this build's file list and a version hash
 * written in. See pwa/sw.js for how it caches and why a new build waits.
 * Adapted from TreeQuiz's plugin; public/ is walked recursively here because
 * the map lives in public/content/.
 */
function serviceWorker(): Plugin {
  return {
    name: 'rabbit-hole-service-worker',
    apply: 'build',
    generateBundle: {
      // After Vite has emitted index.html, so it is in the bundle to be listed.
      order: 'post',
      handler(_, bundle) {
        const built = Object.keys(bundle).filter((name) => !name.endsWith('.map')).sort()
        const copied = filesUnder(here('public'))
        const hash = createHash('sha256')
        for (const name of built) {
          const out = bundle[name]
          hash.update(name).update(out.type === 'asset' ? out.source : out.code)
        }
        for (const name of copied) hash.update(name).update(readFileSync(here(`public/${name}`)))
        // The worker too, or a change to it alone would keep the old version name.
        let source = readFileSync(here('pwa/sw.js'), 'utf8')
        hash.update(source)

        const fills: [string, string][] = [
          ["const VERSION = 'dev'", `const VERSION = '${hash.digest('hex').slice(0, 12)}'`],
          ['const FILES = []', `const FILES = ${JSON.stringify([...built, ...copied].sort())}`],
        ]
        for (const [from, to] of fills) {
          // Loud rather than quietly shipping a worker that caches nothing.
          if (!source.includes(from)) throw new Error(`pwa/sw.js no longer contains: ${from}`)
          source = source.replace(from, to)
        }
        this.emitFile({ type: 'asset', fileName: 'sw.js', source })
      },
    },
  }
}

/**
 * KaTeX's stylesheet names each font three times (woff2, woff, ttf). Every
 * browser this app runs in reads woff2, and the service worker precaches
 * every built file, so keep only woff2: about 60 files fewer to install.
 */
function katexWoff2Only(): Plugin {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id.split('?')[0])) return null
      const trimmed = code.replace(/,\s*url\([^)]*\.woff\)\s*format\("woff"\)/g, '').replace(/,\s*url\([^)]*\.ttf\)\s*format\("truetype"\)/g, '')
      // Loud rather than quietly shipping all three again after a KaTeX update.
      if (trimmed === code || /\.(woff|ttf)\)/.test(trimmed)) throw new Error('katex.min.css changed shape; update katexWoff2Only()')
      return { code: trimmed, map: null }
    },
  }
}

/**
 * When and from which commit this build was made, shown on the home sheet so
 * it is easy to tell on the phone whether an update has arrived. "+changes"
 * marks a build from uncommitted work.
 */
function buildStamp() {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { cwd: here('.'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      return ''
    }
  }
  const commit = git('rev-parse --short HEAD') || 'unknown'
  return { time: new Date().toISOString(), commit: git('status --porcelain') ? `${commit}+changes` : commit }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [katexWoff2Only(), react(), serviceWorker()],
  define: { __APP_BUILD__: JSON.stringify(buildStamp()) },
  // Relative, so one build works at a domain's root or under any path.
  base: './',
  server: {
    host: true,
    // Reaching the dev server from the phone over Tailscale.
    allowedHosts: ['.ts.net'],
    // The tutor's API, from a running `npm run server` (server/rabbit_server.py).
    proxy: { '/api': 'http://127.0.0.1:8791' },
  },
  preview: { allowedHosts: ['.ts.net'] },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    // .tsx too: without it a component test is silently not run.
    include: ['src/**/*.test.{ts,tsx}'],
    // The whole-app flow tests take 3 to 5 s on a busy machine (several agents
    // running checks at once), and the default 5 s limit failed them at random.
    testTimeout: 20000,
  },
})
