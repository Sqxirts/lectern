param([string]$Src, [string]$Dst, [int]$Scale = 2)

Add-Type -AssemblyName System.Drawing

$mf = [System.Drawing.Imaging.Metafile]::FromFile($Src)
$w = [int]($mf.Width * $Scale)
$h = [int]($mf.Height * $Scale)
Write-Output "EMF logical size: $($mf.Width) x $($mf.Height) -> raster $w x $h"

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.DrawImage($mf, 0, 0, $w, $h)
$bmp.Save($Dst, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
$mf.Dispose()
Write-Output "wrote $Dst"
