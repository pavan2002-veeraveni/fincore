import { createHash } from 'node:crypto';
import { getDb } from '../../infrastructure/database/connection.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { parseCount } from '../../shared/utils/http.js';

interface PaymentIntentRow {
  id: string;
  provider_reference: string | null;
  amount_minor: string;
  currency: string;
}

function normalizePeriodBounds(start: string, end: string): [Date, Date] {
  const s = start.length === 10 ? new Date(`${start}T00:00:00.000Z`) : new Date(start);
  const e = end.length === 10 ? new Date(`${end}T23:59:59.999Z`) : new Date(end);
  return [s, e];
}

export const reconciliationService = {
  async createRun(
    userId: string,
    data: {
      providerName: string;
      periodStart: string;
      periodEnd: string;
      providerData: Array<{ reference: string; amount_minor: number; currency: string; timestamp: string }>;
    },
    requestId?: string,
  ) {
    const db = getDb();
    const sourceFileHash = createHash('sha256')
      .update(JSON.stringify(data.providerData))
      .digest('hex');
    const [startDate, endDate] = normalizePeriodBounds(data.periodStart, data.periodEnd);

    return db.transaction(async (trx) => {
      const [run] = await trx('reconciliation_runs')
        .insert({
          status: 'IN_PROGRESS',
          provider_name: data.providerName,
          period_start: data.periodStart.slice(0, 10),
          period_end: data.periodEnd.slice(0, 10),
          source_file_hash: sourceFileHash,
          initiated_by: userId,
          started_at: new Date(),
        })
        .returning('*');

      const intents = (await trx('payment_intents')
        .where({ provider_name: data.providerName })
        .whereBetween('created_at', [startDate, endDate])) as PaymentIntentRow[];

      const internalMap = new Map<string, PaymentIntentRow>();
      for (const intent of intents) {
        if (intent.provider_reference) {
          internalMap.set(intent.provider_reference, intent);
        }
      }

      const seenProviderRefs = new Set<string>();
      let matchedCount = 0;
      let exceptionCount = 0;

      for (const pItem of data.providerData) {
        let itemType = 'UNKNOWN';
        let matchedInternal: PaymentIntentRow | undefined;

        if (seenProviderRefs.has(pItem.reference)) {
          itemType = 'DUPLICATE';
          exceptionCount++;
        } else {
          seenProviderRefs.add(pItem.reference);
          matchedInternal = internalMap.get(pItem.reference);

          if (matchedInternal) {
            if (
              Number(matchedInternal.amount_minor) === pItem.amount_minor &&
              matchedInternal.currency === pItem.currency
            ) {
              itemType = 'MATCHED';
              matchedCount++;
            } else if (matchedInternal.currency !== pItem.currency) {
              itemType = 'CURRENCY_MISMATCH';
              exceptionCount++;
            } else {
              itemType = 'AMOUNT_MISMATCH';
              exceptionCount++;
            }
            internalMap.delete(pItem.reference);
          } else {
            itemType = 'MISSING_INTERNAL';
            exceptionCount++;
          }
        }

        const [item] = await trx('reconciliation_items')
          .insert({
            run_id: run.id,
            item_type: itemType,
            provider_reference: pItem.reference,
            provider_amount_minor: pItem.amount_minor,
            provider_currency: pItem.currency,
            provider_timestamp: pItem.timestamp,
            internal_reference_id: matchedInternal?.id || null,
            internal_reference_type: matchedInternal ? 'PAYMENT_INTENT' : null,
            internal_amount_minor: matchedInternal ? Number(matchedInternal.amount_minor) : null,
            internal_currency: matchedInternal?.currency || null,
          })
          .returning('*');

        if (itemType !== 'MATCHED') {
          await trx('reconciliation_exceptions').insert({
            run_id: run.id,
            item_id: item.id,
            exception_type: itemType,
            description: `${itemType}: provider ref ${pItem.reference}`,
            status: 'OPEN',
          });
        }
      }

      for (const [ref, internal] of internalMap) {
        const [item] = await trx('reconciliation_items')
          .insert({
            run_id: run.id,
            item_type: 'MISSING_PROVIDER',
            provider_reference: ref,
            internal_reference_id: internal.id,
            internal_reference_type: 'PAYMENT_INTENT',
            internal_amount_minor: Number(internal.amount_minor),
            internal_currency: internal.currency,
          })
          .returning('*');

        await trx('reconciliation_exceptions').insert({
          run_id: run.id,
          item_id: item.id,
          exception_type: 'MISSING_PROVIDER',
          description: `Missing from provider export: ${ref}`,
          status: 'OPEN',
        });
        exceptionCount++;
      }

      const totalItems = data.providerData.length + internalMap.size;
      const [completedRun] = await trx('reconciliation_runs')
        .where({ id: run.id })
        .update({
          status: 'COMPLETED',
          completed_at: new Date(),
          total_items: totalItems,
          matched_count: matchedCount,
          exception_count: exceptionCount,
        })
        .returning('*');

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'RECONCILIATION_RUN',
        resource_type: 'RECONCILIATION_RUN',
        resource_id: run.id,
        details: JSON.stringify({ matchedCount, exceptionCount, totalItems, sourceFileHash }),
        request_id: requestId ?? null,
      });

      return completedRun;
    });
  },

  async getRun(runId: string) {
    const db = getDb();
    const run = await db('reconciliation_runs').where({ id: runId }).first();
    if (!run) throw new NotFoundError('Reconciliation run not found');
    const items = await db('reconciliation_items').where({ run_id: runId });
    const exceptions = await db('reconciliation_exceptions').where({ run_id: runId });
    return { ...run, items, exceptions };
  },

  async listRuns(page = 1, pageSize = 25) {
    const db = getDb();
    const offset = (page - 1) * pageSize;
    const [runs, countRows] = await Promise.all([
      db('reconciliation_runs').orderBy('created_at', 'desc').offset(offset).limit(pageSize),
      db('reconciliation_runs').count('id as count'),
    ]);
    return { runs, total: parseCount(countRows) };
  },

  async getExceptions(opts: { runId?: string; status?: string; page: number; pageSize: number }) {
    const db = getDb();
    const offset = (opts.page - 1) * opts.pageSize;
    let query = db('reconciliation_exceptions');
    if (opts.runId) query = query.where({ run_id: opts.runId });
    if (opts.status) query = query.where({ status: opts.status });

    const [exceptions, countRows] = await Promise.all([
      query.clone().orderBy('created_at', 'desc').offset(offset).limit(opts.pageSize),
      query.clone().count('id as count'),
    ]);
    return { exceptions, total: parseCount(countRows) };
  },

  async resolveException(
    userId: string,
    exceptionId: string,
    notes: string,
    status: 'RESOLVED' | 'DISMISSED' = 'RESOLVED',
    requestId?: string,
  ) {
    const db = getDb();
    return db.transaction(async (trx) => {
      const [exception] = await trx('reconciliation_exceptions')
        .where({ id: exceptionId })
        .update({
          status,
          resolved_by: userId,
          resolution_notes: notes,
          resolved_at: new Date(),
        })
        .returning('*');
      if (!exception) throw new NotFoundError('Exception not found');

      await trx('audit_events').insert({
        actor_id: userId,
        action: 'ADMIN_ACTION',
        resource_type: 'RECONCILIATION_EXCEPTION',
        resource_id: exceptionId,
        details: JSON.stringify({ status, notes }),
        request_id: requestId ?? null,
      });

      return exception;
    });
  },
};
