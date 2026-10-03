#!/usr/bin/env bash
# End-to-end Ajo Circle v2 smoke test on Stellar TESTNET (build brief §6 step 8).
# NOT run automatically - only after the reviewer has cleared a SHA and the v2
# contract is deployed (deployments/testnet.env AJO_CONTRACT_ID = v2 id).
#
# 3 fresh throwaway members ($P-v2-m1..m3), c = 10 test USDC, period 180 s,
# join window 300 s:
#   (a) create
#   (b) m1 accepts with 20, m2 with 10, m3 with 0
#   (c) r0: all pay, settle            -> m1 claimable 30
#   (d) r1: m1 skips; after the deadline a NON-member settles
#                                      -> m2 claimable 30, m1 collateral 10
#   (e) r2: m3 skips its own round; settle
#   (f) everyone claims                -> every net exactly 0, contract balance 0
#   (g) second circle: one member never accepts -> cancel after the window,
#       the member that accepted claims its refund
# "USDC" is the project's own TEST token (not Circle's USDC, no value).
# Writes deployments/testnet-e2e-v2.md with explorer links. No secrets printed.
set -euo pipefail
cd "$(dirname "$0")/.."
source deployments/testnet.env
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
NET=testnet
P=${AJO_PREFIX:-ajo}
V1_ID=CBH6266NK6UGOLQ6NEUWM7EYANTMHOB5CLCJ27LZ3ARAARP52CIST4EZ
if [[ "$AJO_CONTRACT_ID" == "$V1_ID" ]]; then
  echo "AJO_CONTRACT_ID is still the deprecated v1 contract; deploy v2 first" >&2; exit 1
fi
ASSET="$TOKEN_CODE:$TOKEN_ISSUER"
C=100000000            # 10 test USDC (7 decimals)
PERIOD=${PERIOD:-180}
JOIN=${JOIN:-300}
REPORT=deployments/testnet-e2e-v2.md
TMP=$(mktemp); LINKS=$(mktemp); NOTES=$(mktemp)
trap 'rm -f "$TMP" "$LINKS" "$NOTES"' EXIT

step() { # step "<label>" cmd...  -> runs cmd, records the explorer link from stderr
  local label=$1; shift
  local out
  out=$("$@" 2>"$TMP") || { cat "$TMP" >&2; exit 1; }
  local tx
  tx=$(grep -oE 'stellar.expert/explorer/testnet/tx/[0-9a-f]{64}' "$TMP" | tail -1 || true)
  if [[ -n "$tx" ]]; then echo "| $label | [${tx##*/}](https://$tx) |" >> "$LINKS"; fi
  echo "  $label ${tx:+-> https://$tx}" >&2
  printf '%s' "$out"
}
note() { echo "$*" >&2; echo "- $*" >> "$NOTES"; }
fail() { echo "FAIL: $*" >&2; echo "- **FAIL**: $*" >> "$NOTES"; exit 1; }

inv() { stellar contract invoke --id "$AJO_CONTRACT_ID" --network $NET "$@"; }
view() { inv --source-account $P-admin --send=no -- "$@" 2>/dev/null; }
bal() { stellar contract invoke --id "$TOKEN_CONTRACT_ID" --network $NET --source-account $P-admin --send=no -- balance --id "$1" 2>/dev/null | tr -d '"'; }
mstate() { view get_member_state --circle_id "$1" --member "$2"; }
field() { mstate "$1" "$2" | jq -r ".$3" | tr -d '"'; }
expect() { [[ "$2" == "$3" ]] && note "ok: $1 = $3" || fail "$1 expected $3, got $2"; }
settle_when_ready() { # settle_when_ready <cid> <label> <source>
  local tries=0
  until step "$2" inv --source-account "$3" -- settle --circle_id "$1" >/dev/null 2>&1; do
    tries=$((tries + 1)); [[ $tries -gt 30 ]] && fail "settle never became ready"
    sleep 15
  done
}

echo "== fresh member identities" >&2
for i in 1 2 3 4; do
  id=$P-v2-m$i
  if ! stellar keys address $id >/dev/null 2>&1; then
    stellar keys generate $id --network $NET --fund >/dev/null 2>&1
    echo "created + funded $id" >&2
  fi
  step "trustline $id" stellar tx new change-trust --source-account $id --line "$ASSET" --network $NET >/dev/null
  step "send 100 test USDC to $id" stellar tx new payment --source-account $P-issuer \
    --destination "$(stellar keys address $id)" --asset "$ASSET" --amount 1000000000 --network $NET >/dev/null
done
M1=$(stellar keys address $P-v2-m1); M2=$(stellar keys address $P-v2-m2)
M3=$(stellar keys address $P-v2-m3); M4=$(stellar keys address $P-v2-m4)
ADMIN_G=$(stellar keys address $P-admin)   # the non-member who settles in (d)
expect "pinned token" "$(view token | tr -d '"')" "$TOKEN_CONTRACT_ID"
B0=$(bal "$AJO_CONTRACT_ID")

echo "== (a) create circle" >&2
CID=$(step "(a) create_circle" inv --source-account $P-v2-m1 -- create_circle \
  --admin "$M1" --contribution $C --members "[\"$M1\",\"$M2\",\"$M3\"]" \
  --period_secs $PERIOD --join_window_secs $JOIN)
note "circle id $CID"

echo "== (b) accept" >&2
step "(b) m1 accepts with 20" inv --source-account $P-v2-m1 -- accept --circle_id $CID --member "$M1" --collateral $((2 * C)) >/dev/null
step "(b) m2 accepts with 10" inv --source-account $P-v2-m2 -- accept --circle_id $CID --member "$M2" --collateral $C >/dev/null
step "(b) m3 accepts with 0"  inv --source-account $P-v2-m3 -- accept --circle_id $CID --member "$M3" --collateral 0 >/dev/null
expect "status after accepts" "$(view get_circle --circle_id $CID | jq -r .status)" "Active"

