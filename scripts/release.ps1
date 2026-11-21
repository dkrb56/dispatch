# The release of Dispatch without Claude, for the release actions of the Actions panel.
#   release.ps1 prepare    sets the next version, writes the changelog entry, makes one local commit
#   release.ps1 publish    builds the Windows installer on this PC, pushes main, makes the GitHub release with it
#   release.ps1 mac        starts the GitHub workflow on the tag of the latest release; it adds the Mac disk image
# -DryRun (publish and mac): a check only says what would stop the run, the build runs, nothing is pushed or uploaded.
param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateSet('prepare', 'publish', 'mac')][string]$Step,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$Repo = 'dkrb56/dispatch'
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
[Environment]::CurrentDirectory = $Root

function Say([string]$Text) { [Console]::Out.WriteLine($Text) }

# A check that stops a real run; a dry run only says it and goes on.
function Refuse([string]$Reason) {
  if ($DryRun) { Say "Would stop: $Reason" } else { throw $Reason }
}

# Runs a program and gives its output lines. A failure stops the release, unless -MayFail.
function Run([string]$Exe, [string[]]$Arguments, [switch]$MayFail, [switch]$Show) {
  $before = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($MayFail) { $lines = @(& $Exe @Arguments 2>$null) } else { $lines = @(& $Exe @Arguments) }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $before
  }
  if ($Show) { foreach ($line in $lines) { Say "$line" } }
  if ($code -ne 0 -and -not $MayFail) { throw "$Exe $($Arguments -join ' ') ended with exit code $code" }
  $script:LastCode = $code
  return $lines
}

function Read-Text([string]$Path) { [IO.File]::ReadAllText((Join-Path $Root $Path), $Utf8) }
function Write-Text([string]$Path, [string]$Text) { [IO.File]::WriteAllText((Join-Path $Root $Path), $Text, $Utf8) }
function Current-Version { (Read-Text 'src-tauri/tauri.conf.json' | ConvertFrom-Json).version }
function Head-Subject { @(Run git @('log', '-1', '--format=%s'))[0] }
function Release-Subject([string]$Version) { "release-${Version}: version $Version and the changelog entry" }
# A release commit may come from a release ticket too, so any id before the colon counts.
function Is-Release-Commit([string]$Version) { (Head-Subject) -match ('^\S+: version ' + [regex]::Escape($Version) + ' and the changelog entry$') }

# The checks of both steps: branch main, no uncommitted change, nothing on GitHub that this PC lacks.
function Assert-Ready {
  $branch = @(Run git @('rev-parse', '--abbrev-ref', 'HEAD'))[0]
  if ($branch -ne 'main') { Refuse "the branch is $branch, not main" }
  $changes = @(Run git @('status', '--porcelain'))
  if ($changes.Count -gt 0) { Refuse "uncommitted changes: $($changes -join ', ')" }
  [void](Run git @('fetch', '--quiet', 'origin', '--tags', 'main:refs/remotes/origin/main'))
  [void](Run git @('merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD') -MayFail)
  if ($script:LastCode -ne 0) { Refuse 'GitHub has commits of main that this PC lacks' }
  Assert-Gh
}

function Assert-Gh {
  [void](Run gh @('auth', 'status') -MayFail)
  if ($script:LastCode -ne 0) { throw 'gh is not signed in to GitHub' }
}

function Asset-Names([string]$Tag) {
  @(((Run gh @('release', 'view', $Tag, '--repo', $Repo, '--json', 'assets')) -join "`n") | ConvertFrom-Json | ForEach-Object { $_.assets } | ForEach-Object { $_.name })
}

function Last-Tag {
  $tags = @(Run git @('tag', '--list', 'v*')) | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Substring(1) }
  $last = @($tags) | Select-Object -Last 1
  if (-not $last) { throw 'no version tag found' }
  return $last
}

