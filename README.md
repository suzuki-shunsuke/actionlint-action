# actionlint-action

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/suzuki-shunsuke/actionlint-action)
[![License](http://img.shields.io/badge/license-mit-blue.svg?style=flat-square)](https://raw.githubusercontent.com/suzuki-shunsuke/actionlint-action/main/LICENSE) [action.yaml](action.yaml)

`actionlint-action` is a GitHub Action to run [actionlint](https://github.com/kjanat/actionlint) and report results by [reviewdog](https://github.com/reviewdog/reviewdog).

- actionlint, reviewdog, and shellcheck are installed by [aqua](https://aquaproj.github.io/)
- In `pull_request` events, actionlint is skipped if no workflow file (`.github/workflows/*.yml`, `.github/workflows/*.yaml`) is changed
- For pull requests from forks, actionlint is run without reviewdog because `github.token` can't post review comments

## How To Use

Create a workflow such as `.github/workflows/actionlint.yaml`.
You need to checkout the repository before running this action.

```yaml
name: actionlint
on: pull_request
jobs:
  actionlint:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read # For actions/checkout
      pull-requests: write # For reviewdog to post review comments
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: suzuki-shunsuke/actionlint-action@bbb96e7fa8a7dd46b10ae443f05592eb5c406b5b # v0.2.0
        with:
          # Optional
          ignores: |
            file "dist/index.js" does not exist
            SC2086
```

## Inputs

- `github_token`: GitHub Access Token. The default is `github.token`. `pull-requests:write` is required to post review comments
- `config_file`: actionlint's `-config-file` option
- `ignores`: actionlint's `-ignore` options. Each line is passed as a separate `-ignore` option
- `pyflakes`: actionlint's `-pyflakes` option. The default is `pyflakes`. If empty, pyflakes integration is disabled
- `shellcheck`: actionlint's `-shellcheck` option. The default is `shellcheck`. If empty, shellcheck integration is disabled

## Breaking Changes from v0.1

- This action was rewritten as a JavaScript Action
- This action no longer checks out the repository. Please run `actions/checkout` before this action
- The input `sparse-checkout` was removed
- The input `actionlint_options` was removed. Use `config_file`, `ignores`, `pyflakes`, and `shellcheck` instead
