/**@type {import('eslint').Linter.Config} */
// eslint-disable-next-line no-undef
module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	plugins: [
		'@typescript-eslint',
	],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
	],
	parserOptions: {
		// Allows using a newer version of TypeScript than what
		// @typescript-eslint/parser officially supports
		warnOnUnsupportedTypeScriptVersion: false
	},
	rules: {
		'semi': [2, "always"],
		'@typescript-eslint/no-unused-vars': 2,
		'@typescript-eslint/no-explicit-any': 1,
		'@typescript-eslint/explicit-module-boundary-types': 2,
		'@typescript-eslint/no-non-null-assertion': 1,
		'indent': ['error', 'tab'],
		'linebreak-style': ['error', 'unix'],
		'quotes': ['error', 'single'],
		'no-trailing-spaces': 'error',
		'eol-last': 'error',
		'no-multiple-empty-lines': ['error', { 'max': 1 }],
		'space-infix-ops': 'error'
	}
};
