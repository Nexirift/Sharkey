import { rm } from 'fs/promises';
import { outDir } from './_common.mjs';

console.log(`Cleaning ${outDir}...`);
await rm(outDir, { recursive: true, force: true });
