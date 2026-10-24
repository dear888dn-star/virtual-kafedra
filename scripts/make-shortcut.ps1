# Ikonka (.ico) yasaydi va ish stolida "Virtual Kafedra" yorlig'ini yaratadi.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$icoPath = Join-Path $root 'web\kafedra.ico'

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 30, 58, 95))), 8, 8, 240, 240)
$gold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 197, 66))
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
# o'quv qalpoqchasi
$g.FillPolygon($white, @(
  (New-Object System.Drawing.Point 128, 62), (New-Object System.Drawing.Point 220, 108),
  (New-Object System.Drawing.Point 128, 154), (New-Object System.Drawing.Point 36, 108)))
$g.FillRectangle($white, 80, 138, 96, 44)
$g.FillPolygon($gold, @(
  (New-Object System.Drawing.Point 196, 118), (New-Object System.Drawing.Point 208, 114),
  (New-Object System.Drawing.Point 208, 178), (New-Object System.Drawing.Point 196, 178)))
$g.FillEllipse($gold, 196, 170, 12, 12)
$g.Dispose()

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
$bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32)
$bw.Write([uint32]$png.Length); $bw.Write([uint32]22)
$bw.Write($png)
$bw.Close(); $bmp.Dispose()

$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'Virtual Kafedra.lnk'))
$lnk.TargetPath = 'powershell.exe'
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $root 'scripts\launch.ps1')`""
$lnk.WorkingDirectory = $root
$lnk.IconLocation = $icoPath
$lnk.WindowStyle = 7
$lnk.Description = 'Virtual Kafedra'
$lnk.Save()
Write-Output "Yorliq yaratildi: $desktop\Virtual Kafedra.lnk"

# Ikkinchi yorliq: boshqaruv paneli (/admin)
$adm = $ws.CreateShortcut((Join-Path $desktop 'Virtual Kafedra - Boshqaruv.lnk'))
$adm.TargetPath = 'powershell.exe'
$adm.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $root 'scripts\launch.ps1')`" -Page /admin"
$adm.WorkingDirectory = $root
$adm.IconLocation = $icoPath
$adm.WindowStyle = 7
$adm.Description = 'Virtual Kafedra boshqaruv paneli'
$adm.Save()
Write-Output "Yorliq yaratildi: $desktop\Virtual Kafedra - Boshqaruv.lnk"
