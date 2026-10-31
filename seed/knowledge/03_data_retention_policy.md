# Nimbus Labs Data Retention Policy

**Document owner:** Riya Sharma, Founder and CEO · **Version:** 1.4 · **Last reviewed:** 15 Jul 2026

## Purpose
This policy sets how long Nimbus Labs keeps each type of data and how it is removed.

## Retention schedule
| Data type | Retention |
| --- | --- |
| Customer data (transaction files, reconciliation results) | For the contract term plus 90 days |
| Application and system logs | 400 days |
| Database backups | 35 days |
| Support tickets | 3 years |
| Security audit logs | 7 years |
| Employee records | 7 years after the end of employment |

## Deletion after contract end
After a contract ends, customer data stays available for export for 90 days. Once that window closes, the data is deleted from production systems within 30 days. Backups containing that data expire on their normal 35-day cycle, so the last copy is gone no later than 35 days after production deletion.

## Deletion method
Production data is deleted by dropping the customer's tenant schema and the associated storage objects. Encrypted volumes are retired by deleting their encryption keys.

## Customer requests
A customer administrator can request early deletion in writing. Nimbus Labs confirms completion by email within 10 business days of the request.

## Legal holds
If a legal hold applies, deletion is paused for the data in scope. The founder is the only person who can place or release a legal hold.
