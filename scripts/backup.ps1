#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Reason = 'Manual owner-requested backup',
    [string]$Operator = "$env:USERNAME (manual)",
    [string]$Destination = 'V:\Backups\CDReportHub',
    [switch]$OpenWindow
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if ($OpenWindow) {
    # A visible console takes the passphrase directly, so it never passes through other tools.
    function Quote-Literal([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
    $command = "& $(Quote-Literal $PSCommandPath) -Reason $(Quote-Literal $Reason) -Operator $(Quote-Literal $Operator) -Destination $(Quote-Literal $Destination)"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -ArgumentList @('-NoProfile', '-NoExit', '-EncodedCommand', $encoded) -WindowStyle Normal | Out-Null
    Write-Host 'Backup console opened. Enter the saved archive passphrase there.'
    return
}

$passphrase = $null
$confirmation = $null
$exitCode = 1
try {
    Set-Location -LiteralPath $repo
    foreach ($tool in @('node', 'docker', 'tar')) { Get-Command $tool -ErrorAction Stop | Out-Null }
    $destinationPath = [IO.Path]::GetFullPath($Destination)
    if ($destinationPath.Equals($repo, [StringComparison]::OrdinalIgnoreCase) -or
        $destinationPath.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Backup files must stay outside the repository.'
    }
    # Reject junctions/symlinks in the output path before creating private files.
    for ($item = $destinationPath; $item; $item = [IO.Path]::GetDirectoryName($item)) {
        if ([IO.Directory]::Exists($item) -and ([IO.File]::GetAttributes($item) -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'The backup destination must not contain a junction or symbolic link.'
        }
    }
    & node (Join-Path $PSScriptRoot 'backup/run.mjs') --check
    if ($LASTEXITCODE -ne 0) { throw 'Backup preflight failed. See the message above.' }

    & node (Join-Path $PSScriptRoot 'backup/run.mjs') --check-docker
    if ($LASTEXITCODE -ne 0) { throw 'Open Docker Desktop normally, wait for its engine to run, then retry. No export has started.' }

    Write-Host 'Enter the archive passphrase saved in your password manager. This is NOT the database password.'
    $passphrase = Read-Host 'Archive passphrase' -AsSecureString
    $confirmation = Read-Host 'Repeat archive passphrase' -AsSecureString
    $plain = [Net.NetworkCredential]::new('', $passphrase).Password
    $repeat = [Net.NetworkCredential]::new('', $confirmation).Password
    if ($plain.Length -lt 16 -or $plain -cne $repeat) { throw 'Passphrases must match and contain at least 16 characters.' }
    $runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $runDirectory = Join-Path $destinationPath $runId
    [IO.Directory]::CreateDirectory($runDirectory) | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    }
    Set-Acl -LiteralPath $runDirectory -AclObject $acl
    try {
        $env:CRH_BACKUP_PASSPHRASE = $plain
        $plain = $null
        $repeat = $null
        & node (Join-Path $PSScriptRoot 'backup/run.mjs') $runDirectory $Reason $Operator
        $exitCode = $LASTEXITCODE
    } finally {
        Remove-Item Env:CRH_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
    }
} catch {
    Write-Host ('Backup failed: ' + $_.Exception.Message) -ForegroundColor Red
} finally {
    $plain = $null
    $repeat = $null
    if ($passphrase) { $passphrase.Dispose() }
    if ($confirmation) { $confirmation.Dispose() }
}
exit $exitCode
