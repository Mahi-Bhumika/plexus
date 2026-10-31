# Nimbus Labs Incident Response Plan

**Document owner:** Karan Malhotra · **Version:** 2.0 · **Last reviewed:** 28 Aug 2026

## Severity levels
| Level | Meaning | Acknowledge within |
| --- | --- | --- |
| P1 | Customer data exposed or full outage | **15 minutes** |
| P2 | Major feature down or suspected exposure | 1 hour |
| P3 | Degraded service, workaround exists | 1 business day |
| P4 | Minor issue | 3 business days |

## On-call
A **24x7 on-call** rotation covers P1 and P2 incidents. The rotation has four engineers, each on call for one week at a time.

## Response steps
1. Detect and triage, assign an incident commander.
2. Contain: isolate affected systems and revoke exposed credentials.
3. Investigate and fix.
4. Communicate with affected customers.
5. Review.

## Customer notification
When a breach involving customer data is **confirmed**, affected customers are notified **within 72 hours**. Nimbus Labs also reports to CERT-In within 6 hours of becoming aware of a reportable cyber incident, as required by Indian rules.

## Postmortems
A written postmortem is completed **within 5 business days** of closing any P1 or P2 incident. It lists the timeline, root cause and corrective actions with owners and due dates. Customers affected by a P1 receive a summary.

## Testing
The plan is exercised through a tabletop **drill twice a year**. The latest drill took place on 4 June 2026.
