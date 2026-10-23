# Installs the Capstudio panel for Premiere Pro on Windows. No admin rights needed.
#   irm __SITE__/premiere/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$site = '__SITE__'
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.fastrr.capstudio'
$zip = Join-Path $env:TEMP 'capstudio-premiere.zip'
Write-Host 'Downloading the Capstudio panel...'
Invoke-WebRequest "$site/premiere/capstudio-premiere.zip" -OutFile $zip -UseBasicParsing
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive $zip -DestinationPath $dest -Force
Remove-Item $zip
# Premiere only loads panels that aren't from Adobe's store once this is switched on.
foreach ($v in 9..14) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path $key)) { New-Item -Path $key | Out-Null }
  Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
}
Write-Host ''
Write-Host 'Capstudio is installed. Restart Premiere Pro, then open Window > Extensions > Capstudio.'
