param(
    [Parameter(Mandatory = $true)][string]$Deck,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [int]$Width = 1280,
    [int]$Height = 720
)

# Export every slide to PNG through PowerPoint itself, as ground truth to
# compare the HTML renderer against. The deck is opened read-only.

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$ppt = New-Object -ComObject PowerPoint.Application
try {
    # msoTrue = -1. WithWindow=0 keeps it invisible.
    $pres = $ppt.Presentations.Open($Deck, -1, 0, 0)
    try {
        Write-Output "slides: $($pres.Slides.Count)"
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
