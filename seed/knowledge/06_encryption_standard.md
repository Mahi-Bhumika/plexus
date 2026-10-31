# Nimbus Labs Encryption Standard

**Document owner:** Karan Malhotra · **Version:** 1.6 · **Last reviewed:** 10 Sep 2026

## Encryption at rest
All customer data is encrypted at rest with **AES-256**. This covers databases, object storage, backups and laptop disks.

## Encryption in transit
All connections to Nimbus Ledger Sync use **TLS 1.2 or higher**; **TLS 1.3** is preferred and negotiated whenever the client supports it. Older protocol versions are disabled. Internal service-to-service traffic is also encrypted.

## Key management
- Encryption keys are created and stored in **AWS KMS**.
- Keys are **rotated every 365 days**.
- Access to key administration is limited to two named engineers and is logged.
- Nimbus Labs does not operate its own hardware security module (HSM); it relies on the AWS KMS service.

## Customer-managed keys
**Customer-managed keys (bring-your-own-key) are not supported** in the current product. All keys are managed by Nimbus Labs through AWS KMS. This capability is not on the committed roadmap.

## Sensitive fields
Account numbers and UPI identifiers are additionally encrypted at the field level before they are written to the database, so they remain protected even in database exports.

## Certificates
TLS certificates are issued by a public certificate authority and renewed automatically 30 days before they expire.
