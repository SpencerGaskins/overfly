#!/usr/bin/env bash
# FlightLevel — Route Bundler deployment script
# Usage: ./deploy.sh [--stack-only | --code-only | --all]
#
# Prerequisites:
#   - AWS CLI configured with flightlevel-app credentials
#   - SUPABASE_SERVICE_KEY set in environment or passed as arg
#
# First deploy:  ./deploy.sh --all
# Code updates:  ./deploy.sh --code-only

set -euo pipefail

STACK_NAME="flightlevel-route-bundler"
REGION="us-east-1"
S3_BUCKET="flightlevel-routes"
FUNCTION_NAME="flightlevel-route-bundler"
BUNDLER_DIR="route-bundler"

# ── Validate env ──────────────────────────────────────────────────
if [[ -z "${SUPABASE_URL:-}" ]]; then
  echo "ERROR: SUPABASE_URL not set"
  exit 1
fi
if [[ -z "${SUPABASE_SERVICE_KEY:-}" ]]; then
  echo "ERROR: SUPABASE_SERVICE_KEY not set"
  exit 1
fi

MODE="${1:---all}"

# ── Package Lambda zip ────────────────────────────────────────────
package_lambda() {
  echo "→ Packaging Lambda..."
  pushd "$BUNDLER_DIR" > /dev/null
  npm ci --omit=dev --silent
  # Remove existing zip if present
  rm -f ../route-bundler.zip
  zip -r ../route-bundler.zip . \
    --exclude "*.zip" \
    --exclude "node_modules/.cache/*" \
    --exclude ".DS_Store" \
    --quiet
  popd > /dev/null
  echo "  ✓ route-bundler.zip created ($(du -sh route-bundler.zip | cut -f1))"
}

# ── Deploy CloudFormation stack ───────────────────────────────────
deploy_stack() {
  echo "→ Deploying CloudFormation stack: $STACK_NAME..."
  aws cloudformation deploy \
    --template-file infra.yaml \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
      SupabaseUrl="$SUPABASE_URL" \
      SupabaseServiceKey="$SUPABASE_SERVICE_KEY" \
      S3Bucket="$S3_BUCKET"
  echo "  ✓ Stack deployed"
}

# ── Upload Lambda code ────────────────────────────────────────────
upload_code() {
  echo "→ Uploading Lambda code..."
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file fileb://route-bundler.zip \
    --region "$REGION" \
    --output text \
    --query 'FunctionArn'
  echo "  ✓ Code uploaded"
}

# ── Test invoke ───────────────────────────────────────────────────
test_invoke() {
  echo "→ Test invoke (dry run)..."
  aws lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --log-type Tail \
    --query 'LogResult' \
    --output text \
    /tmp/bundler-response.json | base64 --decode | tail -20
  echo ""
  echo "  Response:"
  cat /tmp/bundler-response.json
  echo ""
}

# ── Main ──────────────────────────────────────────────────────────
case "$MODE" in
  --stack-only)
    deploy_stack
    ;;
  --code-only)
    package_lambda
    upload_code
    ;;
  --test)
    test_invoke
    ;;
  --all)
    package_lambda
    deploy_stack
    upload_code
    echo ""
    echo "✓ Full deployment complete"
    echo "  Lambda: $FUNCTION_NAME"
    echo "  Schedule: 04:00 UTC daily"
    echo "  S3 bucket: $S3_BUCKET"
    ;;
  *)
    echo "Usage: $0 [--stack-only | --code-only | --test | --all]"
    exit 1
    ;;
esac
