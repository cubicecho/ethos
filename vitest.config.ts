import path from 'node:path';
import { defineConfig } from 'vitest/config';

const alias = [
  { find: '@', replacement: path.resolve(import.meta.dirname, './app/src') },
  // graphql ships no exports map, so Vite and Node load different copies and a
  // schema built on one fails the other's instanceof checks. Pin Node's copy.
  { find: /^graphql$/, replacement: path.resolve(import.meta.dirname, './node_modules/graphql/index.js') },
];

// Two projects, because one global `environment` cannot be both worlds. The
// server and db tests run a real Postgres in-process and must not pay for a DOM;
// the component tests are a DOM and nothing else.
export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**'],
    // A test that forgets to build its own throwaway database gets an empty URL
    // and fails loudly, rather than quietly writing to the developer's Postgres.
    env: { DATABASE_URL: '' },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['db/**/*.test.ts', 'server/**/*.test.ts', 'app/src/lib/**/*.test.ts'],
        },
      },
      {
        extends: true,
        resolve: {
          alias: [
            ...alias,
            // `lib/apollo.ts` imports `Platform` from react-native. Expo's metro
            // config resolves it this way for the bundle; nothing here reads it.
            { find: /^react-native$/, replacement: 'react-native-web' },
          ],
          // cubeui ships `x.tsx` for device and `x.web.tsx` for the browser. Vite
          // has to prefer the web half the way Metro does.
          extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.mjs', '.json'],
        },
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['app/**/*.test.tsx'],
        },
      },
    ],
  },
});
