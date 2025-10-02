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
		},
	},
	{
		files: ['src/**/*.ts'],
		rules: {
			'no-restricted-globals': [
				'error',
				{
					globals: [
						{
							name: '__dirname',
							message: 'Not in ESModule. Use `import.meta.url` instead.',
						},
						{
							name: '__filename',
							message: 'Not in ESModule. Use `import.meta.url` instead.',
						},
						{
							name: 'setTimeout',
							message: 'Use TimeService.startTimer instead.',
						},
						{
							name: 'setInterval',
							message: 'Use TimeService.startTimer instead.',
						},
						{
							name: 'console',
							message: 'Use a Logger instance instead.',
						},
					],
					checkGlobalObject: true,
				},
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
				},
				{
					"selector": "NewExpression[callee.name='MemoryKVCache']",
					"message": "Cache constructor will produce an unmanaged instance. Use CacheManagementService.createMemoryKVCache() instead."
				},
				{
					"selector": "NewExpression[callee.name='MemorySingleCache']",
					"message": "Cache constructor will produce an unmanaged instance. Use CacheManagementService.createMemorySingleCache() instead."
				},
				{
					"selector": "NewExpression[callee.name='RedisKVCache']",
					"message": "Cache constructor will produce an unmanaged instance. Use CacheManagementService.createRedisKVCache() instead."
				},
				{
					"selector": "NewExpression[callee.name='RedisSingleCache']",
					"message": "Cache constructor will produce an unmanaged instance. Use CacheManagementService.createRedisSingleCache() instead."
				},
				{
					"selector": "NewExpression[callee.name='QuantumKVCache']",
					"message": "Cache constructor will produce an unmanaged instance. Use CacheManagementService.createQuantumKVCache() instead."
				},
			],
		},
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
		rules: {
			'no-restricted-globals': 'off',
			'no-restricted-properties': 'off',
			'no-restricted-syntax': 'off',
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
