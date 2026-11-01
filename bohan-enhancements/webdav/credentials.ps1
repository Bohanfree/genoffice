param([ValidateSet('Read','Write')][string]$Action='Read',[Parameter(Mandatory=$true)][string]$Target,[string]$Username)
$ErrorActionPreference='Stop'
if($Target -notmatch '^GenOffice/WebDAV/[^\r\n]{1,180}$'){throw 'Invalid credential target'}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BohanDavCredential {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Credential {
  public UInt32 Flags, Type; public string TargetName, Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
  public UInt32 Persist, AttributeCount; public IntPtr Attributes;
  public string TargetAlias, UserName;
 }
 [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool Read(string target, UInt32 type, UInt32 flags, out IntPtr credential);
 [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool Write(ref Credential credential, UInt32 flags);
 [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr ptr);
}
'@
if($Action -eq 'Write') {
 if([string]::IsNullOrWhiteSpace($Username)){throw 'Username required'}
 # Every invocation asks the user again. Never accept a password argument or file.
 $secret=Read-Host 'WebDAV password (hidden)' -AsSecureString
 $ptr=[Runtime.InteropServices.Marshal]::SecureStringToCoTaskMemUnicode($secret)
 try {
  $c=New-Object BohanDavCredential+Credential
  $c.Type=1; $c.TargetName=$Target; $c.UserName=$Username; $c.Persist=2
  $c.CredentialBlob=$ptr; $c.CredentialBlobSize=$secret.Length*2
  if(-not [BohanDavCredential]::Write([ref]$c,0)){throw 'Credential storage failed'}
 } finally { [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($ptr); $secret.Dispose() }
} else {
 $ptr=[IntPtr]::Zero
 if(-not [BohanDavCredential]::Read($Target,1,0,[ref]$ptr)){throw 'Credential unavailable; run Configure-WebDAV.ps1'}
 try {
  $c=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][BohanDavCredential+Credential])
  $password=[Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob,$c.CredentialBlobSize/2)
  [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
  # Only the parent main process consumes this pipe. Do not invoke Read in a terminal.
  @{username=$c.UserName;password=$password} | ConvertTo-Json -Compress
 } finally { [BohanDavCredential]::CredFree($ptr); $password=$null }
}
