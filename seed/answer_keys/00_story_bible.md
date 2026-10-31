# Story bible (canonical facts; every other file must match this)

All companies, people and figures are fictional demo data.

## Nimbus Labs (the vendor answering the RFP)
- B2B SaaS company in Bengaluru, founded 2022, 42 employees.
- Product: Nimbus Ledger Sync, which reconciles transaction data between banks and their fintech partners.
- Hosting: AWS, primary region ap-south-1 (Mumbai), disaster recovery region ap-southeast-1 (Singapore).
- Founder and CEO: Riya Sharma. Engineering manager: Karan Malhotra. New hire (software engineer): Meera Iyer. Intern: Arjun Verma.
- Security contact: security@nimbuslabs.example. Privacy contact: privacy@nimbuslabs.example.

## Meridian Bank (the customer)
- Mid-sized private bank, Mumbai. Procurement lead: Neha Kapoor. CISO: Vikram Rao.
- Project: Nimbus Ledger Sync pilot for Meridian's UPI reconciliation. Kickoff held Mon 26 Oct 2026. Target go-live: Mon 30 Nov 2026.

## Key facts by document (each fact lives in exactly one doc)
| Doc | Distinct facts |
| --- | --- |
| 01 SOC 2 summary | Type II, audit period 1 Jan to 30 Jun 2026, report issued 14 Aug 2026, auditor Harlow & Pike LLP, criteria: Security, Availability, Confidentiality, 2 exceptions noted and closed |
| 02 Security whitepaper | SAML 2.0 SSO, MFA mandatory, annual pen test by CertiNova (last: March 2026, 0 critical, 2 medium fixed in 21 days), weekly vulnerability scans, patch SLA: critical 72 hours, high 14 days |
| 03 Data retention | Customer data kept for contract term + 90 days then deleted within 30 days, application logs 400 days, backups 35 days, support tickets 3 years, audit logs 7 years |
| 04 Access control | RBAC and least privilege, access reviews quarterly, production access just-in-time for max 8 hours and approved by the Engineering Manager, passwords min 14 characters, hardware security keys for admins |
| 05 Incident response | Severities P1 to P4, P1 acknowledged in 15 minutes, customer notified within 72 hours of confirmed breach, postmortem within 5 business days, drills twice a year, 24x7 on-call for P1 |
| 06 Encryption | AES-256 at rest, TLS 1.2 minimum (1.3 preferred), keys in AWS KMS rotated every 365 days, customer-managed keys NOT supported, no hardware security module (HSM) of our own |
| 07 Backup and recovery | RPO 1 hour, RTO 4 hours, daily snapshots kept 35 days, cross-region replica in Singapore, restore test every quarter, last test 12 Sep 2026 completed in 2 h 40 min |
| 08 Vendor management | 3 vendor tiers, 14 Tier 1 vendors reviewed annually, 9 sub-processors, 30 days advance notice of new sub-processors |
| 09 Onboarding and offboarding | Background check before day 1, security training within 7 days of joining, access revoked within 4 hours of exit, MDM-encrypted laptops, device wipe within 3 business days |
| 10 Privacy note | Designed for DPDP Act alignment (no compliance claim), customer data stored in India by default, no sale of customer data, privacy requests answered within 15 days, no ISO 27001 certification yet (planned for 2027) |

## Deliberately NOT covered anywhere (for out-of-scope and red RFP questions)
Physical data-centre tours, penetration test of the customer's own systems, financial statements and insurance cover, ISO 27001 certificate, bring-your-own-key, on-premise deployment, named staff headcount per team, source-code escrow.
