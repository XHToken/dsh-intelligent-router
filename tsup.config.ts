import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'client/index': 'src/client/index.tsx',
    'settings-ui': 'src/settings-ui.tsx',
  },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  external: [
    '@deepseek-ai/dsh',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/cordis',
    '@cordis/core',
    'react',
    'react-dom',
  ],
  target: 'node18',
  // Don't split into chunks for client bundle
  splitting: false,
})
