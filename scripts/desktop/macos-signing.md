# macOS DMG Signing and Notarization

The default desktop build is unsigned and repeatable:

```bash
pnpm desktop:build
```

For signed output (Developer ID Application certificate):

```bash
export CSC_LINK="<base64-or-file-url-to-p12>"
export CSC_KEY_PASSWORD="<certificate-password>"
pnpm desktop:build:signed
```

For signed and notarized output:

```bash
export CSC_LINK="<base64-or-file-url-to-p12>"
export CSC_KEY_PASSWORD="<certificate-password>"
export APPLE_ID="<apple-id-email>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<team-id>"
pnpm desktop:build:notarized
```

Notarization mode submits each generated `.dmg` with `xcrun notarytool --wait` and staples it with `xcrun stapler`.

## GitHub Actions secrets

The workflow `.github/workflows/desktop-macos.yml` supports optional signed/notarized builds. Configure these repository secrets when using `sign_and_notarize=true`:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
