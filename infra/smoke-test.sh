#!/usr/bin/env bash
# Basic post-deploy smoke test: hits /health on every service.
set -e
BASE_URL=${1:-http://localhost}
SERVICES="auth:4001 user-profile:4002 fitness:4003 wearable-ingest:4004 scripture-engine:4005 personalization:4006 social-graph:4007 gamification:4008 notification:4009 media:4010 creator-tools:4011"

for entry in $SERVICES; do
  name="${entry%%:*}"; port="${entry##*:}"
  echo -n "checking $name... "
  if curl -sf "$BASE_URL:$port/health" > /dev/null; then
    echo "OK"
  else
    echo "FAILED"
    exit 1
  fi
done
echo "All services healthy."
