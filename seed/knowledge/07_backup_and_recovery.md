# Nimbus Labs Backup and Disaster Recovery Plan

**Document owner:** Karan Malhotra · **Version:** 1.8 · **Last reviewed:** 15 Sep 2026

## Recovery objectives
- **Recovery Point Objective (RPO): 1 hour.** At most one hour of data can be lost.
- **Recovery Time Objective (RTO): 4 hours.** Service is restored within four hours of a declared disaster.

## Backups
- Automated **daily snapshots** of the production database.
- Snapshots are retained for **35 days**.
- Continuous transaction-log shipping supports the one-hour RPO.
- All backups are encrypted with AES-256.

## Disaster recovery site
Production runs in AWS **Mumbai (ap-south-1)**. A **cross-region replica** is maintained in **Singapore (ap-southeast-1)** and can be promoted to primary during a regional failure.

## Testing
Restores are tested **every quarter**. The most recent restore test was on **12 September 2026** and was completed in **2 hours 40 minutes**, within the 4-hour RTO. Results are reviewed by the Engineering Manager and filed in the evidence folder.

## Responsibilities
The Engineering Manager owns the plan. The on-call engineer declares a disaster and the founder is informed within 30 minutes.

## Note on data location
Because the disaster recovery replica is in Singapore, customers who need all copies of their data kept in India should discuss this with Nimbus Labs before signing.
