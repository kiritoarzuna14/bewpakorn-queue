param([string]$OutputDirectory=(Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '..\outputs'),[switch]$SkipBuild)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$version=(Get-Content -LiteralPath (Join-Path $root 'extension\manifest.json') -Raw | ConvertFrom-Json).version
if($version -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}$'){throw 'Invalid release version'}
if(!$SkipBuild){& (Join-Path $PSScriptRoot 'build-native.ps1')}
$out=[IO.Path]::GetFullPath($OutputDirectory)
$release=Join-Path $out "BewpakornQueue-$version"
New-Item -ItemType Directory -Force $out,$release,(Join-Path $release 'extension'),(Join-Path $release 'native\bin'),(Join-Path $release 'scripts'),(Join-Path $release 'docs') | Out-Null
Get-ChildItem -LiteralPath (Join-Path $root 'extension') -File | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $release 'extension') -Force}
Get-ChildItem -LiteralPath (Join-Path $root 'native\bin') -File | Where-Object {$_.Name -ne 'config.json' -and $_.Name -ne '.gitignore'} | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $release 'native\bin') -Force}
foreach($name in @('install.ps1','uninstall.ps1','verify-installed.cjs')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $release 'scripts') -Force}
Copy-Item -LiteralPath (Join-Path $root 'docs\extension-identity.json') -Destination (Join-Path $release 'docs') -Force
Copy-Item -LiteralPath (Join-Path $root 'README-TH.md') -Destination $release -Force
if(Test-Path -LiteralPath (Join-Path $root 'docs\VALIDATION.json')){Copy-Item -LiteralPath (Join-Path $root 'docs\VALIDATION.json') -Destination (Join-Path $release 'docs') -Force}
@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1" -OpenSetup
pause
'@ | Set-Content -LiteralPath (Join-Path $release 'INSTALL.cmd') -Encoding ASCII
Push-Location $root
try{$sourceArchive=Join-Path $release 'source.zip';& git archive --format=zip "--output=$sourceArchive" HEAD;if($LASTEXITCODE -ne 0){throw 'Source archive failed'}}finally{Pop-Location}
$sums=Get-ChildItem -LiteralPath $release -File -Recurse | Where-Object {$_.Name -ne 'SHA256SUMS.txt'} | Sort-Object FullName | ForEach-Object {((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())+'  '+$_.FullName.Substring($release.Length+1).Replace('\','/')}
$sums | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Encoding ASCII
$zipPath=Join-Path $out "BewpakornQueue-$version.zip"
Compress-Archive -LiteralPath $release -DestinationPath $zipPath -Force
Write-Output $zipPath
