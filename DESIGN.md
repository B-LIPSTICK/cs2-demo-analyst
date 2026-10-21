# Design

<!-- impeccable:design-schema 1 -->

## World: Quiet Blue
A calm, precise desktop instrument: cool graphite glass, neutral pearl text, and Apple's system blue as the only signal color. The old blue shell was simple and legible; keep that restraint, then improve the material depth, rounded geometry, typography, and motion.

No coral, magenta, purple, or olive. Blue is the accent; amber is reserved for team T and warnings; red only for destructive states.

## Palette
- Dark base: `#0a0a0c`, `#161618`, `#1e1e21`, `#262629`, `#303034`.
- Ink: `#f5f5f7`, `#a1a1aa`, `#8e8e96`.
- Primary: system blue `#0a84ff`; hover `#3f9cff`; tint `rgba(10,132,255,.16)`.
- Teams: T amber `#f5a623`; CT ice blue `#5dade2`.
- Destructive: `#ff453a`. Ready/success uses the system green only as a small status dot.
- Light theme: `#f2f2f7`, `#ffffff`, `#f6f6f9`, `#e9e9ee`, `#dcdce2`; ink `#1d1d1f`, `#55555c`, `#69696f`; accent `#007aff`.

## Materials
- Translucent graphite panels with `backdrop-filter: blur(24px) saturate(145%)`, a 1px white hairline, an inset top highlight, and one soft elevation shadow.
- Radii: 10 / 14 / 20 / 24. Cards 24px; primary panels 24px; controls 12–14px; pills 999px.
- Gradients are lighting, not decoration: one soft blue wash behind the workspace, a faint top sheen on glass, a simple blue primary action. No multi-color gradient text.
- Elevation is declared once: either hairline or shadow, not both as a ghost-card outline.

## Type
- System-first: `Segoe UI Variable Text` / `Segoe UI` for Latin, `HarmonyOS Sans SC` / `Noto Sans SC` for Chinese. No Songti, no serif UI.
- Body 15.5px / 1.6; secondary 14px; micro labels 12.5px; page titles 32–40px; card titles 24–28px; numeric data mono.
- Tight tracking only on large headings (max -0.03em). Body tracking 0.
- Use native subpixel rendering on Windows; do not force grayscale antialiasing.

## Motion
- One authored moment: the workspace enters with a short lift and fade; demo cards stagger in. Everything else responds to the pointer.
- Smooth exponential ease-out `cubic-bezier(0.22, 1, 0.36, 1)` for entrances, hovers, and press release. No bounce or elastic overshoot.
- Cards lift 4px and brighten on hover; press scales to 0.985. Buttons press to 0.97. Nav items nudge 2px and use a blue active pill.
- Modal panels scale from 0.97 with a soft fade. Toasts rise 8px.
- Respect `prefers-reduced-motion` and never animate layout-critical widths.

## Composition
- Preserve the existing shell: 56px titlebar, left nav rail, page scroll, top command bar, demo cards, detail hero + timeline + table, single-column settings.
- Increase breathing room, not the number of containers. Avoid nested cards and decorative section numbers.
- The library should read as a set of match tickets; the detail page as one continuous analysis desk; settings as calm grouped rows.

## Non-negotiables
- Keep every existing control, IPC call, state, and data contract.
- 1080px must remain usable without horizontal page scrolling.
- Focus rings, hover, disabled, loading, empty, and error states are part of the design.
- Blue is the accent. No coral, magenta, purple, or olive.
