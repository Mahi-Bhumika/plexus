# Batch 4 answer key (for scoring only; never put this in the knowledge base or in agent prompts)

## Receipts (`receipts/`) against the expense policy and card feed
| File | Merchant | Date | GST | Total | Expected result |
| --- | --- | --- | --- | --- | --- |
| receipt_01_cab.png | Zippy Cabs | 25 Oct | CGST 20 + SGST 20 | Rs 840 | OK (limit Rs 1,500 per ride). Matches T005 |
| receipt_02_restaurant.png | Saffron & Salt | 26 Oct | CGST 125 + SGST 125 | Rs 5,250 | **Violation.** 2 covers, dinner limit Rs 1,500 per person = Rs 3,000. Over by Rs 2,250. Matches T008 |
| receipt_03_flight.png | SkyBharat Airways | 25 Oct | GST 270 (+ Rs 330 UDF) | Rs 6,000 | OK (limit Rs 8,000 one way). Matches T004 |
| receipt_04_software.png | CloudCanvas | 28 Oct | IGST 360 | Rs 2,360 | OK (under Rs 5,000 per month). Matches T012 |
| receipt_05_hotel.png | Lotus Grove Inn | 25 to 26 Oct | CGST 390 + SGST 390 | Rs 7,280 | OK (Mumbai limit Rs 9,000 per night). Matches T006 |
| receipt_06_cab_duplicate.png | Zippy Cabs | 25 Oct | same | Rs 840 | **Duplicate** of receipt_01: same invoice number ZC-2610-48213. Reject |

The demo has 5 unique receipts plus 1 duplicate upload. Karan's trip claim totals Rs 19,370 (840 + 6,000 + 7,280 + 5,250). That is under Rs 25,000, but Karan cannot approve his own claim, so it goes to Riya.

## Card feed (`card_feed.csv`)
15 transactions: 13 have a receipt reference (5 demo images, 8 already filed as RC-numbers), **2 have no receipt**: T007 (Zippy Cabs, Rs 460) and T013 (HiveSpace Coworking, Rs 900).

## Zombie SaaS (`saas_billing.csv` + `sso_logins.csv`)
- 12 tools, total Rs 1,55,010 per month.
- **3 tools with zero logins in the last 30 days:** Miro (Rs 4,200), Loom (Rs 2,550), Calendly (Rs 4,000).
- **Waste: Rs 10,750 per month, Rs 1,29,000 per year.**
- Optional extra insight: Figma has 4 active users on 6 seats.

## Cmd+K documents (`cmdk_documents/`)
**Catch me up on Meridian, last 4 days (27 to 30 Oct), expected points:**
1. NDA: sent early on 28 Oct, signed by Meridian on 29 Oct.
2. SOC 2 Type II report sent to Vikram Rao on 30 Oct.
3. Sandbox credentials issued on 30 Oct, a week ahead of 6 Nov.
4. UAT analysts named early: Pooja Menon and Imran Qureshi.
5. Decision on 29 Oct: remitter VPA column mapped as optional.
6. Open: Vikram wants the Singapore DR replica answer in writing, via the questionnaire (due Fri 6 Nov). Meridian IP ranges due Tue 10 Nov.

**Spot-check questions:**
| Question | Answer | Source |
| --- | --- | --- |
| When is the Meridian go-live and who owns it? | Mon 30 Nov 2026; Karan Malhotra | 05_launch_date_and_owner |
| Who are the UAT analysts? | Pooja Menon, Imran Qureshi | 02_meridian_notes_2026-10-28 |
| Why did Arjun's file fail? | Dates in DD-MM-YYYY; sandbox expects ISO | 02_meridian_notes_2026-10-28 |
| What is the pilot onboarding fee? | Rs 2,50,000 | 07_pricing_sheet |

**Role scoping:** `10_salary_sheet_FOUNDER_ONLY.md` has `access: founder-only`. A search by Arjun (intern) or Meera for "salary" must return nothing from that file. The same search by Riya returns it with a citation.
