# Security policy

## Supported versions

Canvas One is a pre-1.0 preview. Only the latest commit on `master` receives fixes.

## Scope

The app runs entirely in the browser: there is no server, account system or telemetry, and designs are stored in the browser's IndexedDB. Reports we are most interested in:

- Importing a crafted project file (JSON bundle) that executes script, corrupts storage or hangs the page.
- Cross-site scripting through user-provided text such as labels, notes or links.
- Anything that sends project data off the device.
- Vulnerabilities in dependencies that affect the shipped app.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Include the affected version or commit, reproduction steps and impact.

You can expect an acknowledgement within a few days. Fixes are released as soon as practical, and reporters are credited unless they prefer otherwise.
