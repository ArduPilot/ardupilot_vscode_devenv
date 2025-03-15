import js from '@eslint/js';
import * as tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import sveltePlugin from 'eslint-plugin-svelte';
import * as svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

export default [
	js.configs.recommended,
	{
		files: ['**/*.ts'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.json'
			}
		},
		plugins: {
			'@typescript-eslint': tsPlugin
		},
		rules: {
			...tsPlugin.configs.recommended.rules,
			'@typescript-eslint/no-explicit-any': 'warn'
		}
	},
	{
		files: ['**/*.svelte'],
		plugins: {
			svelte: sveltePlugin
		},
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: {
					ts: tsParser,
					js: tsParser,
					typescript: tsParser
				}
			}
		},
		rules: {
			...sveltePlugin.configs.recommended.rules
		}
	},
	{
		files: ['**/*'],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.es2017,
				...globals.node,
				acquireVsCodeApi: 'readonly'
			}
		}
	}
];