# One changelog line per commit: the words after the ticket id, without the part that names only Help, README or tests.
function Changelog-Lines([string]$Tag) {
  $result = @()
  foreach ($subject in @(Run git @('log', '--no-merges', '--reverse', '--format=%s', "$Tag..HEAD"))) {
    if ($subject -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*: (.+)$') { Say "Left out of the changelog: $subject"; continue }
    if ($subject -match '^release-') { continue }
    $parts = @($Matches[1] -split ';\s*' | Where-Object { $_ -notmatch '^(and )?(help|readme|docs?|tests?)((, | and )(help|readme|docs?|tests?))*\.?$' })
    $text = ($parts -join '; ').Replace('`', '').Trim().TrimEnd('.', ';', ',')
    if (-not $text) { continue }
    $result += '- ' + $text.Substring(0, 1).ToUpperInvariant() + $text.Substring(1) + '.'
  }
  return $result
}

# Replaces the version in a text and insists on the exact number of places.
function Set-Version([string]$Text, [string]$Pattern, [int]$Places, [string]$New, [string]$Name) {
  $regex = New-Object System.Text.RegularExpressions.Regex($Pattern, 'Multiline')
  $found = $regex.Matches($Text).Count
  if ($found -lt $Places) { throw "$Name has $found places with the old version, expected $Places" }
  return $regex.Replace($Text, ('${1}' + $New + '${2}'), $Places)
}

function Invoke-Prepare {
  Assert-Ready
  $tag = Last-Tag
  $last = $tag.Substring(1)
  $current = Current-Version
  if ($current -ne $last) {
    if ((Is-Release-Commit $current) -and [version]$current -gt [version]$last) {
      Say "Version $current is already prepared; the next step publishes it."
      return
    }
    throw "the version files hold $current, but the last release is $last. Finish or undo that release first"
  }
  $v = [version]$last
  $next = "$($v.Major).$($v.Minor).$($v.Build + 1)"
  $lines = @(Changelog-Lines $tag)
  if ($lines.Count -eq 0) { throw "no change for users since $tag" }

  $old = [regex]::Escape($last)
  $edits = [ordered]@{
    'src-tauri/tauri.conf.json' = @("(`"version`":\s*`")$old(`")", 1)
    'package.json'              = @("(`"version`":\s*`")$old(`")", 1)
    'package-lock.json'         = @("(`"name`": `"dispatch`",\r?\n\s*`"version`": `")$old(`")", 2)
    'src-tauri/Cargo.toml'      = @("^(version = `")$old(`")", 1)
    'src-tauri/Cargo.lock'      = @("(name = `"dispatch`"\r?\nversion = `")$old(`")", 1)
  }
  $texts = [ordered]@{}
  foreach ($file in $edits.Keys) {
    $texts[$file] = Set-Version (Read-Text $file) $edits[$file][0] $edits[$file][1] $next $file
  }
  $log = Read-Text 'CHANGELOG.md'
  $eol = if ($log.Contains("`r`n")) { "`r`n" } else { "`n" }
  $at = [regex]::Match($log, '^## ', 'Multiline')
  if (-not $at.Success) { throw 'CHANGELOG.md has no version heading' }
  $entry = (@("## $next ($(Get-Date -Format 'yyyy-MM-dd'))") + $lines + @('', '')) -join $eol
  $texts['CHANGELOG.md'] = $log.Insert($at.Index, $entry)

  foreach ($file in $texts.Keys) { Write-Text $file $texts[$file] }
  $files = @($texts.Keys)
  [void](Run git (@('add', '--') + $files))
  [void](Run git (@('commit', '--quiet', '-m', (Release-Subject $next), '--') + $files))
  Say "Version $next is ready in one local commit, with $($lines.Count) changelog lines:"
  foreach ($line in $lines) { Say $line }
}

function Invoke-Publish {
  Assert-Ready
  $version = Current-Version
  $tag = "v$version"
  if (-not (Is-Release-Commit $version)) { Refuse "the newest commit is not the release commit of $version" }
  $existing = (Run gh @('release', 'view', $tag, '--repo', $Repo, '--json', 'isDraft,name') -MayFail) -join "`n"
  if ($script:LastCode -eq 0 -and $existing.Trim()) {
    $info = $existing | ConvertFrom-Json
    if ($info.isDraft) {
      Refuse "the draft release $tag ($($info.name)) of an earlier run exists on GitHub. Delete it with: gh release delete $tag --repo $Repo --yes"
    } else {
      Refuse "the release $tag already exists on GitHub"
    }
  }

  # The build comes before the push, so a failed build leaves nothing on GitHub. A CARGO_TARGET_DIR
  # of a test copy would put the installer elsewhere, so the build runs without it.
  $exeName = "Dispatch_${version}_x64-setup.exe"
  $exe = Join-Path $Root "src-tauri\target\release\bundle\nsis\$exeName"
  $start = Get-Date
  $savedTarget = $env:CARGO_TARGET_DIR
  Remove-Item -LiteralPath Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
  try {
    Say 'Building the Windows installer: npm run tauri build -- --bundles nsis'
    [void](Run cmd.exe @('/d', '/c', 'npm run tauri build -- --bundles nsis') -Show)
  } finally {
    if ($null -ne $savedTarget) { $env:CARGO_TARGET_DIR = $savedTarget }
  }
  $file = Get-Item -LiteralPath $exe -ErrorAction SilentlyContinue
  if (-not $file -or $file.LastWriteTime -lt $start) { throw "the build made no new $exe" }
  Say "Built $exe ($($file.Length) bytes, $([math]::Round($file.Length / 1MB, 1)) MB)."

  # The text of the old GitHub workflow; the Mac run of release.yml later swaps the last paragraph.
  $notes = @'
Windows: download `Dispatch_<version>_x64-setup.exe` and run it. It installs for the current user. The installer is not signed: Windows SmartScreen shows "Windows protected your PC"; click **More info**, then **Run anyway**.

This version has no macOS disk image. A Mac keeps its version and gets the next one that has one.
'@
  $notes = $notes.Replace("`r`n", "`n").Replace('<version>', $version)
  $notesFile = Join-Path $Root '.dispatch\release-notes.md'
  Write-Text '.dispatch/release-notes.md' $notes
  Say "Release notes ($notesFile):"
  Say $notes

  $sha = @(Run git @('rev-parse', 'HEAD'))[0]
  if ($DryRun) {
    Say "Would push main, make the draft release $tag on $sha with $exeName, check its file and publish it."
    Say 'Dry run: nothing was pushed or uploaded.'
    return
  }
  [void](Run git @('push', '--quiet', 'origin', 'main'))
  # A draft is not in releases/latest, so the update check never sees the release without its
  # installer. GitHub makes the tag when the draft is published.
  [void](Run gh @('release', 'create', $tag, '--repo', $Repo, '--draft', '--target', $sha, '--title', "Dispatch $version", '--notes-file', $notesFile, $exe))
  Say "Made the draft release $tag with $exeName."
  $names = @(Asset-Names $tag)
  if ($names -notcontains $exeName) { throw "the draft release $tag lacks $exeName and stays a draft. Delete it with: gh release delete $tag --repo $Repo --yes" }
  [void](Run gh @('release', 'edit', $tag, '--repo', $Repo, '--draft=false'))
  [void](Run git @('fetch', '--quiet', 'origin', '--tags'))
  Say "Released $tag with: $($names -join ', ')"
}

# Starts the workflow release.yml on the tag of the latest release: it builds the Mac disk image
# of that code and adds it to the release.
function Invoke-Mac {
  Assert-Gh
  $tag = @(Run gh @('release', 'view', '--repo', $Repo, '--json', 'tagName', '--jq', '.tagName'))[0]
  if (-not $tag) { throw 'GitHub has no release' }
  $version = $tag.Substring(1)
  Say "The latest release is $tag."
  [void](Run git @('fetch', '--quiet', 'origin', '--tags'))
  $workflow = (Run git @('show', "${tag}:.github/workflows/release.yml") -MayFail) -join "`n"
  if ($script:LastCode -ne 0) {
    Refuse "the tag $tag has no release workflow"
  } elseif ($workflow -match 'windows-latest') {
    Refuse "the workflow of $tag still builds the Windows installer on GitHub and would replace the one of this PC; the Mac version can be added from the next release on"
  }
  $dmg = "Dispatch_${version}_universal.dmg"
  $names = @(Asset-Names $tag)
  if ($names -contains $dmg) { Refuse "the release $tag has $dmg already" }

  $sha = @(Run git @('rev-list', '-n', '1', $tag))[0]
  # A run on a tag has the tag as its branch, so the list does not filter by branch.
  $list = @('run', 'list', '--repo', $Repo, '--workflow', 'release.yml', '--event', 'workflow_dispatch', '--limit', '20', '--json', 'databaseId,headSha')
  $known = @(((Run gh $list) -join "`n") | ConvertFrom-Json | ForEach-Object { $_ } | ForEach-Object { $_.databaseId })
  if ($DryRun) {
    Say "Would start the release workflow on $tag ($sha), wait for it and check $dmg."
    Say 'Dry run: nothing was pushed or uploaded.'
    return
  }
  [void](Run gh @('workflow', 'run', 'release.yml', '--repo', $Repo, '--ref', $tag))
  Say "Started the Mac run of $tag."

  $id = $null
  for ($try = 0; $try -lt 60 -and -not $id; $try++) {
    $runs = @(((Run gh $list) -join "`n") | ConvertFrom-Json | ForEach-Object { $_ })
    $id = @($runs | Where-Object { $_.headSha -eq $sha -and $known -notcontains $_.databaseId } | ForEach-Object { $_.databaseId }) | Select-Object -First 1
    if (-not $id) { Start-Sleep -Seconds 5 }
  }
  if (-not $id) { throw 'GitHub shows no release run for this commit' }
  # A lost connection also ends `gh run watch` with exit code 1, while the run goes on: watch again
  # until GitHub says the run ended, and then trust only its conclusion.
  for ($try = 1; ; $try++) {
    [void](Run gh @('run', 'watch', "$id", '--repo', $Repo, '--exit-status', '--interval', '30') -Show -MayFail)
    $view = (Run gh @('run', 'view', "$id", '--repo', $Repo, '--json', 'status,conclusion') -MayFail) -join "`n"
    $state = if ($script:LastCode -eq 0 -and $view.Trim()) { $view | ConvertFrom-Json } else { $null }
    if ($state -and $state.status -eq 'completed') {
      if ($state.conclusion -ne 'success') { throw "the release run $id ended with $($state.conclusion)" }
      break
    }
    if ($try -ge 10) { throw "the watch of the release run $id failed 10 times; see https://github.com/$Repo/actions/runs/$id" }
    Say "The watch of the release run stopped (try $try); the run goes on, so it watches again."
    Start-Sleep -Seconds 20
  }

  $names = @(Asset-Names $tag)
  if ($names -notcontains $dmg) { throw "the release $tag lacks $dmg" }
  Say "Added $dmg to $tag"
}

try {
  switch ($Step) {
    'prepare' {
      if ($DryRun) { throw 'prepare has no dry run' }
      Invoke-Prepare
    }
    'publish' { Invoke-Publish }
    'mac' { Invoke-Mac }
  }
  exit 0
} catch {
  Say "FAILED: $($_.Exception.Message)"
  exit 1
}
