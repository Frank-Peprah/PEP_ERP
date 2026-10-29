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
- Year-end trial balance has two stages: `post_close` (default; includes the closing journal, so income-statement accounts are zero) and `pre_close` (`?stage=pre_close`; excludes the closing journal, for reviewing the year's results).
- Adjusted trial balance (`view=adjusted` on screen; fields `unadjusted`, `adjustments`, `closing` on every row): adjusted = unadjusted + adjusting entries dated in the reporting window. A journal is an adjusting entry when flagged at preparation (default for accrual, prepayment, FX revaluation, tax adjustment and correction types; never for opening balances or the closing journal). The flag is frozen once the journal leaves draft; a reversal carries the flag of the journal it reverses.
- Exceptions: `TB_OUT_OF_BALANCE` (blocking), `RETAINED_EARNINGS_NOT_CONFIGURED` (blocking), `UNMAPPED_ACCOUNT`, `ABNORMAL_BALANCE`, `INACTIVE_WITH_BALANCE`.

## Auto-reversing and recurring journals
- **Auto-reversing**: a journal may carry a reversal date (after its own date; not for opening balances, reversals or closing journals). When it is posted, the mirror-image reversal is posted on that date in the same transaction, linked both ways, with the original's preparer and approver (the approval covers both). If the reversal date has no period or its period is locked, the journal cannot be submitted, approved or posted. The date is frozen once the journal leaves draft (database trigger). An auto-reversed journal cannot be reversed again.
- **Recurring**: a template holds balanced lines in the functional currency, a type (recurring, accrual, prepayment, manual), a frequency (monthly, quarterly, six-monthly, yearly), a first date and an optional last date. Run dates keep the first date's day, clamped to short months, or follow month ends. Generating creates one DRAFT per due run date (database-unique per template and date, so repeating it creates nothing twice); drafts go through the normal approval workflow, so the person who generates them cannot approve them. Accrual templates can reverse automatically on the first day of the next period. Templates are paused, resumed or ended; never deleted.

## Year-end close (decision D4: closing journal)
- One closing journal (`journal_type = year_end_close`) per financial year, dated the last day of the year, computed by the system: every revenue and expense balance is reversed and the net goes to the entity's retained-earnings account. It cannot be edited by hand.
- Preconditions (`CLOSE_PRECONDITIONS`): periods 1–11 locked, no unposted journals dated in the year, retained earnings configured, every earlier financial year closed (`PRIOR_YEAR_OPEN`), and something to close. The ledger itself cannot be out of balance (database invariant).
- Authority: `year.close` (controller) generates and finalises; the journal is approved and posted by someone other than its preparer (segregation of duties applies as for any journal).
- Finalise locks any open period and sets the year closed. The database refuses to mark a year closed without a posted, unreversed closing journal and all periods locked (`YEAR_NOT_CLOSABLE`), and refuses a closing journal not dated year-end.
- Re-opening any period of a closed year re-opens the year (audited `year.reopen`); the close must then be reviewed and, if figures change, reversed and regenerated.
- Reporting: profit-and-loss figures (statements, dashboard, monthly trend) exclude closing journals, so the closed year still reports its results; positions (balance sheet, cash) include them.

## Chart of accounts
- Header (non-postable) vs posting accounts; parents must be headers in the same entity.
- Once posted activity exists: code, type and normal balance are frozen (trigger); the account cannot be deleted, only deactivated, and only at zero balance.
- Contra accounts (e.g. accumulated depreciation) are configured with the opposite normal balance.

## Open decisions for professional review
1. ~~Year-end close mechanics~~ — resolved: closing journal (see Year-end close). Years not yet closed still roll forward presentationally (`PRIOR_YEAR_NOT_CLOSED`).
2. Whether control accounts (AR/AP/tax) block manual journals once subledgers exist (R3) — flag exists, not enforced.
3. FX rate source and hierarchy for Ghana (BoG reference rate vs. bank rate) — not implemented.
