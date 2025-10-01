import tsParser from '@typescript-eslint/parser';
import sharedConfig from '../shared/eslint.config.js';

// eslint-disable-next-line import/no-default-export
export default [
	...sharedConfig,
	{
		ignores: [
			'**/node_modules',
			'built',
			'coverage',
			'jest.config.ts',
			'test',
			'test-d',
			'generator',
			'**/lib/',
			'**/temp/',
			'**/built/',
			'**/coverage/',
			'**/node_modules/',
			'scripts',
			'*.*',
		],
	},
	{
		files: ['src/**/*.ts', 'test/**/*.ts'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				project: ['./tsconfig.json'],
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['scripts/**/*.mjs'],
	},
	{
		files: ['src/autogen/**/*.ts', 'src/autogen/**/*.tsx'],
		rules: {
			'@stylistic/indent': 'off',
		},
	},
];
