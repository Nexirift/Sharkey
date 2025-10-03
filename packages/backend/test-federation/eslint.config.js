import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import pluginMisskey from '@misskey-dev/eslint-plugin';

export default [
	{
		ignores: [
			"**/built/",
			'*.js',
		],
	},
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		...pluginMisskey.configs['typescript'],
		files: ['daemon.ts', 'test/**/*.ts'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				project: ['./tsconfig.json'],
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
