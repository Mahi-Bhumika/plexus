---
title: Meridian pilot notes, Wed 28 Oct 2026
date: 2026-10-28
access: all
project: meridian
---
# Meridian pilot notes: Wednesday 28 October 2026

**Written by:** Karan Malhotra

- Riya sent the mutual NDA to Neha a week early. Meridian legal is reviewing it.
- Sanjay Desai named the two UAT analysts: **Pooja Menon** and **Imran Qureshi**. This is ahead of the 13 Nov date.
- Meera's first mapping draft covers 18 of the roughly 40 columns.
- Arjun's first anonymised sample file failed validation in the sandbox. Cause: dates were written as DD-MM-YYYY, and the sandbox expects ISO format (YYYY-MM-DD). Arjun asked for AWS production access to debug it. Declined, because interns are not eligible. Karan pulled the sandbox logs for him instead and Arjun fixed the date format.
- Base sandbox environment is up. API credentials not yet issued.
