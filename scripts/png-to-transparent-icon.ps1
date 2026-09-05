# Make transparent app icon from generated artwork (flood-fill bg removal).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/png-to-transparent-icon.ps1 <input.png>
# Outputs: assets/logo/zeus-master-1024.png / zeus-512.png / build/icon-256.png / build/icon.ico
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class IconFromPng
{
    static int Idx(int x, int y, int W) { return y * W + x; }

    public static Bitmap MakeTransparent(string srcPath, float tolerance)
    {
        using (var src = new Bitmap(srcPath))
        {
            int W = src.Width, H = src.Height;
            var bmp = new Bitmap(W, H, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp)) { g.Clear(Color.Transparent); }

            // background seed = average of 4 corners
            Color c1 = src.GetPixel(0, 0), c2 = src.GetPixel(W - 1, 0), c3 = src.GetPixel(0, H - 1), c4 = src.GetPixel(W - 1, H - 1);
            float br = (c1.R + c2.R + c3.R + c4.R) / 4f;
            float bg = (c1.G + c2.G + c3.G + c4.G) / 4f;
            float bb = (c1.B + c2.B + c3.B + c4.B) / 4f;
            float tol2 = tolerance * tolerance;

            bool[] bgCell = new bool[W * H];
            var q = new System.Collections.Generic.Queue<int>();
            for (int x = 0; x < W; x++) { q.Enqueue(Idx(x, 0, W)); q.Enqueue(Idx(x, H - 1, W)); }
            for (int y = 0; y < H; y++) { q.Enqueue(Idx(0, y, W)); q.Enqueue(Idx(W - 1, y, W)); }
            while (q.Count > 0)
            {
                int idx = q.Dequeue();
                if (bgCell[idx]) continue;
                int x = idx % W, y = idx / W;
                Color p = src.GetPixel(x, y);
                float dr = p.R - br, dg = p.G - bg, db = p.B - bb;
                if (dr * dr + dg * dg + db * db <= tol2)
                {
                    bgCell[idx] = true;
                    if (x > 0) q.Enqueue(idx - 1);
                    if (x < W - 1) q.Enqueue(idx + 1);
                    if (y > 0) q.Enqueue(idx - W);
                    if (y < H - 1) q.Enqueue(idx + W);
                }
            }
            for (int y = 0; y < H; y++)
            {
                for (int x = 0; x < W; x++)
                {
                    if (bgCell[Idx(x, y, W)])
                    {
                        Color p = src.GetPixel(x, y);
                        bmp.SetPixel(x, y, Color.FromArgb(0, p.R, p.G, p.B));
                    }
                    else
                    {
                        bmp.SetPixel(x, y, src.GetPixel(x, y));
                    }
                }
            }
            return bmp;
        }
    }

    public static Bitmap Scale(Bitmap src, int size)
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

    static void SaveVia(Bitmap src, int size, string path)
    {
        using (var b = Scale(src, size))
        using (var ms = new MemoryStream())
        {
            b.Save(ms, ImageFormat.Png);
            File.WriteAllBytes(path, ms.ToArray());
        }
    }

    public static void Run(string srcPath, string logoDir, string buildDir)
    {
        Bitmap trans = null;
        try { trans = MakeTransparent(srcPath, 26f); Console.WriteLine("step1 transparent ok " + trans.Width); }
        catch (Exception e) { Console.WriteLine("step1 FAIL " + e); return; }
        try
        {
            SaveVia(trans, 1024, Path.Combine(logoDir, "zeus-master-1024.png"));
            Console.WriteLine("step2 1024 ok");
            SaveVia(trans, 512, Path.Combine(logoDir, "zeus-512.png"));
            SaveVia(trans, 256, Path.Combine(buildDir, "icon-256.png"));
            Console.WriteLine("step3 256 ok");
            int[] sizes = { 16, 24, 32, 48, 64, 128, 256 };
            byte[][] blobs = new byte[sizes.Length][];
            for (int i = 0; i < sizes.Length; i++)
            {
                using (var b = Scale(trans, sizes[i]))
                using (var ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); blobs[i] = ms.ToArray(); }
            }
            Console.WriteLine("step4 blobs ok");
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
            Console.WriteLine("OK transparent icon set -> " + logoDir);
        }
        catch (Exception e) { Console.WriteLine("step FAIL " + e); }
        finally { if (trans != null) trans.Dispose(); }
    }
}
'@
Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing

$src = $args[0]
if (!$src) { Write-Error 'usage: png-to-transparent-icon.ps1 <input.png>'; exit 1 }
$root = Split-Path -Parent $PSScriptRoot
[IconFromPng]::Run((Resolve-Path $src).Path, (Join-Path $root 'assets\logo'), (Join-Path $root 'build'))
Write-Output 'done'
