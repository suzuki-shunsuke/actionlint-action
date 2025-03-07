# actionlint-action

[![License](http://img.shields.io/badge/license-mit-blue.svg?style=flat-square)](https://raw.githubusercontent.com/suzuki-shunsuke/actionlint-action/main/LICENSE) | [action.yaml](action.yaml)

`actionlint-action` is a GitHub Action to run actionlint.

## How To Use

```sh
mkdir -p .github/workflows
curl -Lq -o .github/workflows/actionlint.yaml https://raw.githubusercontent.com/suzuki-shunsuke/actionlint-action/refs/heads/main/.github/workflows/actionlint.yaml
```

```yaml
---
name: actionlint
on:
  pull_request:
    paths:
      - .github/workflows/*.yaml
jobs:
  status-check:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: suzuki-shunsuke/actionlint-action@cf6cff1c6bffd4a4c8a15db39a3a5870057d1946 # v0.0.2
```
