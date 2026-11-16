$ErrorActionPreference='Stop'
$installRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'BewpakornQueue'))
if(Get-Process -Name BewpakornQueueHost -ErrorAction SilentlyContinue){throw 'Close the Queue extension/Chrome connection before uninstalling.'}
$registryPath='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.bewpakorn.queue'
$expectedManifest=Join-Path $installRoot 'app\com.bewpakorn.queue.json'
if(Test-Path -LiteralPath $registryPath){
  $registered=(Get-Item -LiteralPath $registryPath).GetValue('')
  if($registered -ne $expectedManifest){throw 'Native host registration belongs to another path; refusing to remove it.'}
  Remove-Item -LiteralPath $registryPath
}
foreach($name in @('app','extension')){
  $target=[IO.Path]::GetFullPath((Join-Path $installRoot $name))
  if((Split-Path -Parent $target) -ne $installRoot -or (Split-Path -Leaf $target) -ne $name){throw 'Invalid uninstall path'}
  if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Recurse -Force}
}
Write-Output 'Removed host registration and program files. Remove Bewpakorn Queue from Chrome Extensions.'
Write-Output "History remains at $installRoot\data. RAM accounts and saved sessions were not deleted."
