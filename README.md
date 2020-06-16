# Deploy Changed Functions

> Deploy only cloud functions which have changed

## Required Directory structure


## Open Questions
- Should this just output values to be called in another stage?
- Should gsutil auth logic be built in or should it require other action stage first?
- Support storing cache on other platforms like S3
- Support for deploying other platforms like lambda and GCP Functions Directly (instead of firebase functions)

## Ideas
- Accept inputs for paths to scan
- List functions which haven't changed so that `--except` can be used (i.e. only skipping functions which haven't changed). It would be `--except` functions if none have changed