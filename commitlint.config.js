module.exports = {
  extends: ['@commitlint/config-conventional'].map(require.resolve),
  parserPreset: {
    parserOpts: {
      issuePrefixes: ['#', 'PLAT-', 'CORE-', 'CA-'],
      referenceActions: ['jira', 'closes', 'fixes'],
    },
  },
};