#!/usr/bin/env bash
# Platform jobs finish independently and may try to create the same tag release at once.
set -euo pipefail
for attempt in 1 2 3 4 5; do
  gh release view "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1 && break
  gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" --verify-tag --generate-notes && break
  if [[ $attempt == 5 ]]; then exit 1; fi
  sleep 10
done
gh release upload "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY" "$@" --clobber
