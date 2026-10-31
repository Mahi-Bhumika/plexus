# Nimbus Labs Security Whitepaper

**Document owner:** Karan Malhotra · **Version:** 3.0 · **Last reviewed:** 2 Sep 2026

## Authentication
Employees sign in through our identity provider using SAML 2.0 single sign-on. Multi-factor authentication is mandatory for every employee account with no exceptions. Customer administrators can connect their own SAML 2.0 identity provider to Nimbus Ledger Sync.

## Network and application security
- Production runs in private subnets; only the load balancer is internet-facing.
- A web application firewall filters all inbound traffic.
- Every code change is peer-reviewed by at least one other engineer before it can be merged.
- Static code analysis and dependency scanning run on every pull request.

## Vulnerability management
- Authenticated vulnerability scans of production run **weekly**.
- Patch deadlines from the date a vulnerability is confirmed: **critical within 72 hours**, **high within 14 days**, medium within 60 days.
- An external penetration test is performed **once a year** by CertiNova. The most recent test was in **March 2026**. It found **no critical issues** and **two medium** issues, both fixed within 21 days. A summary letter is shared under NDA.

## Logging and monitoring
Security-relevant events are sent to a central log store and alerts are reviewed by the on-call engineer. Alerts for impossible-travel sign-ins and repeated failed logins are routed to the on-call engineer immediately.

## Secure development
Engineers complete secure coding training once a year. Secrets are stored in AWS Secrets Manager and are never committed to source control; a secrets scanner blocks any commit that contains one.

## What this document does not claim
Nimbus Labs does not currently run a public bug bounty program.
