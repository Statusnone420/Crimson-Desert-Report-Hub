#Requires -Version 7.0
[CmdletBinding()]
param([string]$Archive = (Join-Path $PSScriptRoot 'crimson-desert-report-hub.crhbackup'))
$ErrorActionPreference = 'Stop'
$passphrase = Read-Host 'Saved archive passphrase' -AsSecureString
$target = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($Archive))) ('recovery-' + [Guid]::NewGuid().ToString('N'))
try {
    [IO.Directory]::CreateDirectory($target) | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    Set-Acl -LiteralPath $target -AclObject $acl
    $env:CRH_BACKUP_PASSPHRASE = [Net.NetworkCredential]::new('', $passphrase).Password
    & node (Join-Path $PSScriptRoot 'archive.mjs') decrypt $Archive (Join-Path $target 'backup.zip')
    if ($LASTEXITCODE -ne 0) { throw 'Decryption failed. Check the archive and saved passphrase.' }
    Write-Host "Recovered ZIP: $target\backup.zip"
    Write-Host 'This only recovers files. It does not connect to or restore a database. Treat the ZIP as private.'
} finally {
    Remove-Item Env:CRH_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
    $passphrase.Dispose()
}
