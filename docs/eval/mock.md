# Evaluation (mock mode, 2026-09-15)

| Sample | Doc type | Header fields | Line items | Grounded values | Issues | Model cost | Pass |
|---|---|---|---|---|---|---|---|
| clean-digital | invoice | 10/10 | 3/3 | 20/20 | none | $0.0000 | yes |
| euro-format | invoice | 10/10 | 3/3 | 20/20 | none | $0.0000 | yes |
| injection | invoice | 10/10 | 2/2 | 16/16 | none | $0.0000 | yes |
| mismatch-total | invoice | 10/10 | 3/3 | 20/20 | V003 | $0.0000 | yes |
| multipage-lineitems | invoice | 10/10 | 25/25 | 108/108 | none | $0.0000 | yes |
| not-an-invoice | rejected (ok) | - | - | - | - | $0.0000 | yes |
| scan-lowres | invoice | 10/10 | 3/3 | 20/20 | none | $0.0000 | yes |
| scan-photo | invoice | 10/10 | 3/3 | 18/20 | V010 | $0.0000 | yes |

Total model cost for the set: $0.0000. Replayed samples cost nothing; live runs are priced at Sonnet 5 rates.
