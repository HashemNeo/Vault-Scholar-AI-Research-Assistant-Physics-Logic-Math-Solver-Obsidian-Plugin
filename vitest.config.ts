import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.test.js', '**/lib/**/*.js'],
        setupFiles: [],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
        },
    },
    resolve: {
        alias: {
            // lib modules use relative imports; tests import from src/lib directly
            './lib': './src/lib',
            './core': './src/core',
        },
    },
});
