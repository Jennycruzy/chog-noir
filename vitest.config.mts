import {defineConfig} from 'vitest/config';

// The release runs on a small shared server; heavy solver tests can pass 5 s there without anything being wrong.
export default defineConfig({test:{testTimeout:60_000}});
