import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    verify: 'src/verify.ts',
    express: 'src/express.ts',
    nextjs: 'src/nextjs.ts',
    hono: 'src/hono.ts',
    fastify: 'src/fastify.ts',
    react: 'src/react.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
