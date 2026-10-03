# Send TEST "USDC" (testnet only) to any testnet account, e.g. your wallet account.
#
#   .\scripts\fund-test-usdc.ps1 -Destination G...YOURADDRESS [-Amount 500]
#   .\scripts\fund-test-usdc.ps1 -Destination ajo-m1 -Amount 100 -Trust   # CLI identity
#
# The destination must already trust the test USDC asset. Use the
# "Add USDC trustline" button in the web app (signs with your wallet), or -Trust
# for a stellar CLI identity. Requires the ajo-issuer identity created by
# deploy-testnet.ps1 / deploy-testnet.sh on THIS machine.
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [decimal]$Amount = 500,
  [switch]$Trust,
  [string]$Prefix = "ajo"
)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Load deployments/testnet.env (KEY=VALUE lines)
$cfg = @{}
Get-Content "deployments/testnet.env" | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2
  $cfg[$k.Trim()] = $v.Trim().Trim('"')
}
$asset = "$($cfg.TOKEN_CODE):$($cfg.TOKEN_ISSUER)"
$issuerId = "$Prefix-issuer"

if ($Trust) {
  Write-Host "adding trustline $asset for identity $Destination"
  stellar tx new change-trust --source-account $Destination --line $asset --network testnet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "change-trust failed" }
}
if (-not $Destination.StartsWith("G")) { $Destination = (stellar keys address $Destination).Trim() }

$stroops = [long]($Amount * 10000000)
Write-Host "sending $Amount test USDC to $Destination"
stellar tx new payment --source-account $issuerId --destination $Destination `
  --asset $asset --amount $stroops --network testnet | Out-Null
if ($LASTEXITCODE -ne 0) { throw "payment failed (does the destination have a USDC trustline?)" }

Write-Host "done. balance (stroops, 7 decimals):"
stellar contract invoke --id $cfg.TOKEN_CONTRACT_ID --network testnet --source-account $issuerId `
  -- balance --id $Destination
