module.exports = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    globals: {
      window: 'readonly',
      document: 'readonly',
      navigator: 'readonly',
      process: 'readonly',
      require: 'readonly',
      module: 'readonly',
      __dirname: 'readonly',
      __filename: 'readonly',
    },
  },
  rules: {
    semi: ['error', 'always'],
    quotes: ['error', 'single', { avoidEscape: true }],
    indent: ['error', 4],
    'no-console': 'off',
    'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
    'prefer-const': 'error',
    'no-var': 'error',
    eqeqeq: 'error',
  },
};
