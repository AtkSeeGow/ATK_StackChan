param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\design\expression-sprites.png')
)

Add-Type -AssemblyName System.Drawing

$cellWidth = 128
$cellHeight = 64
$columns = 4
$rows = 7
$bitmap = [System.Drawing.Bitmap]::new($cellWidth * $columns, $cellHeight * $rows, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bitmap.SetResolution(96, 96)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

$outline = [System.Drawing.Color]::FromArgb(255, 122, 158, 103)
$face = [System.Drawing.Color]::FromArgb(255, 18, 55, 39)
$feature = [System.Drawing.Color]::FromArgb(255, 239, 239, 181)
$accent = [System.Drawing.Color]::FromArgb(255, 174, 184, 132)
$outlinePen = [System.Drawing.Pen]::new($outline, 4)
$featurePen = [System.Drawing.Pen]::new($feature, 4)
$accentPen = [System.Drawing.Pen]::new($accent, 3)
$faceBrush = [System.Drawing.SolidBrush]::new($face)
$featureBrush = [System.Drawing.SolidBrush]::new($feature)

function Draw-RoundedRect([System.Drawing.Graphics]$g, [System.Drawing.Pen]$pen, [System.Drawing.Brush]$brush, [int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  if ($null -ne $brush) { $g.FillPath($brush, $path) }
  if ($null -ne $pen) { $g.DrawPath($pen, $path) }
  $path.Dispose()
}

function Draw-Face([int]$column, [int]$row, [string]$pose, [int]$offsetY = 0, [int]$squash = 0) {
  $originX = $column * $cellWidth
  $originY = $row * $cellHeight
  $x = $originX + 20
  $y = $originY + 8 + $offsetY + [math]::Floor($squash / 2)
  $w = 88
  $h = 48 - $squash
  Draw-RoundedRect $graphics $outlinePen $faceBrush $x $y $w $h 12

  $eyeY = $y + 15
  $leftX = $x + 23
  $rightX = $x + 61
  if ($pose -eq 'lookleft') { $leftX -= 6; $rightX -= 6 }
  elseif ($pose -eq 'lookright') { $leftX += 6; $rightX += 6 }
  $graphics.FillRectangle($featureBrush, $leftX, $eyeY, 7, 14)
  $graphics.FillRectangle($featureBrush, $rightX, $eyeY, 7, 14)

  if ($pose -in @('halfblink', 'smirkhalf')) {
    $graphics.FillRectangle($faceBrush, $leftX - 1, $eyeY, 9, 7)
    $graphics.FillRectangle($faceBrush, $rightX - 1, $eyeY, 9, 7)
  } elseif ($pose -in @('blink', 'smirkblink')) {
    $graphics.FillRectangle($faceBrush, $leftX - 1, $eyeY, 9, 14)
    $graphics.FillRectangle($faceBrush, $rightX - 1, $eyeY, 9, 14)
    $graphics.DrawLine($featurePen, $leftX - 1, $eyeY + 8, $leftX + 8, $eyeY + 8)
    $graphics.DrawLine($featurePen, $rightX - 1, $eyeY + 8, $rightX + 8, $eyeY + 8)
  } elseif ($pose -eq 'happyeyes') {
    $graphics.FillRectangle($faceBrush, $leftX - 2, $eyeY - 1, 11, 16)
    $graphics.FillRectangle($faceBrush, $rightX - 2, $eyeY - 1, 11, 16)
    $graphics.DrawArc($featurePen, $leftX - 3, $eyeY + 2, 12, 10, 200, 140)
    $graphics.DrawArc($featurePen, $rightX - 3, $eyeY + 2, 12, 10, 200, 140)
  } elseif ($pose -like 'worried*') {
    $graphics.DrawLine($featurePen, $leftX - 3, $eyeY - 5, $leftX + 7, $eyeY - 9)
    $graphics.DrawLine($featurePen, $rightX, $eyeY - 9, $rightX + 10, $eyeY - 5)
  }

  $mouthY = $y + 34
  if ($pose -in @('happy', 'happyeyes')) {
    $graphics.FillRectangle($featureBrush, $x + 39, $mouthY - 1, 11, 7)
    $graphics.FillRectangle($featureBrush, $x + 42, $mouthY + 6, 5, 3)
  } elseif ($pose -in @('smirk', 'smirkhalf', 'smirkblink')) {
    $graphics.DrawLine($featurePen, $x + 38, $mouthY + 3, $x + 48, $mouthY + 3)
    $graphics.DrawLine($featurePen, $x + 48, $mouthY + 3, $x + 54, $mouthY - 2)
  } elseif ($pose -like 'worried*') {
    $depth = if ($pose -eq 'worrieddeep') { 5 } else { 3 }
    $graphics.DrawLine($featurePen, $x + 37, $mouthY + $depth, $x + 44, $mouthY)
    $graphics.DrawLine($featurePen, $x + 44, $mouthY, $x + 51, $mouthY + $depth)
  } elseif ($pose -eq 'talksmall') {
    $graphics.FillRectangle($featureBrush, $x + 40, $mouthY, 9, 5)
  } elseif ($pose -eq 'talkmedium') {
    $graphics.FillRectangle($featureBrush, $x + 38, $mouthY - 2, 13, 9)
  } elseif ($pose -eq 'talkwide') {
    Draw-RoundedRect $graphics $null $featureBrush ($x + 35) ($mouthY - 5) 19 14 5
  } else {
    $graphics.FillRectangle($featureBrush, $x + 39, $mouthY + 1, 11, 4)
  }

  if ($pose -like 'listen*') {
    $level = [int]$pose.Substring(6)
    for ($ring = 0; $ring -lt $level; $ring++) {
      $radius = 7 + $ring * 6
      $graphics.DrawArc($accentPen, $x - $radius + 5, $y + 17 - $ring * 2, $radius * 2, 15 + $ring * 4, 100, 160)
      $graphics.DrawArc($accentPen, $x + $w - $radius - 5, $y + 17 - $ring * 2, $radius * 2, 15 + $ring * 4, 280, 160)
    }
  }
}

Draw-Face 0 0 'neutral'
Draw-Face 1 0 'halfblink'
Draw-Face 2 0 'blink'
Draw-Face 3 0 'neutral'

Draw-Face 0 1 'happy'
Draw-Face 1 1 'happy' -3
Draw-Face 2 1 'happyeyes' -6
Draw-Face 3 1 'happy' 2 5

Draw-Face 0 2 'smirk'
Draw-Face 1 2 'smirkhalf'
Draw-Face 2 2 'smirkblink'
Draw-Face 3 2 'smirk'

Draw-Face 0 3 'worried'
Draw-Face 1 3 'worried'
Draw-Face 2 3 'worrieddeep'
Draw-Face 3 3 'worried'

Draw-Face 0 4 'neutral'
Draw-Face 1 4 'talksmall'
Draw-Face 2 4 'talkmedium'
Draw-Face 3 4 'talkwide'

Draw-Face 0 5 'listen0'
Draw-Face 1 5 'listen1'
Draw-Face 2 5 'listen2'
Draw-Face 3 5 'listen3'

Draw-Face 0 6 'neutral'
Draw-Face 1 6 'lookleft'
Draw-Face 2 6 'neutral'
Draw-Face 3 6 'lookright'

$directory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$accentPen.Dispose()
$featurePen.Dispose()
$outlinePen.Dispose()
$featureBrush.Dispose()
$faceBrush.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Output $OutputPath
