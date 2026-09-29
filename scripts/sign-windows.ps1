# Authenticode-signs one file with the publisher's certificate in Azure Key Vault.
#
# Tauri runs this for every binary it signs (bundle.windows.signCommand in tauri.sign.conf.json),
# so it is only used by the release workflow, which provides the Key Vault access token and
# certificate location through the environment and installs AzureSignTool first.
param([Parameter(Mandatory = $true)][string]$File)

$ErrorActionPreference = 'Stop'
foreach ($name in 'AZURE_KV_URL', 'AZURE_KV_CERT', 'AZURE_KV_TOKEN', 'AZURE_TIMESTAMP_URL') {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "$name is not set" }
}

AzureSignTool sign `
  --kvu $env:AZURE_KV_URL `
  --kva $env:AZURE_KV_TOKEN `
  --kvc $env:AZURE_KV_CERT `
  --tr $env:AZURE_TIMESTAMP_URL `
  --td sha256 `
  --fd sha256 `
  $File
if ($LASTEXITCODE -ne 0) { throw "AzureSignTool failed for $File with exit $LASTEXITCODE" }
