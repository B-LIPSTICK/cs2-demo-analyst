# Turn an already-transparent PNG artwork into the app icon set.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/png-to-icon.ps1 <transparent-input.png>
# Steps: trim transparent borders -> fit on square canvas (long side ~88%) ->
#        assets/logo/zeus-master-1024.png / zeus-512.png / build/icon-256.png / build/icon.ico
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class PngToIcon
{
    static Rectangle ContentBounds(Bitmap b)
    {
        int minX = b.Width, minY = b.Height, maxX = -1, maxY = -1;
        for (int y = 0; y < b.Height; y += 2)
        {
            for (int x = 0; x < b.Width; x += 2)
            {
                if (b.GetPixel(x, y).A > 8)
                {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        // refine on the coarse box border rows/cols? coarse grid 2px is enough for margins
        return new Rectangle(minX, minY, Math.Max(1, maxX - minX + 1), Math.Max(1, maxY - minY + 1));
    }

    public static void Run(string srcPath, string logoDir, string buildDir, string name)
    {
        using (var src = new Bitmap(srcPath))
        {
            var box = ContentBounds(src);
            Console.WriteLine("content box: " + box);
            int cw = box.Width, ch = box.Height;
            float scale = 0.88f * 1024f / Math.Max(cw, ch);
            int fw = Math.Max(1, (int)Math.Round(cw * scale));
            int fh = Math.Max(1, (int)Math.Round(ch * scale));
            using (var fitted = new Bitmap(1024, 1024, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(fitted))
                {
                    g.Clear(Color.Transparent);
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    using (var crop = src.Clone(box, src.PixelFormat))
                    {
                        g.DrawImage(crop, (1024 - fw) / 2, (1024 - fh) / 2, fw, fh);
                    }
                }
                SaveVia(fitted, 1024, Path.Combine(logoDir, name + "-master-1024.png"));
                SaveVia(fitted, 512, Path.Combine(logoDir, name + "-512.png"));
                SaveVia(fitted, 256, Path.Combine(buildDir, "icon-256.png"));

                int[] sizes = { 16, 24, 32, 48, 64, 128, 256 };
                byte[][] blobs = new byte[sizes.Length][];
                for (int i = 0; i < sizes.Length; i++)
                {
                    using (var b = Scale(fitted, sizes[i]))
                    using (var ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); blobs[i] = ms.ToArray(); }
                }
                var ico = Path.Combine(buildDir, "icon.ico");
                using (var fs = new FileStream(ico, FileMode.Create))
                using (var w = new BinaryWriter(fs))
                {
                    w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)sizes.Length);
                    int off = 6 + 16 * sizes.Length;
                    for (int i = 0; i < sizes.Length; i++)
                    {
                        int sz = sizes[i];
                        w.Write((byte)(sz >= 256 ? 0 : sz));
                        w.Write((byte)(sz >= 256 ? 0 : sz));
                        w.Write((byte)0); w.Write((byte)0);
                        w.Write((ushort)1); w.Write((ushort)32);
                        w.Write((uint)blobs[i].Length);
                        w.Write((uint)off);
                        off += blobs[i].Length;
                    }
                    foreach (var b in blobs) w.Write(b);
                }
                Console.WriteLine("OK icon set from " + srcPath);
            }
        }
    }

    static void SaveVia(Bitmap src, int size, string path)
    {
        using (var b = Scale(src, size))
        using (var ms = new MemoryStream())
        {
            b.Save(ms, ImageFormat.Png);
            File.WriteAllBytes(path, ms.ToArray());
        }
    }

    static Bitmap Scale(Bitmap src, int size)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(src, 0, 0, size, size);
        }
        return bmp;
    }
}
'@
Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing

$src = $args[0]
$name = $args[1]
if (!$src) { Write-Error 'usage: png-to-icon.ps1 <transparent-input.png> [name]'; exit 1 }
if (!$name) { $name = 'zeus' }
$root = Split-Path -Parent $PSScriptRoot
[PngToIcon]::Run((Resolve-Path $src).Path, (Join-Path $root 'assets\logo'), (Join-Path $root 'build'), $name)
Write-Output 'done'
