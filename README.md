# actionlint-action

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/suzuki-shunsuke/actionlint-action)
[![License](http://img.shields.io/badge/license-mit-blue.svg?style=flat-square)](https://raw.githubusercontent.com/suzuki-shunsuke/actionlint-action/main/LICENSE) [action.yaml](action.yaml)

`actionlint-action` is a GitHub Action to run [actionlint](https://github.com/kjanat/actionlint) and report results by [reviewdog](https://github.com/reviewdog/reviewdog).

- actionlint, reviewdog, and shellcheck are installed by [aqua](https://aquaproj.github.io/)
- In `pull_request` events, actionlint is skipped if no workflow file (`.github/workflows/*.yml`, `.github/workflows/*.yaml`) is changed
- For pull requests from forks, actionlint is run without reviewdog because `github.token` can't post review comments

## How To Use

```sh
mkdir -p .github/workflows
curl -Lq -o .github/workflows/actionlint.yaml https://raw.githubusercontent.com/suzuki-shunsuke/actionlint-action/refs/heads/main/.github/workflows/actionlint.yaml
```

You need to checkout the repository before running this action.

```yaml
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    with:
      persist-credentials: false
  - uses: suzuki-shunsuke/actionlint-action@main
    with:
      # Optional
      actionlint_options: -ignore foo
```

## Inputs

- `github_token`: GitHub Access Token. The default is `github.token`. `pull-requests:write` is required to post review comments
- `actionlint_options`: actionlint's command line options such as `-ignore`

## Breaking Changes from v0.1

- This action was rewritten as a JavaScript Action
- This action no longer checks out the repository. Please run `actions/checkout` before this action
- The input `sparse-checkout` was removed
