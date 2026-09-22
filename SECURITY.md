# Security Policy

## Scope

This policy covers the `receipts` source in this repository and the `@sudhanshu1402/receipts` package published to npm.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |

Older versions do not receive fixes. Upgrade to a supported version before reporting.

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security problem, and do not post details on social media.** A public report tells everyone about the flaw before there is a fix.

Report privately through GitHub instead:

1. Go to the **Security** tab of this repository.
2. Choose **Report a vulnerability**.
3. Describe the issue, the version you tested, and the steps to reproduce it.

That opens a private advisory visible only to you and the maintainer.

If private reporting is unavailable to you, open an issue that says only that you have a security report and asks for a private channel - no details, no proof of concept.

## What to expect

This project is maintained by one person in their own time, so treat these as intentions rather than guarantees:

- **Acknowledgement:** within 7 days.
- **Assessment:** within 14 days of acknowledgement, you will get either a confirmation with a rough fix timeline, or an explanation of why it is not treated as a vulnerability.
- **Fix and disclosure:** once a fix ships, the advisory is published. You will be credited by name or handle if you want to be, and not if you don't.

If you have not heard anything within 14 days, please send a reminder on the same private advisory thread.

## Out of scope

- Vulnerabilities in dependencies that have no exploitable path through this project. receipts has zero runtime dependencies, so this is mostly about the toolchain.
- Findings that require an attacker to already control the machine, the process, or the transcript files being read.
- Automated scanner output with no demonstrated impact.
