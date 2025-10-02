import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import sharedConfig from '../shared/eslint.config.js';

export default [
	...sharedConfig,
	{
		ignores: ['**/node_modules', 'built', '@types/**/*', 'migration'],
	},
	{
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parserOptions: {
				parser: tsParser,
				project: ['./tsconfig.json', './test/tsconfig.json', './test-federation/tsconfig.json'],
				sourceType: 'module',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'import/order': ['warn', {
				groups: [
					'builtin',
					'external',
					'internal',
					'parent',
					'sibling',
					'index',
					'object',
					'type',
				],
				pathGroups: [{
					pattern: '@/**',
					group: 'external',
					position: 'after',
				}],
			}],
			'no-restricted-globals': ['error', {
				name: '__dirname',
				message: 'Not in ESModule. Use `import.meta.url` instead.',
			}, {
				name: '__filename',
				message: 'Not in ESModule. Use `import.meta.url` instead.',
			}],
		},
	},
	{
		files: ['src/**/*.ts'],
		rules: {
			'no-restricted-globals': [
				'error',
				{
					name: 'setTimeout',
					message: 'Use TimeService.startTimer instead.',
					checkGlobalObject: true,
				}, {
					name: 'setInterval',
					message: 'Use TimeService.startTimer instead.',
					checkGlobalObject: true,
				}
			],
			'no-restricted-properties': [
				'error',
				{
					object: 'Date',
					property: 'now',
					message: 'Use TimeService.now instead.',
				},
			],
			'no-restricted-syntax': [
				'error',
				{
					"selector": "NewExpression[callee.name='Date'][arguments.length=0]",
					"message": "new Date() is restricted. Use TimeService.date instead."
				}
			],
		}
	},
	{
		files: ['src/server/web/**/*.js', 'src/server/web/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.browser,
				LANGS: true,
				CLIENT_ENTRY: true,
				LANGS_VERSION: true,
			},
		},
	},
	{
		ignores: [
			"**/lib/",
			"**/temp/",
			"**/built/",
			"**/coverage/",
			"**/node_modules/",
			"**/migration/",
			"*.*",
		]
	},
];
