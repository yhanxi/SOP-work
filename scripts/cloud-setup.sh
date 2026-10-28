#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --version
node scripts/check-project.cjs
