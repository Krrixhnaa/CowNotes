Add-Type -AssemblyName System.Drawing

function Make-Icon($size, $path) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(28, 28, 30))
    
    # White paper rect
    $pRect = New-Object System.Drawing.Rectangle ([int]($size*0.08)), ([int]($size*0.08)), ([int]($size*0.84)), ([int]($size*0.84))
    $brushWhite = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(250, 250, 252))
    $g.FillRectangle($brushWhite, $pRect)

    # Yellow top header
    $hRect = New-Object System.Drawing.Rectangle ([int]($size*0.08)), ([int]($size*0.08)), ([int]($size*0.84)), ([int]($size*0.24))
    $brushYellow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(234, 168, 0))
    $g.FillRectangle($brushYellow, $hRect)

    # Ruled lines
    $penLine = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 220, 225))
    $penLine.Width = [Math]::Max(1.0, $size*0.015)
    $lines = @(0.42, 0.54, 0.66, 0.78)
    foreach ($i in $lines) {
        $y = [int]($size * $i)
        $g.DrawLine($penLine, [int]($size*0.16), $y, [int]($size*0.84), $y)
    }

    # Pen stroke simulation
    $penStroke = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(50, 50, 52))
    $penStroke.Width = [Math]::Max(2.0, $size*0.03)
    $g.DrawLine($penStroke, [int]($size*0.2), [int]($size*0.42), [int]($size*0.65), [int]($size*0.42))
    $g.DrawLine($penStroke, [int]($size*0.2), [int]($size*0.54), [int]($size*0.55), [int]($size*0.54))

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $penLine.Dispose()
    $penStroke.Dispose()
    $brushWhite.Dispose()
    $brushYellow.Dispose()
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Generated $path successfully!"
}

Make-Icon 192 'public/icons/icon-192.png'
Make-Icon 512 'public/icons/icon-512.png'
