# Nimbus Labs Access Control Policy

**Document owner:** Karan Malhotra · **Version:** 2.2 · **Last reviewed:** 1 Oct 2026

## Principles
Access is granted on a least-privilege basis and tied to a person's role. Every grant has a named approver and is recorded in the audit log.

## Role-based access
Access to internal tools is defined by role: Founder, Engineering Manager, Engineer, Intern. A role template lists which applications each role may have and at what risk level.

## Risk levels and approvals
- **Low risk** applications (for example design and note-taking tools) are approved automatically if the requester's role allows them.
- **Medium risk** applications need approval from the person's manager.
- **High risk** applications, including AWS production, need approval from the **Engineering Manager**.

## Production access
Production access is **just-in-time**. A grant lasts **a maximum of 8 hours** and then expires automatically. Interns are not eligible for production access.

## Authentication standards
- Passwords must be at least **14 characters**.
- Administrator accounts must use **hardware security keys** in addition to passwords.
- Shared accounts are not permitted.

## Access reviews
Access reviews run **every quarter**. Managers confirm or remove each person's access, and the Engineering Manager signs off the review.

## Emergency access
In an incident, the on-call engineer may take emergency production access for up to 2 hours without prior approval. The Engineering Manager must approve it retrospectively within 24 hours.
