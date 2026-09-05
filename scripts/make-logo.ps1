# CS2 Demo Analyst - Logo / app icon generator (vector drawing, rerunnable)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-logo.ps1
# Drawing logic is embedded C# (System.Drawing); tweak constants inside C# and rerun.
# Outputs:
#   assets/logo/logo-master-1024.png   (master 1024)
#   assets/logo/logo-512.png           (GitHub / README)
#   build/icon-256.png                 (electron-builder files reference)
#   build/icon.ico                     (win.icon: 16/24/32/48/64/128/256 PNG entries)
# Design: dark navy gradient base; play triangle left-half gold #F5B942 (T) / right-half
#         blue #4D9FFF (CT) = replay + faction colors; 3 round-cap waveform bars on the
#         right (white->blue) = voice transcription; glass highlight on top.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$cs = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class LogoGen
{
    // ---- design constants (relative to 1024 canvas, scaled per size) ----
    static Color Hex(string h)
    {
        return Color.FromArgb(255,
            Convert.ToInt32(h.Substring(1, 2), 16),
            Convert.ToInt32(h.Substring(3, 2), 16),
            Convert.ToInt32(h.Substring(5, 2), 16));
    }
    static Color Argba(int a, string h)
    {
        return Color.FromArgb(a,
            Convert.ToInt32(h.Substring(1, 2), 16),
            Convert.ToInt32(h.Substring(3, 2), 16),
            Convert.ToInt32(h.Substring(5, 2), 16));
    }

    static Bitmap Render(int size)
    {
        float S = size;
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;

        // 1) base vertical gradient
        var bg = new LinearGradientBrush(new Rectangle(0, 0, size, size),
            Hex("#1B2030"), Hex("#0A0E1A"), 90f);
        g.FillRectangle(bg, 0, 0, size, size);
        bg.Dispose();

        // 2) center blue ambient glow
        var gp = new GraphicsPath();
        gp.AddEllipse(new RectangleF(S * 0.06f, S * 0.22f, S * 0.88f, S * 0.74f));
        var pgb = new PathGradientBrush(gp);
        pgb.CenterColor = Argba(80, "#3764BE");
        pgb.SurroundColors = new[] { Argba(0, "#3764BE") };
        g.FillPath(pgb, gp);
        pgb.Dispose(); gp.Dispose();

        // 3) top glass highlight
        var hl = new LinearGradientBrush(new RectangleF(0, 0, S, S * 0.22f),
            Argba(52, "#FFFFFF"), Argba(0, "#FFFFFF"), 90f);
        g.FillRectangle(hl, 0, 0, S, S * 0.22f);
        hl.Dispose();

        // ---- symbol layout ----
        float cx = 0.485f * S;   // group center x (slightly left for wave balance)
        float cy = 0.525f * S;
        float triH = 0.430f * S;
        float triW = 0.392f * S;
        float half = triH / 2f;
        float xl = cx - triW / 2f;
        float xr = xl + triW;
        float xm = cx;           // gold/blue split line
        float top = cy - half;
        float bot = cy + half;

        // 4) magnifier lens ring (gold)
        float gcx = 0.47f * S;   // lens center (shift up-left for handle room)
        float gcy = 0.46f * S;
        float R = 0.30f * S;     // lens outer radius
        var gold = new SolidBrush(Hex("#F5B942"));
        var goldPen = new Pen(Hex("#F5B942"), 0.085f * S);
        goldPen.StartCap = LineCap.Round;
        goldPen.EndCap = LineCap.Round;
        g.DrawEllipse(goldPen, gcx - R, gcy - R, R * 2f, R * 2f);   // ring (stroke only)

        // 5) handle at 45 deg (down-right), overlapping ring edge slightly
        double a45 = Math.PI / 4;
        float hL = 0.30f * S;    // handle length
        float sx = gcx + (R - 0.02f * S) * (float)Math.Cos(a45);
        float sy = gcy + (R - 0.02f * S) * (float)Math.Sin(a45);
        float ex = sx + hL * (float)Math.Cos(a45);
        float ey = sy + hL * (float)Math.Sin(a45);
        g.DrawLine(goldPen, sx, sy, ex, ey);
        goldPen.Dispose(); gold.Dispose();

        // 6) crosshair inside lens (blue) + center dot (gold)
        float inset = 0.055f * S;
        var bluePen = new Pen(Hex("#6FB1FF"), 0.026f * S);
        g.DrawLine(bluePen, gcx - R + inset, gcy, gcx + R - inset, gcy);   // horizontal
        g.DrawLine(bluePen, gcx, gcy - R + inset, gcx, gcy + R - inset);   // vertical
        bluePen.Dispose();
        g.FillEllipse(new SolidBrush(Hex("#FFD27A")), gcx - 0.038f * S, gcy - 0.038f * S, 0.076f * S, 0.076f * S);

        // 7) glass glint (upper-left arc)
        var glint = new Pen(Argba(110, "#FFFFFF"), 0.022f * S);
        glint.StartCap = LineCap.Round;
        glint.EndCap = LineCap.Round;
        float ri = R - 0.075f * S;
        g.DrawArc(glint, gcx - ri, gcy - ri, ri * 2f, ri * 2f, 200f, 100f);
        glint.Dispose();

        // 8) subtle bottom vignette
        var fl = new LinearGradientBrush(new RectangleF(0, S * 0.82f, S, S * 0.18f),
            Argba(0, "#000000"), Argba(30, "#000000"), 90f);
        g.FillRectangle(fl, 0, S * 0.82f, S, S * 0.18f);
        fl.Dispose();
        g.Dispose();
        return bmp;
    }

    static void SavePng(Bitmap b, string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        b.Save(path, ImageFormat.Png);
        Console.WriteLine("OK " + path + " (" + b.Width + "x" + b.Height + ")");
    }

    public static void Run(string root)
    {
        SavePng(Render(1024), Path.Combine(root, "assets", "logo", "logo-master-1024.png"));
        SavePng(Render(512), Path.Combine(root, "assets", "logo", "logo-512.png"));
        SavePng(Render(256), Path.Combine(root, "build", "icon-256.png"));

        // ICO container with multi-size PNG entries (Vista+)
        int[] sizes = { 16, 24, 32, 48, 64, 128, 256 };
        byte[][] blobs = new byte[sizes.Length][];
        for (int i = 0; i < sizes.Length; i++)
        {
            using (var b = Render(sizes[i]))
            using (var ms = new MemoryStream())
            {
                b.Save(ms, ImageFormat.Png);
                blobs[i] = ms.ToArray();
            }
        }
        var icoPath = Path.Combine(root, "build", "icon.ico");
        using (var fs = new FileStream(icoPath, FileMode.Create))
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
        Console.WriteLine("OK " + icoPath + " (" + string.Join("/", sizes) + ")");
    }
}
'@

Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing

$root = Split-Path -Parent $PSScriptRoot
[LogoGen]::Run($root)
Write-Output 'done'
