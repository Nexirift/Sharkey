import * as nodepath from 'path';

export const scriptsDir = import.meta.dirname;
export const rootDir = nodepath.join(scriptsDir, '../');
export const outDir = nodepath.join(rootDir, './built');
