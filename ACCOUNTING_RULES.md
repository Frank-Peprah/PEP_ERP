# Accounting rules (implemented)

Owner: Group CFO. Changes require review and a new ADR where behaviour changes.

## Amounts and precision
- Stored as `NUMERIC(20,2)`; computed with `decimal.js` (40-digit precision). Binary floats never touch money.
- Inputs finer than the currency's minor unit are **rejected**, not rounded (GHS: 2 dp). Unknown currencies are rejected.
- Each line: debit ≥ 0, credit ≥ 0, not both > 0, not both 0.

## Currency
- Each journal carries transaction currency and one FX rate to the functional currency (rate must be 1 when equal).
- Functional amount per line = transaction amount × rate, banker's rounding (half-even) to functional precision.
- A journal must balance in **both** currencies. A translation rounding difference is surfaced as `FX_ROUNDING_DIFFERENCE`; the preparer adds an explicit rounding line. The system never plugs it.
- Not yet implemented: rate tables, revaluation of monetary items (IAS 21), realised/unrealised FX.

## Journal lifecycle
`draft → submitted → approved → posted`; `submitted/approved → draft` (return); any pre-posted state → `rejected` (terminal, retained).
- Drafts may be unbalanced. Submission, approval and posting each re-validate balance, period and accounts.
- Content is frozen once submitted; only workflow fields change.
- Segregation of duties (entity setting, default on): the preparer cannot approve or post their own journal — even with controller rights.
- Posted journals are immutable. Corrections use a linked reversal (same approval workflow) plus a new journal. A journal can be reversed once; reversals cannot be reversed.
- Posting numbers: `JV-<FY label>-<6 digits>`, gapless per entity and FY. Drafts carry an internal draft number.

## Periods
- Monthly periods inside non-overlapping financial years (DB exclusion constraints).
- Locked period: no submission, approval or posting into it. Lock gate: period movements must balance.
- Re-opening requires the `periods.reopen` permission and a reason; both actions are audited.

## Trial balance
- Source: posted journal lines only. Drafts/submitted/approved never appear.
- YTD basis: opening = position at FY start; period basis: opening = position at period start.
- Income-statement accounts open at zero each FY. Prior-year results not yet closed appear as an explicit, system-computed retained-earnings line (`PRIOR_YEAR_NOT_CLOSED`).
- Exceptions: `TB_OUT_OF_BALANCE` (blocking), `RETAINED_EARNINGS_NOT_CONFIGURED` (blocking), `UNMAPPED_ACCOUNT`, `ABNORMAL_BALANCE`, `INACTIVE_WITH_BALANCE`.

## Chart of accounts
- Header (non-postable) vs posting accounts; parents must be headers in the same entity.
- Once posted activity exists: code, type and normal balance are frozen (trigger); the account cannot be deleted, only deactivated, and only at zero balance.
- Contra accounts (e.g. accumulated depreciation) are configured with the opposite normal balance.

## Open decisions for professional review
1. Year-end close mechanics (closing journal vs. presentational roll-forward) — currently presentational.
2. Whether control accounts (AR/AP/tax) block manual journals once subledgers exist (R3) — flag exists, not enforced.
3. FX rate source and hierarchy for Ghana (BoG reference rate vs. bank rate) — not implemented.
