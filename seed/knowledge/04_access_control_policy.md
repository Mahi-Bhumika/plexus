# Access Control Policy (Nimbus Labs)

**Document owner:** Karan Malhotra, Engineering Manager · **Version:** 2.1 · **Last reviewed:** 22 Aug 2026

## Purpose and scope
This policy defines how Nimbus Labs grants, reviews and removes access to internal systems, customer data and third-party tools. It covers all employees, interns and contractors.

## Principle of least privilege
Everyone has access only to the systems they need for their current work. Default access on day one is restricted to email, company chat and the documentation wiki.

## Risk levels and approvals
- **Low risk** applications (for example design and note-taking tools) are approved automatically if the requester's role allows them.
- **Medium risk** applications need approval from the person's manager.
- **High risk** applications, including AWS production, need approval from the **Engineering Manager**.
- If the Engineering Manager is the requester, approval escalates to the Founder. No one may approve their own request.

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
