import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import sharedConfig from '../shared/eslint.config.js';

// eslint-disable-next-line import/no-default-export
export default [
	...sharedConfig,
	{
		ignores: [
			'generator',
			'**/lib/',
			'**/temp/',
			'**/built/',
			'**/coverage/',
			'**/node_modules/',
		],
	},
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				project: ['./tsconfig.lib.json'],
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['test/**/*.ts'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				projectService: ['./tsconfig.test.json'],
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['test-d/**/*.ts'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				projectService: ['./tsconfig.test-d.json'],
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['*.ts', '*.js', 'scripts/**/*'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				project: ['./tsconfig.scripts.json'],
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				...globals.node,
			},
		},
	},
	{
		files: ['src/autogen/**/*.ts', 'src/autogen/**/*.tsx'],
		rules: {
			'@stylistic/indent': 'off',
		},
	},
];
