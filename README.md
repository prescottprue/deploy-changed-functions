# Deploy Changed Functions

> Deploy only cloud functions which have changed


## Usage


```yaml
name: Deploy Functions

jobs:
  verify-build:
    name: Deploy
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repo
        uses: actions/checkout@v2

      - name: Setup Node
        uses: actions/setup-node@v1
        with:
          node-version: 12

      - name: Setup Google CLI
        uses: GoogleCloudPlatform/github-actions/setup-gcloud@master
        with:
          version: '290.0.1'
          project_id: ${{ env.GCLOUD_PROJECT }}
          service_account_key: ${{ secrets.SERVICE_ACCOUNT }}
          export_default_credentials: true

      - name: Deploy Only Changed Functions
        uses: prescottprue/deploy-changed-functions@master
        with:
          cache-folder: functions_deploy_cache/current
          local-folder: local-functions-cache
          project-id: ${{ env.GCLOUD_PROJECT }}
          ignore: '*.spec.js'
```

## Inputs

```yaml
project-id:
  description: 'ID of Google Cloud Project'
  required: true
token:
  description: 'Firebase CI token (used for deploy call).'
functions-folder:
  description: 'Folder where functions live'
  default: 'functions'
ignore:
  description: 'Globs to ignore in diffing (i.e *.test.js)'
  default: 'functions'
cache-folder:
  description: 'Folder to use for cache'
local-folder:
  description: 'Local folder to use for cache'
storage-bucket:
  description: 'Cloud Storage Bucket'
```

## Required Directory structure

Functions must live within their own folders of `functions/src` (or whatever your functions folder name)

```
functions
  src
    func1
      index.js
      utils.js
    func2
      index.js
      someOther.js
```

Changes to any files in the folder of the function will cause that function to re-deploy.

## Open Questions
- What exactly was wrong with diffing `dist`? (wasn't working as expected)
- Should this just output values to be called in another stage?
- Should gsutil auth logic be built in or should it require other action stage first? It could be done by accepting a service account and using google's node sdk, but this will most likely be quite a bit larger
- Support storing cache on other platforms like S3
- Support for deploying other platforms like lambda and GCP Functions Directly (instead of firebase functions)

## Ideas
- Accept list of "global" paths where changes in these paths should redeploy all functions (i.e. `utils`)
- Accept inputs for paths to scan
- List functions which haven't changed so that `--except` can be used (i.e. only skipping functions which haven't changed). It would be `--except` functions if none have changed