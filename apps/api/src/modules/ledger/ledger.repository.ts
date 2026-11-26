import { type Knex } from 'knex';
import { getDb } from '../../infrastructure/database/connection.js';
import { parseCount } from '../../shared/utils/http.js';

export interface JournalRow {
  id: string;
  type: string;
  status: string;
  currency: string;
  description: string | null;
  reference_id: string | null;
  reference_type: string | null;
  posted_by: string | null;
  posted_at: Date | null;
  created_at: Date;
}

export interface LedgerEntryRow {
  id: string;
  journal_transaction_id: string;
  line_number: number;
  wallet_id: string;
  entry_type: 'DEBIT' | 'CREDIT';
  amount_minor: string;
  currency: string;
  description: string | null;
  created_at: Date;
}

export interface HoldRow {
  id: string;
  wallet_id: string;
  amount_minor: string;
  currency: string;
  status: 'ACTIVE' | 'CAPTURED' | 'RELEASED' | 'EXPIRED';
  reason: string | null;
  reference_id: string | null;
  reference_type: string | null;
  created_at: Date;
  captured_at: Date | null;
  released_at: Date | null;
  expires_at: Date | null;
}

export const ledgerRepository = {
  async createJournalTransaction(
    trx: Knex,
    data: {
      type: string;
      currency: string;
      description?: string;
      referenceId?: string;
      referenceType?: string;
    },
  ): Promise<JournalRow> {
    const [row] = await trx('journal_transactions')
      .insert({
        type: data.type,
        status: 'PENDING',
        currency: data.currency,
        description: data.description || null,
        reference_id: data.referenceId || null,
        reference_type: data.referenceType || null,
      })
      .returning('*');
    return row as JournalRow;
  },

  async createLedgerEntries(
    trx: Knex,
    journalId: string,
    entries: Array<{
      walletId: string;
      entryType: 'DEBIT' | 'CREDIT';
      amountMinor: number;
      currency: string;
      description?: string;
    }>,
  ): Promise<LedgerEntryRow[]> {
    const rows = entries.map((e, idx) => ({
      journal_transaction_id: journalId,
      line_number: idx + 1,
      wallet_id: e.walletId,
      entry_type: e.entryType,
      amount_minor: e.amountMinor,
      currency: e.currency,
      description: e.description || null,
    }));
    const result = await trx('ledger_entries').insert(rows).returning('*');
    return result as LedgerEntryRow[];
  },

  async postJournal(
    trx: Knex,
    journalId: string,
    postedBy: string,
  ): Promise<JournalRow> {
    const [row] = await trx('journal_transactions')
      .where({ id: journalId })
      .update({
        status: 'POSTED',
        posted_by: postedBy,
        posted_at: trx.fn.now(),
      })
      .returning('*');
    return row as JournalRow;
  },

  async getJournalById(journalId: string): Promise<JournalRow | undefined> {
    const db = getDb();
    return db('journal_transactions').where({ id: journalId }).first() as Promise<JournalRow | undefined>;
  },

  async getEntriesForJournal(journalId: string): Promise<LedgerEntryRow[]> {
    const db = getDb();
    return db('ledger_entries')
      .where({ journal_transaction_id: journalId })
      .orderBy('line_number') as Promise<LedgerEntryRow[]>;
  },

  async getEntriesForWallet(
    walletId: string,
    page: number,
    pageSize: number,
  ): Promise<{ entries: LedgerEntryRow[]; total: number }> {
    const db = getDb();
    const offset = (page - 1) * pageSize;

    const [entries, countRows] = await Promise.all([
      db('ledger_entries as le')
        .join('journal_transactions as jt', 'le.journal_transaction_id', 'jt.id')
        .where({ 'le.wallet_id': walletId, 'jt.status': 'POSTED' })
        .select('le.*', 'jt.type as journal_type', 'jt.reference_id', 'jt.reference_type')
        .orderBy('le.created_at', 'desc')
        .offset(offset)
        .limit(pageSize),
      db('ledger_entries as le')
        .join('journal_transactions as jt', 'le.journal_transaction_id', 'jt.id')
        .where({ 'le.wallet_id': walletId, 'jt.status': 'POSTED' })
        .count('le.id as count'),
    ]);

    return { entries: entries as LedgerEntryRow[], total: parseCount(countRows) };
  },

  async getDerivedBalance(walletId: string): Promise<{ debits: number; credits: number; balance: number }> {
    const db = getDb();
    const result = await db('ledger_entries as le')
      .join('journal_transactions as jt', 'le.journal_transaction_id', 'jt.id')
      .where({ 'le.wallet_id': walletId, 'jt.status': 'POSTED' })
      .select(
        db.raw("COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount_minor ELSE 0 END), 0)::bigint as credits"),
        db.raw("COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount_minor ELSE 0 END), 0)::bigint as debits"),
      )
      .first<Record<string, unknown> | undefined>();

    const credits = Number(result?.['credits'] ?? 0);
    const debits = Number(result?.['debits'] ?? 0);
    return { debits, credits, balance: credits - debits };
  },

  async getActiveHoldsTotal(trx: Knex | ReturnType<typeof getDb>, walletId: string): Promise<number> {
    const result = await trx('holds')
      .where({ wallet_id: walletId, status: 'ACTIVE' })
      .sum('amount_minor as total')
      .first<Record<string, unknown> | undefined>();
    return Number(result?.['total'] ?? 0);
  },

  async createHold(
    trx: Knex,
    data: {
      walletId: string;
      amountMinor: number;
      currency: string;
      reason?: string;
      referenceId?: string;
      referenceType?: string;
      expiresAt?: Date;
    },
  ): Promise<HoldRow> {
    const [row] = await trx('holds')
      .insert({
        wallet_id: data.walletId,
        amount_minor: data.amountMinor,
        currency: data.currency,
        status: 'ACTIVE',
        reason: data.reason || null,
        reference_id: data.referenceId || null,
        reference_type: data.referenceType || null,
        expires_at: data.expiresAt || null,
      })
      .returning('*');
    return row as HoldRow;
  },

  async getActiveHoldByReference(
    trx: Knex,
    referenceType: string,
    referenceId: string,
  ): Promise<HoldRow | undefined> {
    return trx('holds')
      .where({ reference_type: referenceType, reference_id: referenceId, status: 'ACTIVE' })
      .forUpdate()
      .first() as Promise<HoldRow | undefined>;
  },

  async updateHoldStatus(
    trx: Knex,
    holdId: string,
    status: 'CAPTURED' | 'RELEASED' | 'EXPIRED',
  ): Promise<HoldRow> {
    const now = new Date();
    const update: Record<string, unknown> = { status };
    if (status === 'CAPTURED') update['captured_at'] = now;
    if (status === 'RELEASED') update['released_at'] = now;
    const [row] = await trx('holds').where({ id: holdId }).update(update).returning('*');
    return row as HoldRow;
  },

  async getSystemWallet(
    trx: Knex,
    walletType: 'SYSTEM_CLEARING' | 'SYSTEM_FEE' | 'SYSTEM_SUSPENSE',
    currency: string,
  ): Promise<{ id: string; currency: string; wallet_type: string } | undefined> {
    return trx('wallets')
      .where({ wallet_type: walletType, currency, status: 'ACTIVE' })
      .first() as Promise<{ id: string; currency: string; wallet_type: string } | undefined>;
  },
};
