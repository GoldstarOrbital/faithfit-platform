# Bundled fonts

The native app bundles two Google Fonts families, both SIL Open Font License 1.1
(full text alongside this file):

- **Cinzel** (variable, wght 400-900) — `ofl/cinzel` in google/fonts. Used for
  display/heading type, matching the web app's `font-family: 'Cinzel', serif`.
- **Spectral** (Regular/Medium/SemiBold/Italic) — `ofl/spectral` in google/fonts.
  Used for body/narrative serif type, matching the web app's
  `font-family: 'Spectral', serif`.

Source: https://github.com/google/fonts (main branch), fetched 2026-08-21.
Font binaries live in `ios/FunctioningFaith/FunctioningFaith/Fonts/` and are
registered via `UIAppFonts` in `Resources/Info.plist`.
