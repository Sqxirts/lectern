param(
    [Parameter(Mandatory = $true)][string]$Deck,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [int]$Width = 1280,
    # 0 means: follow the deck's own aspect ratio. A fixed 720 squashes a 4:3
    # deck, and every diff against the squashed export is then wrong.
    [int]$Height = 0
)

# Export every slide to PNG through PowerPoint itself, as ground truth to
# compare the HTML renderer against. The deck is opened read-only.

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$ppt = New-Object -ComObject PowerPoint.Application
try {
    # msoTrue = -1. WithWindow=0 keeps it invisible.
    $pres = $ppt.Presentations.Open($Deck, -1, 0, 0)
    try {
        if ($Height -le 0) {
            $Height = [int][Math]::Round($Width * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)
        }
        Write-Output "slides: $($pres.Slides.Count) at ${Width}x${Height}"
        foreach ($slide in $pres.Slides) {
            $n = "{0:D2}" -f $slide.SlideIndex
            $path = Join-Path $OutDir "slide-$n.png"
            $slide.Export($path, "PNG", $Width, $Height)
        }
        Write-Output "exported to $OutDir"
    }
    finally {
        $pres.Close()
    }
}
finally {
    $ppt.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
