param(
  [string]$RamDirectory = (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'bew'),
  [switch]$OpenSetup
)
$ErrorActionPreference='Stop'
$packageRoot=Split-Path -Parent $PSScriptRoot
$identity=Get-Content -LiteralPath (Join-Path $packageRoot 'docs\extension-identity.json') -Raw | ConvertFrom-Json
$version=(Get-Content -LiteralPath (Join-Path $packageRoot 'extension\manifest.json') -Raw | ConvertFrom-Json).version
if($version -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}$'){throw 'Invalid release version'}
if($identity.extensionId -notmatch '^[a-p]{32}$'){throw 'Invalid extension identity'}
$ramAbsolute=[IO.Path]::GetFullPath($RamDirectory)
if(!(Test-Path -LiteralPath (Join-Path $ramAbsolute 'Bewpakorn RAM.exe')) -or !(Test-Path -LiteralPath (Join-Path $ramAbsolute 'AccountData.json'))){throw 'RAM directory must contain Bewpakorn RAM.exe and AccountData.json'}
$installRoot=Join-Path $env:LOCALAPPDATA 'BewpakornQueue'
$appRoot=Join-Path $installRoot 'app'
$appDirectory=Join-Path $appRoot "versions\$version"
if(Get-Process -Name BewpakornQueueHost -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq (Join-Path $appDirectory 'BewpakornQueueHost.exe')}){throw 'This release is running. Close its extension connection before reinstalling the same version.'}
$extensionDirectory=Join-Path $installRoot 'extension'
$dataDirectory=Join-Path $installRoot 'data'
New-Item -ItemType Directory -Force $appDirectory,$extensionDirectory,$dataDirectory | Out-Null
$nativeSource=Join-Path $packageRoot 'native\bin'
foreach($file in @('BewpakornQueueHost.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')){
  if(!(Test-Path -LiteralPath (Join-Path $nativeSource $file))){throw "Missing release dependency: $file"}
}
Get-ChildItem -LiteralPath $nativeSource -File | Where-Object {$_.Name -ne 'config.json' -and $_.Name -ne '.gitignore'} | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $appDirectory -Force}
Get-ChildItem -LiteralPath (Join-Path $packageRoot 'extension') -File | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $extensionDirectory -Force}
$origin="chrome-extension://$($identity.extensionId)/"
@{extensionOrigin=$origin;ramDirectory=$ramAbsolute;dataDirectory=$dataDirectory} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appDirectory 'config.json') -Encoding UTF8
$manifestPath=Join-Path $appRoot 'com.bewpakorn.queue.json'
@{name='com.bewpakorn.queue';description='Bewpakorn Queue local account coordinator';path=(Join-Path $appDirectory 'BewpakornQueueHost.exe');type='stdio';allowed_origins=@($origin)} | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$registryPath='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bewpakorn.queue'
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
@{version=$version;installedAt=[DateTime]::UtcNow.ToString('o');extensionId=$identity.extensionId;appDirectory=$appDirectory;extensionDirectory=$extensionDirectory;dataDirectory=$dataDirectory} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot 'install.json') -Encoding UTF8
Write-Output "Installed native host: $appDirectory"
Write-Output "Load unpacked extension: $extensionDirectory"
Write-Output "Expected extension ID: $($identity.extensionId)"
Write-Output 'No customer order has been started. Open extension options to assign map accounts first.'
Write-Output 'If Queue is already loaded, reload it in chrome://extensions to activate the staged release. Current order/history are retained.'
if($OpenSetup){
  $chromePath=Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
  if(Test-Path -LiteralPath $chromePath){Start-Process -FilePath $chromePath -ArgumentList 'chrome://extensions/' -WindowStyle Hidden}
  Start-Process -FilePath explorer.exe -ArgumentList $extensionDirectory -WindowStyle Hidden
}
