# Evaluation (mock mode, 2026-09-15)

| Sample | Doc type | Header fields | Line items | Grounded values | Issues | Model cost | Pass |
|---|---|---|---|---|---|---|---|
| clean-digital | invoice | 10/10 | 3/3 (got 3) | 20/20 | none | $0.0000 | yes |
| euro-format | invoice | 10/10 | 3/3 (got 3) | 20/20 | none | $0.0000 | yes |
| injection | invoice | 10/10 | 2/2 (got 2) | 16/16 | none | $0.0000 | yes |
| mismatch-total | invoice | 10/10 | 3/3 (got 3) | 20/20 | V003 | $0.0000 | yes |
| multipage-lineitems | invoice | 10/10 | 25/25 (got 25) | 108/108 | none | $0.0000 | yes |
| not-an-invoice | rejected (not_an_invoice) | - | - | - | - | $0.0000 | yes |
| scan-lowres | invoice | 10/10 | 3/3 (got 3) | 20/20 | none | $0.0000 | yes |
| scan-photo | invoice | 10/10 | 3/3 (got 3) | 18/20 | V010 | $0.0000 | yes |

Scored 8 of 8 samples. Line items read matched/expected (returned). Only V002 to V009 are scored against the ground truth's expected issues; the OCR-dependent and classification codes (V001, V010, V011, V012) are shown for information and never fail a sample.

Total model cost for the set: $0.0000. Replayed samples cost nothing; live runs are priced at Sonnet 5 rates.
