# Local agent bridge

`startLocalBridge` binds to IPv4 loopback and accepts only configured exact browser origins. Pair one browser with the single-use 120-second code, then authenticate browser and CLI requests with separate in-memory tokens. The relay forwards tools to the browser; it never opens or writes project storage. Browser reconnects replay unanswered requests, and request identities reject different payloads. Hosted human collaboration is a separate provider.

Secure hosted origins may require browser local-network permission. The isolated
Chromium HTTPS-origin fixture verifies pairing and authenticated polling after that
permission is granted; this is not a compatibility claim for every browser.
