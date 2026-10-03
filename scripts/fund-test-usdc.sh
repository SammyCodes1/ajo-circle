#!/usr/bin/env bash
# Send TEST "USDC" (testnet only, issued by the throwaway ajo-issuer identity)
# to any testnet account, e.g. your Freighter account.
#
#   ./scripts/fund-test-usdc.sh G...YOURADDRESS [amount_in_usdc=500]
#
# The destination must already hold a USDC trustline for this issuer. Use the
# "Add USDC trustline" button in the web app (signs with Freighter), or for a
# CLI identity: ./scripts/fund-test-usdc.sh <identity-name> 500 --trust
set -euo pipefail
cd "$(dirname "$0")/.."
source deployments/testnet.env

DEST=${1:?usage: fund-test-usdc.sh <G-address|identity> [amount] [--trust]}
AMOUNT=${2:-500}
ISSUER_ID=${AJO_PREFIX:-ajo}-issuer
ASSET="$TOKEN_CODE:$TOKEN_ISSUER"

if [[ "${3:-}" == "--trust" ]]; then
  echo "adding trustline $ASSET for identity $DEST"
  stellar tx new change-trust --source-account "$DEST" --line "$ASSET" --network testnet >/dev/null
fi
if [[ "$DEST" != G* ]]; then DEST=$(stellar keys address "$DEST"); fi

STROOPS=$(python3 -c "from decimal import Decimal; print(int(Decimal('$AMOUNT')*10**7))" 2>/dev/null || echo $((AMOUNT * 10000000)))
echo "sending $AMOUNT test USDC to $DEST"
stellar tx new payment --source-account "$ISSUER_ID" --destination "$DEST" \
  --asset "$ASSET" --amount "$STROOPS" --network testnet >/dev/null
echo "done. balance:"
stellar contract invoke --id "$TOKEN_CONTRACT_ID" --network testnet --source-account "$ISSUER_ID" \
  -- balance --id "$DEST"
