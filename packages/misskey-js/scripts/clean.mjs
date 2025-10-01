import { rm } from 'fs/promises';
import {buildDir, outDir} from './_common.mjs';

console.log(`Cleaning working directory ${buildDir}...`);
await rm(buildDir, { recursive: true, force: true });

console.log(`Cleaning output directory ${outDir}...`);
await rm(outDir, { recursive: true, force: true });
