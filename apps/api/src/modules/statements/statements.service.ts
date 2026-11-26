import { stringify } from 'csv-stringify/sync';
import { minorToDecimalString, type Currency } from '@fincore/contracts';
import { getDb } from '../../infrastructure/database/connection.js';
import { walletsRepository } from '../wallets/wallets.repository.js';
import { parseCount } from '../../shared/utils/http.js';
import { NotFoundError, ValidationError } from '../../shared/errors/index.js';

function sanitizeCsvCell(value: string): string {
  // Neutralize formula injection in spreadsheet tools
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function periodBounds(start: string, end: string): [Date, Date] {
  const s = new Date(start.length === 10 ? `${start}T00:00:00.000Z` : start);
  const e = new Date(end.length === 10 ? `${end}T23:59:59.999Z` : end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s > e) {
    throw new ValidationError('Invalid statement periodStart / periodEnd');
  }
  return [s, e];
}

export const statementsService = {
  async generate(
    userId: string,
    data: { walletId: string; periodStart: string; periodEnd: string },
    requestId?: string,
  ) {
    const db = getDb();
    const customerId = await walletsRepository.getCustomerIdByUserId(userId);
    if (!customerId) throw new NotFoundError('Customer not found');

    const wallet = await walletsRepository.getWalletWithOwnership(data.walletId, customerId);
    if (!wallet) throw new NotFoundError('Wallet not found');

    const [startDate, endDate] = periodBounds(data.periodStart, data.periodEnd);

    const entries = await db('ledger_entries as le')
      .join('journal_transactions as jt', 'le.journal_transaction_id', 'jt.id')
      .where({ 'le.wallet_id': data.walletId, 'jt.status': 'POSTED' })
      .whereBetween('le.created_at', [startDate, endDate])
      .select('le.*', 'jt.type as journal_type', 'jt.description as journal_description')
      .orderBy('le.created_at', 'asc');

    const openingResult = await db('ledger_entries as le')
      .join('journal_transactions as jt', 'le.journal_transaction_id', 'jt.id')
      .where({ 'le.wallet_id': data.walletId, 'jt.status': 'POSTED' })
      .where('le.created_at', '<', startDate)
      .select(
        db.raw(
          "COALESCE(SUM(CASE WHEN le.entry_type = 'CREDIT' THEN le.amount_minor ELSE 0 END), 0)::bigint - COALESCE(SUM(CASE WHEN le.entry_type = 'DEBIT' THEN le.amount_minor ELSE 0 END), 0)::bigint as balance",
        ),
      )
      .first<Record<string, unknown> | undefined>();

    const openingBalance = Number(openingResult?.['balance'] ?? 0);
    let runningBalance = openingBalance;
    for (const e of entries) {
      runningBalance += e.entry_type === 'CREDIT' ? Number(e.amount_minor) : -Number(e.amount_minor);
    }

    const [statement] = await db.transaction(async (trx) => {
      const [inserted] = await trx('statements')
        .insert({
          customer_id: customerId,
          wallet_id: data.walletId,
          period_start: data.periodStart.slice(0, 10),
          period_end: data.periodEnd.slice(0, 10),
          currency: wallet.currency,
          opening_balance_minor: openingBalance,
          closing_balance_minor: runningBalance,
          transaction_count: entries.length,
          status: 'READY',
          generated_at: new Date(),
        })
        .returning('*');

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'STATEMENT_GENERATED',
        resource_type: 'STATEMENT',
        resource_id: inserted.id,
        request_id: requestId ?? null,
      });

      return [inserted];
    });

    return statement;
  },

  async exportCsv(userId: string, statementId: string) {
    const db = getDb();
    const customerId = await walletsRepository.getCustomerIdByUserId(userId);
    if (!customerId) throw new NotFoundError('Customer not found');

    const statement = await db('statements')
      .where({ id: statementId, customer_id: customerId })
      .select(
        '*',
        db.raw("TO_CHAR(period_start, 'YYYY-MM-DD') as period_start_iso"),
        db.raw("TO_CHAR(period_end, 'YYYY-MM-DD') as period_end_iso"),
      )
      .first();
    if (!statement) throw new NotFoundError('Statement not found');

    const periodStartStr = String(statement.period_start_iso);
    const periodEndStr = String(statement.period_end_iso);
    const [startDate, endDate] = periodBounds(periodStartStr, periodEndStr);

    const cutoffDate = statement.generated_at ? new Date(statement.generated_at) : endDate;
    const effectiveEnd = cutoffDate < endDate ? cutoffDate : endDate;

    const entries = await db('ledger_entries as le')
      .join('journal_transactions as jt', 'le.journal_transaction_id', 'jt.id')
      .where({ 'le.wallet_id': statement.wallet_id, 'jt.status': 'POSTED' })
      .whereBetween('le.created_at', [startDate, effectiveEnd])
      .select('le.*', 'jt.type as journal_type', 'jt.description as journal_description')
      .orderBy('le.created_at', 'asc');

    const rows = entries.map((e) => {
      const currency = (e.currency as Currency) || 'INR';
      const formattedAmount = minorToDecimalString(Number(e.amount_minor), currency);
      return [
        new Date(e.created_at).toISOString(),
        sanitizeCsvCell(String(e.journal_description || e.description || '')),
        e.entry_type === 'DEBIT' ? formattedAmount : '',
        e.entry_type === 'CREDIT' ? formattedAmount : '',
        e.entry_type === 'DEBIT' ? String(e.amount_minor) : '',
        e.entry_type === 'CREDIT' ? String(e.amount_minor) : '',
        String(e.journal_type),
        currency,
      ];
    });

    const csv = stringify(rows, {
      header: true,
      columns: [
        'Date (UTC)',
        'Description',
        'Debit',
        'Credit',
        'Debit (paise)',
        'Credit (paise)',
        'Type',
        'Currency',
      ],
    });

    return { csv, statement };
  },

  async list(userId: string, page = 1, pageSize = 25) {
    const db = getDb();
    const customerId = await walletsRepository.getCustomerIdByUserId(userId);
    if (!customerId) throw new NotFoundError('Customer not found');
    const offset = (page - 1) * pageSize;
    const [statements, countRows] = await Promise.all([
      db('statements')
        .where({ customer_id: customerId })
        .orderBy('created_at', 'desc')
        .offset(offset)
        .limit(pageSize),
      db('statements').where({ customer_id: customerId }).count('id as count'),
    ]);
    return { statements, total: parseCount(countRows) };
  },
};
