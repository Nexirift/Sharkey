import {libBuild, outDir, testDBuild, testDSource} from './_common.mjs';
import {rm, cp} from 'fs/promises';

// Always clean the output, because artifacts are cached in the build directory instead.
console.log(`Cleaning output directory ${outDir}...`);
await rm(outDir, { recursive: true, force: true });

// Copy built lib to output directory.
await cp(libBuild, outDir, { recursive: true });

// Stage test-d sources in the build directory so tsd will work.
await cp(testDSource, testDBuild, { recursive: true });
