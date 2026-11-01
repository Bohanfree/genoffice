param([string]$UserData=(Join-Path $env:APPDATA 'GenOffice'))
$ErrorActionPreference='Stop'
$configFile=Join-Path $UserData 'webdav-config.json'
$old=$null
if(Test-Path -LiteralPath $configFile){$old=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json}
$endpoint=Read-Host 'WebDAV folder URL (HTTPS; enter to keep current URL)'
if([string]::IsNullOrWhiteSpace($endpoint) -and $old){$endpoint=$old.endpoint}
$uri=$null
if(-not [uri]::TryCreate($endpoint,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment){throw 'Enter an HTTPS folder URL without credentials or query parameters'}
if(-not $endpoint.EndsWith('/')){$endpoint+='/' }
$username=Read-Host 'WebDAV account (enter to keep current account)'
if([string]::IsNullOrWhiteSpace($username) -and $old){$username=$old.username}
if([string]::IsNullOrWhiteSpace($username)){throw 'Account required'}
$target='GenOffice/WebDAV/'+$uri.Host
# A previous saved credential never suppresses this manual password prompt.
& (Join-Path $PSScriptRoot 'credentials.ps1') -Action Write -Target $target -Username $username
$enable=Read-Host 'Enable automatic backup for files opened and saved from now on? Type YES'
$config=@{schema=1;endpoint=$endpoint;username=$username;credentialTarget=$target;automaticUploadEnabled=($enable -ceq 'YES');excludedDirectories=@();maxFileBytes=536870912;maxQueueBytes=2147483648}
if($old -and $old.excludedDirectories){$config.excludedDirectories=@($old.excludedDirectories)}
[IO.Directory]::CreateDirectory($UserData) | Out-Null
$temp=$configFile+'.tmp'
[IO.File]::WriteAllText($temp,($config | ConvertTo-Json -Depth 4),(New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $temp -Destination $configFile -Force
Write-Host 'Configuration saved. Restart GenOffice to use it. The password is stored only in Windows Credential Manager.'
