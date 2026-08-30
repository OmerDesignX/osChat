param(
  [string]$Source = "assets/logo/oschat-icon-source.png"
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $Source))
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Icon source is missing: $sourcePath"
}

$targets = @(
  @{ Path = (Join-Path $projectRoot 'build/icon.png'); Size = 1024; Radius = 224 },
  @{ Path = (Join-Path $projectRoot 'src/assets/oschat-icon.png'); Size = 512; Radius = 112 },
  @{ Path = (Join-Path $projectRoot 'assets/logo/oschat-icon.png'); Size = 1254; Radius = 274 }
)

$sourceBytes = [System.IO.File]::ReadAllBytes($sourcePath)
$sourceStream = New-Object System.IO.MemoryStream(,$sourceBytes)
$sourceImage = [System.Drawing.Image]::FromStream($sourceStream)
try {
  foreach ($target in $targets) {
    $size = [int]$target.Size
    $radius = [int]$target.Radius
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $bitmap.SetResolution(96, 96)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $diameter = $radius * 2
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        try {
          $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
          $path.AddArc($size - $diameter - 1, 0, $diameter, $diameter, 270, 90)
          $path.AddArc($size - $diameter - 1, $size - $diameter - 1, $diameter, $diameter, 0, 90)
          $path.AddArc(0, $size - $diameter - 1, $diameter, $diameter, 90, 90)
          $path.CloseFigure()
          $graphics.SetClip($path)
          $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
        } finally {
          $path.Dispose()
        }
      } finally {
        $graphics.Dispose()
      }
      $targetPath = [System.IO.Path]::GetFullPath([string]$target.Path)
      if (-not $targetPath.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to write outside the project: $targetPath"
      }
      $temporary = "$targetPath.rounded.tmp.png"
      $bitmap.Save($temporary, [System.Drawing.Imaging.ImageFormat]::Png)
      Move-Item -LiteralPath $temporary -Destination $targetPath -Force
    } finally {
      $bitmap.Dispose()
    }
  }
} finally {
  $sourceImage.Dispose()
  $sourceStream.Dispose()
}

Write-Output 'Rounded application icons generated.'
