use std::path::Path;
use std::process::Command;

fn escape_ps_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

fn build_sync_script(app_name: &str, exe_path: &Path, work_dir: &Path) -> String {
    let app_name = escape_ps_single_quoted(app_name);
    let exe_path = escape_ps_single_quoted(&exe_path.to_string_lossy());
    let work_dir = escape_ps_single_quoted(&work_dir.to_string_lossy());

    format!(
        r#"$ErrorActionPreference = 'Stop'
$appName = '{app_name}'
$exePath = '{exe_path}'
$workDir = '{work_dir}'
$ws = New-Object -ComObject WScript.Shell
function Ensure-Link([string]$linkPath) {{
  if ([string]::IsNullOrWhiteSpace($linkPath)) {{ return }}
  $parent = Split-Path -Parent $linkPath
  if (-not [string]::IsNullOrWhiteSpace($parent)) {{
    New-Item -Path $parent -ItemType Directory -Force | Out-Null
  }}
  $shortcut = $ws.CreateShortcut($linkPath)
  $shortcut.TargetPath = $exePath
  $shortcut.Arguments = ''
  $shortcut.WorkingDirectory = $workDir
  $shortcut.IconLocation = "$exePath,0"
  $shortcut.Description = $appName
  $shortcut.Save()
}}
$desktopRoots = @($env:USERPROFILE, $env:OneDrive, $env:PUBLIC) | Where-Object {{ $_ }}
$desktopCandidates = $desktopRoots | ForEach-Object {{ Join-Path $_ 'Desktop' }} | Select-Object -Unique
foreach ($desktop in $desktopCandidates) {{
  if (-not (Test-Path $desktop)) {{ continue }}
  Get-ChildItem -Path $desktop -Filter "$appName*.lnk" -File -ErrorAction SilentlyContinue | ForEach-Object {{
    Ensure-Link $_.FullName
  }}
  Ensure-Link (Join-Path $desktop "$appName.lnk")
}}
$startPrograms = if ($env:APPDATA) {{ Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs' }} else {{ '' }}
if ($startPrograms -and (Test-Path $startPrograms)) {{
  Ensure-Link (Join-Path $startPrograms "$appName.lnk")
  Ensure-Link (Join-Path (Join-Path $startPrograms $appName) "$appName.lnk")
}}
$taskbarPinned = if ($env:APPDATA) {{ Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar' }} else {{ '' }}
if ($taskbarPinned -and (Test-Path $taskbarPinned)) {{
  Get-ChildItem -Path $taskbarPinned -Filter "$appName*.lnk" -File -ErrorAction SilentlyContinue | ForEach-Object {{
    Ensure-Link $_.FullName
  }}
  Ensure-Link (Join-Path $taskbarPinned "$appName.lnk")
}}
Add-Type -Namespace Win32 -Name Native -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);'
[Win32.Native]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
"#
    )
}

pub(super) fn sync_shortcuts(app_name: &str) -> Result<(), String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let Some(work_dir) = exe_path.parent() else {
        return Err("Unable to resolve executable parent directory".to_string());
    };
    let script = build_sync_script(app_name, &exe_path, work_dir);
    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "shortcut sync failed".to_string()
    };
    Err(message)
}