echo "== (c) round 0: all pay" >&2
for i in 1 2 3; do
  step "(c) r0 contribute m$i" inv --source-account $P-v2-m$i -- contribute --circle_id $CID --member "$(stellar keys address $P-v2-m$i)" >/dev/null
done
step "(c) r0 settle" inv --source-account $P-v2-m2 -- settle --circle_id $CID >/dev/null
expect "m1 claimable after r0" "$(field $CID "$M1" claimable)" "$((3 * C))"

echo "== (d) round 1: m1 skips, a non-member settles after the deadline" >&2
step "(d) r1 contribute m2" inv --source-account $P-v2-m2 -- contribute --circle_id $CID --member "$M2" >/dev/null
step "(d) r1 contribute m3" inv --source-account $P-v2-m3 -- contribute --circle_id $CID --member "$M3" >/dev/null
if inv --source-account $P-admin -- settle --circle_id $CID >/dev/null 2>&1; then
  fail "early settle succeeded"
else
  note "ok: early settle rejected (PayoutNotReady)"
fi
settle_when_ready $CID "(d) r1 settle by non-member $ADMIN_G" $P-admin
expect "m2 claimable after r1" "$(field $CID "$M2" claimable)" "$((3 * C))"
expect "m1 collateral after r1" "$(field $CID "$M1" collateral)" "$C"

echo "== (e) round 2: m3 skips its own round" >&2
PRE1=$(field $CID "$M1" claimable); PRE2=$(field $CID "$M2" claimable); PRE3=$(field $CID "$M3" claimable)
step "(e) r2 contribute m1" inv --source-account $P-v2-m1 -- contribute --circle_id $CID --member "$M1" >/dev/null
step "(e) r2 contribute m2" inv --source-account $P-v2-m2 -- contribute --circle_id $CID --member "$M2" >/dev/null
settle_when_ready $CID "(e) r2 settle" $P-v2-m1
note "claimable deltas r2: m1 $(( $(field $CID "$M1" claimable) - PRE1 )), m2 $(( $(field $CID "$M2" claimable) - PRE2 )), m3 $(( $(field $CID "$M3" claimable) - PRE3 )) (stroops; brief expects 10/10/20 USDC)"
expect "status after r2" "$(view get_circle --circle_id $CID | jq -r .status)" "Completed"

echo "== (f) everyone claims" >&2
for i in 1 2 3; do
  a=$(stellar keys address $P-v2-m$i)
  if [[ "$(field $CID "$a" claimable)" != "0" ]]; then
    step "(f) claim m$i" inv --source-account $P-v2-m$i -- claim --circle_id $CID --member "$a" >/dev/null
  fi
  tin=$(field $CID "$a" total_in); tout=$(field $CID "$a" total_claimed)
  expect "m$i net (claimed - paid in)" "$((tout - tin))" "0"
done
expect "contract balance back to start" "$(bal "$AJO_CONTRACT_ID")" "$B0"

echo "== (g) cancel: one member never accepts" >&2
CID2=$(step "(g) create_circle 2" inv --source-account $P-v2-m4 -- create_circle \
  --admin "$M4" --contribution $C --members "[\"$M4\",\"$M1\"]" \
  --period_secs $PERIOD --join_window_secs $JOIN)
step "(g) m4 accepts with 10" inv --source-account $P-v2-m4 -- accept --circle_id $CID2 --member "$M4" --collateral $C >/dev/null
if inv --source-account $P-v2-m4 -- cancel --circle_id $CID2 >/dev/null 2>&1; then
  fail "cancel succeeded inside the join window"
else
  note "ok: cancel rejected inside the join window"
fi
echo "  waiting $((JOIN + 15))s for the join window to close..." >&2
sleep $((JOIN + 15))
step "(g) cancel circle 2" inv --source-account $P-admin -- cancel --circle_id $CID2 >/dev/null
step "(g) m4 claims refund" inv --source-account $P-v2-m4 -- claim --circle_id $CID2 --member "$M4" >/dev/null
expect "m4 refunded (total_claimed)" "$(field $CID2 "$M4" total_claimed)" "$C"
expect "contract balance after (g)" "$(bal "$AJO_CONTRACT_ID")" "$B0"

{
  echo "# Testnet end-to-end run (v2)"
  echo
  echo "Generated by \`scripts/e2e-testnet.sh\` on $(date -u +'%Y-%m-%d %H:%M UTC')."
  echo
  echo "- Ajo v2 contract: [\`$AJO_CONTRACT_ID\`](https://stellar.expert/explorer/testnet/contract/$AJO_CONTRACT_ID)"
  echo "- Token: the project's own test USDC SAC (NOT Circle's USDC, no value): [\`$TOKEN_CONTRACT_ID\`](https://stellar.expert/explorer/testnet/contract/$TOKEN_CONTRACT_ID)"
  echo "- Circle \`$CID\` (m1 \`$M1\`, m2 \`$M2\`, m3 \`$M3\`) and circle \`$CID2\` (m4 \`$M4\`, m1) · c = 10 · period ${PERIOD}s · join window ${JOIN}s"
  echo
  echo "| Step | Transaction |"
  echo "|---|---|"
  cat "$LINKS"
  echo
  echo "## Checks"
  echo
  cat "$NOTES"
  echo
  echo "## Final member states (circle $CID)"
  for a in "$M1" "$M2" "$M3"; do echo; echo '```json'; mstate $CID "$a"; echo '```'; done
} > "$REPORT"
echo "wrote $REPORT" >&2
