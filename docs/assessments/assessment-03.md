# Assessment 03 — Double-Entry Ledger Database

## 1. Objective & Scope
Design and enforce an append-only, double-entry accounting ledger in PostgreSQL where posted journals always balance (`SUM(debits) == SUM(credits)` per currency), balances are protected from negative overdraft on customer accounts, and corrections require compensating postings.

## 2. Implemented Components & Code Paths
- Migrations & Database Triggers: `apps/api/src/infrastructure/database/migrations/002_financial_core.ts`, `003_payments_disputes_risk.ts`, `004_system_accounts_and_hardening.ts`, `005_security_and_ledger_hardening.ts`
- Ledger Posting & Reconciliation Service: `apps/api/src/modules/ledger/ledger.service.ts`, `ledger.repository.ts`, `ledger.controller.ts`, `ledger.routes.ts`
- Seeded System Control Wallets: `SYSTEM_CLEARING`, `SYSTEM_FEE`, `SYSTEM_SUSPENSE` (`004_system_accounts_and_hardening.ts`)

## 3. Design Decisions
- **Monetary unit:** `BIGINT` integer paise (`INR`, `100 paise = 1 INR`) (`ASSUMPTIONS.md` A1).
- **Triggers:**
  - `enforce_ledger_immutability` (`BEFORE UPDATE OR DELETE ON ledger_entries`) raises PostgreSQL exception.
  - `enforce_posted_journal_immutability` (`BEFORE UPDATE OR DELETE ON journal_transactions`) blocks altering/deleting `POSTED` headers.
  - `enforce_journal_balance` (`AFTER INSERT OR UPDATE ... DEFERRABLE INITIALLY DEFERRED`) checks `>= 2` entries, single currency, and `debit_sum == credit_sum`.
  - `wallets_customer_no_overdraft_check` ensures `CUSTOMER` wallets never drop below `0` `available_balance_minor`.
- **Balances & Holds:** Transactional balance projection (`ledger_balance_minor` / `available_balance_minor`) updated inside the same DB transaction, verified via `reconcileWalletBalance()` and `getGlobalLedgerInvariantCheck()`.

## 4. Test Commands & Actual Results
- `knex migrate:latest` (`001`–`005`) applied cleanly on PostgreSQL 18.7 (`Batch 1: 4 migrations`, `Batch 2: 1 migration`).
- `apps/api/tests/integration/ledger.test.ts` (**5/5 tests passed** in `test:coverage` run): verified balanced posting & parity, application & raw-SQL deferred trigger rejection of unbalanced and single-entry journals, immutability rejection (`UPDATE`/`DELETE` on `ledger_entries`, `journal_transactions`, `audit_events`, and `dispute_events`, plus `enforce_ledger_entry_not_posted` late-insert rejection from Migration 005), and hold placement/capture overdraft protection.

## 5. Evidence References
- Data Model Documentation: `docs/DATA_MODEL.md`
- Ledger Invariant Tests: `apps/api/tests/integration/ledger.test.ts`

## 6. Known Limitations & Remaining Work
- Single primary currency (`INR`) configured in wallet CHECK constraints (`ASSUMPTIONS.md` A2).
