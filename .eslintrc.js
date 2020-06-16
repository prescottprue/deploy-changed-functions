module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'airbnb-base',
    'prettier',
    'plugin:@typescript-eslint/recommended',
    'prettier/@typescript-eslint',
    'plugin:jsdoc/recommended',
  ],
  root: true,
  plugins: ['@typescript-eslint', 'prettier', 'jsdoc'],
  settings: {
    'import/resolver': {
      node: {
        moduleDirectory: ['node_modules', '/'],
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
      },
    },
  },
  env: {
    node: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 0,
    'import/prefer-default-export': 0,
    'no-shadow': 0,
    'consistent-return': 0,
    'no-new': 0,
    'new-cap': 0,
    'no-return-await': 2,
    'jsdoc/newline-after-description': 0,
    'jsdoc/require-returns-type': 0,
    'jsdoc/require-param-type': 0,
    'import/extensions': 0,
    'prettier/prettier': [
      'error',
      {
        singleQuote: true, // airbnb
        trailingComma: 'all', // airbnb
      },
    ],
  },
  overrides: [
    {
      files: ['test/**/*.test.ts'],
      plugins: ['jest'],
      env: {
        'jest/globals': true,
      },
      extends: ['plugin:jest/recommended'],
      rules: {
        'no-unused-expressions': [0],
        'func-names': 0,
      },
    },
  ],
};
