# Commercial release checklist

## Required before the first public release

- Replace placeholder repository/support URLs with the final official URLs.
- Choose and publish the commercial terms. MIT permits resale and modification; it does not create a paid license, warranty, or support contract.
- Obtain a Windows code-signing certificate and sign both installer and executable.
- Build Windows artifacts on Windows, then test installer, uninstaller, portable build, shortcuts, file dialogs, upgrade, and clean removal on fresh Windows 10 and 11 virtual machines.
- Run `npm ci`, `npm test`, `npm audit`, and `npm run dist:win` from a clean checkout.
- Test empty, large, read-only, WAL-mode, foreign-key, trigger, view, BLOB, Unicode, and malformed database files.
- Publish SHA-256 checksums and scan release artifacts with a reputable multi-engine malware scanner.
- Create a private security-reporting address and a public issue/support channel.
- Publish the Privacy Policy, limitations, refund terms, support scope, and update policy on the product page.
- Take screenshots, record a short demo, and prepare a sample database containing no real data.

## Required for ongoing maintenance

- Patch Electron promptly when security releases ship.
- Pin and review dependencies; do not blindly merge automated upgrades.
- Keep release notes and reproducible build records for every version.
- Backward-test opening databases created by supported SQLite versions.
- Maintain signed update artifacts before adding automatic updates.

## Not yet implemented

- Automatic updates. This requires a real release server, signed artifacts, and a stable publishing channel.
- Crash-report upload. Local errors are preferable until explicit consent, retention, and privacy controls exist.
- SQLCipher/encrypted database support.
- A virtualized SQL result grid for multi-million-row query results.
