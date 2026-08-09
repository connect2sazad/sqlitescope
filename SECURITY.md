# Security policy

## Supported version

Security fixes are provided for the latest published major version of SQLiteScope.

## Reporting a vulnerability

Do not publish an exploitable vulnerability or sensitive sample database in a public issue. Contact the maintainer privately through the security-contact method listed on the official release page. Include the affected version, operating system, reproduction steps, and impact. Remove real credentials and personal data.

## Application boundaries

- Renderer Node integration is disabled and context isolation is enabled.
- A restrictive Content Security Policy blocks remote scripts and connections.
- Filesystem and SQLite operations are exposed through a narrow preload bridge.
- External links are denied inside the application and opened in the system browser.
- SQLite files and SQL can contain hostile content. Only open files you trust, and never run unknown SQL against valuable data.

## Release integrity

Official installers should be code-signed and accompanied by SHA-256 checksums. Users should not install binaries from unverified mirrors.
