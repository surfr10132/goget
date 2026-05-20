#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is required." >&2
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "Error: Vercel CLI (vercel) is required." >&2
  exit 1
fi

PR_NUMBER="${1:-}"
REPO="${2:-}"

if [[ -z "${PR_NUMBER}" ]]; then
  PR_NUMBER="$(gh pr view --json number --jq '.number' 2>/dev/null || true)"
fi

if [[ -z "${PR_NUMBER}" ]]; then
  echo "Usage: scripts/redeploy-pr.sh <pr-number> [owner/repo]" >&2
  echo "Tip: run inside a checked-out PR branch to auto-detect the PR number." >&2
  exit 1
fi

GH_ARGS=()
if [[ -n "${REPO}" ]]; then
  GH_ARGS+=(--repo "${REPO}")
fi

DEPLOY_URL="$(
  gh pr view "${PR_NUMBER}" "${GH_ARGS[@]}" --json statusCheckRollup \
    --jq '.statusCheckRollup[] | select(.context == "Vercel") | .targetUrl' \
    | tail -n 1
)"

if [[ -z "${DEPLOY_URL}" ]]; then
  echo "Error: could not find a Vercel deployment URL for PR #${PR_NUMBER}." >&2
  exit 1
fi

echo "Redeploying ${DEPLOY_URL}"
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  vercel redeploy "${DEPLOY_URL}" --token "${VERCEL_TOKEN}"
else
  vercel redeploy "${DEPLOY_URL}"
fi
