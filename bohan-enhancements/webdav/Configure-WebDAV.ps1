param(
 [string]$UserData=(Join-Path $env:APPDATA 'GenOffice'),
 [string]$Endpoint='https://webdav.bohan.xin/%E5%90%8C%E6%AD%A5%E7%A9%BA%E9%97%B4/009GenOffice/'
)
$ErrorActionPreference='Stop'
$configFile=Join-Path $UserData 'webdav-config.json'
$old=$null
if(Test-Path -LiteralPath $configFile){$old=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json}
# This personal fork includes the requested destination, never credentials.
# Operators can explicitly override it using -Endpoint; no URL entry is needed.
$endpoint=$Endpoint
$uri=$null
if(-not [uri]::TryCreate($endpoint,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment){throw 'Enter an HTTPS folder URL without credentials or query parameters'}
if(-not $endpoint.EndsWith('/')){$endpoint+='/' }
Write-Host ('Backup destination: '+[uri]::UnescapeDataString($endpoint))
Write-Host 'Enter your account and hidden password to enable automatic document backup.'
$username=Read-Host 'WebDAV account (enter to keep current account)'
if([string]::IsNullOrWhiteSpace($username) -and $old){$username=$old.username}
if([string]::IsNullOrWhiteSpace($username)){throw 'Account required'}
$target='GenOffice/WebDAV/'+$uri.Host
# A previous saved credential never suppresses this manual password prompt.
& (Join-Path $PSScriptRoot 'credentials.ps1') -Action Write -Target $target -Username $username
$config=@{schema=1;endpoint=$endpoint;username=$username;credentialTarget=$target;automaticUploadEnabled=$true;excludedDirectories=@();maxFileBytes=536870912;maxQueueBytes=2147483648}
if($old -and $old.excludedDirectories){$config.excludedDirectories=@($old.excludedDirectories)}
[IO.Directory]::CreateDirectory($UserData) | Out-Null
$temp=$configFile+'.tmp'
[IO.File]::WriteAllText($temp,($config | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temp -Destination $configFile -Force
Write-Host 'Configuration saved. Restart GenOffice to use it. The password is stored only in Windows Credential Manager.'
