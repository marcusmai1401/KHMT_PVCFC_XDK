#!/usr/bin/env bash
set -euo pipefail

WORKFLOW_FILE="deploy.yml"
BRANCH="main"
WATCH="false"

usage() {
  cat <<'EOF'
Trigger production deploy through GitHub Actions.

Usage:
  ./deploy_github_actions.sh [options]

Options:
  --watch                      Wait and stream the GitHub Actions run result
  -h, --help                   Show this help

Examples:
  ./deploy_github_actions.sh --watch

Notes:
  - Only the main branch can deploy.
  - This script does not store the VPS private key.
  - GitHub Actions reads VPS secrets from the production environment.
  - Install and login GitHub CLI first: gh auth login
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch)
      WATCH="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' is not installed. Install it first, then run: gh auth login" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not logged in. Run: gh auth login" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "This script must be run inside the git repository." >&2
  exit 1
fi
cd "$REPO_ROOT"

CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || true)"
if [[ "$BRANCH" == "main" && -n "$CURRENT_BRANCH" && "$CURRENT_BRANCH" != "main" ]]; then
  echo "Current branch is '$CURRENT_BRANCH'. Deploy will use '$BRANCH'. Merge first if you need current local changes in production."
fi

echo "Triggering GitHub Actions production deploy..."
echo "  workflow: $WORKFLOW_FILE"
echo "  ref:      $BRANCH"
gh workflow run "$WORKFLOW_FILE" --ref "$BRANCH"

echo "Deploy request submitted. Fetching latest run..."
sleep 3

RUN_ID="$(
  gh run list \
    --workflow "$WORKFLOW_FILE" \
    --branch "$BRANCH" \
    --event workflow_dispatch \
    --limit 1 \
    --json databaseId \
    -q '.[0].databaseId // empty'
)"

if [[ -z "$RUN_ID" ]]; then
  echo "Could not resolve the new run id. Check GitHub Actions in the repo."
  exit 0
fi

RUN_URL="$(gh run view "$RUN_ID" --json url -q '.url')"
echo "Run ID: $RUN_ID"
echo "Logs:   $RUN_URL"

if [[ "$WATCH" == "true" ]]; then
  gh run watch "$RUN_ID" --exit-status
fi
