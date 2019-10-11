'use strict';

const recommendedRules = require('@typescript-eslint/eslint-plugin').configs
    .recommended;
module.exports = {
    extends: ['eslint:recommended'],
    plugins: [],
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: 'module',
    },
    rules: {
        semi: 2,
        'no-trailing-spaces': 'error',
        'no-unused-vars': ['error', { args: 'none' }],
    },
    env: {
        es6: true,
        node: true,
        mocha: true,
    },
    overrides: [
        {
            files: ['**/*.ts', '**/*.tsx'],
            parser: '@typescript-eslint/parser',
            parserOptions: {
                ecmaVersion: 2018,
                sourceType: 'module',
            },
            plugins: ['@typescript-eslint'],
            rules: Object.assign(recommendedRules.rules, {
                '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
                '@typescript-eslint/interface-name-prefix': 0,
            }),
        },
    ],
};
