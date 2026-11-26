import { Currency, minorToDecimalString } from '@fincore/contracts';
import { getDb } from '../../infrastructure/database/connection.js';
import { config } from '../../config/index.js';
import { metrics } from '../../infrastructure/metrics/index.js';
import { NotFoundError } from '../../shared/errors/index.js';

export interface AssessRiskParams {
  customerId?: string;
  transactionAmountMinor: number;
  currency?: 'INR';
  transactionType?: 'TRANSFER' | 'PAYMENT' | 'WITHDRAWAL';
  beneficiaryIsNew?: boolean;
  recentTransactionCount?: number;
  recentTotalAmountMinor?: number;
  recentFailureCount?: number;
  customerAccountAgeDays?: number;
  failMode?: 'FAIL_OPEN' | 'FAIL_CLOSED';
  actorUserId?: string;
  requestId?: string;
  timeoutMs?: number;
}

export interface RiskServiceResponse {
  assessment_id: string | null;
  score: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  rule_hits: Array<{
    rule_id: string;
    rule_name: string;
    severity: string;
    explanation: string;
  }>;
  explanations: string[];
  ruleset_version: string;
  evaluated_at: string;
}

export class RiskServiceUnavailableError extends Error {
  constructor(message = 'Risk service unavailable and fail-closed policy is active for this operation') {
    super(message);
  }
}

export class RiskServiceUpstreamError extends Error {
  constructor(message = 'Risk analytics service returned an error') {
    super(message);
  }
}

export const riskService = {
  async assessTransaction(params: AssessRiskParams): Promise<{
    result: RiskServiceResponse;
    fallbackApplied: boolean;
    warning?: string;
  }> {
    const db = getDb();
    const failMode = params.failMode ?? 'FAIL_OPEN';
    const timeoutMs = params.timeoutMs ?? 3000;

    if (params.customerId) {
      const exists = await db('customer_profiles').where({ id: params.customerId }).select('id').first();
      if (!exists) {
        throw new NotFoundError('Customer profile not found for risk assessment');
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const riskPayload = {
        customer_id: params.customerId ?? params.actorUserId ?? '00000000-0000-4000-8000-000000000002',
        transaction_amount: minorToDecimalString(params.transactionAmountMinor, Currency.INR),
        currency: params.currency ?? 'INR',
        transaction_type: params.transactionType ?? 'TRANSFER',
        beneficiary_is_new: params.beneficiaryIsNew ?? false,
        recent_transaction_count: params.recentTransactionCount ?? 0,
        recent_total_amount: minorToDecimalString(params.recentTotalAmountMinor ?? 0, Currency.INR),
        recent_failure_count: params.recentFailureCount ?? 0,
        customer_account_age_days: params.customerAccountAgeDays ?? 365,
      };

      const response = await fetch(`${config.RISK_SERVICE_URL}/api/v1/assess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Token': config.RISK_SERVICE_TOKEN,
          ...(params.requestId ? { 'X-Request-ID': params.requestId } : {}),
        },
        body: JSON.stringify(riskPayload),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        if (failMode === 'FAIL_OPEN') {
          metrics.counters.riskFallbacks += 1;
          return {
            result: {
              assessment_id: null,
              score: 0,
              risk_level: 'LOW',
              rule_hits: [],
              explanations: [
                'SIMULATED RISK FALLBACK — Risk service returned non-OK status; fail-open policy applied (decision support only)',
              ],
              ruleset_version: 'fallback',
              evaluated_at: new Date().toISOString(),
            },
            fallbackApplied: true,
            warning: 'Risk service returned an upstream error; fail-open policy applied per ASSUMPTIONS.md A10',
          };
        }
        throw new RiskServiceUpstreamError();
      }

      const result = (await response.json()) as RiskServiceResponse;
      metrics.counters.riskAssessments += 1;

      await db.transaction(async (trx) => {
        await trx('risk_assessments').insert({
          id: result.assessment_id,
          customer_id: params.customerId ?? null,
          transaction_type: params.transactionType ?? 'TRANSFER',
          score: result.score,
          risk_level: result.risk_level,
          rule_hits: JSON.stringify(result.rule_hits),
          explanations: JSON.stringify(result.explanations),
          ruleset_version: result.ruleset_version,
          evaluated_at: result.evaluated_at,
        });

        await trx('audit_events').insert({
          actor_id: params.actorUserId ?? null,
          action: 'RISK_ASSESSMENT_CREATED',
          resource_type: 'RISK_ASSESSMENT',
          resource_id: result.assessment_id,
          details: JSON.stringify({
            customerId: params.customerId ?? null,
            score: result.score,
            riskLevel: result.risk_level,
          }),
          request_id: params.requestId ?? null,
        });

        if (result.risk_level === 'HIGH' || result.risk_level === 'CRITICAL') {
          const [alert] = await trx('risk_alerts')
            .insert({
              assessment_id: result.assessment_id,
              customer_id: params.customerId ?? null,
              alert_type: 'HIGH_RISK_TRANSACTION',
              severity: result.risk_level,
              description: `SIMULATED RISK ALERT — Score ${result.score}/100: ${result.explanations.join('; ')}`,
              status: 'OPEN',
            })
            .returning('id');

          await trx('audit_events').insert({
            actor_id: params.actorUserId ?? null,
            action: 'RISK_ALERT_CREATED',
            resource_type: 'RISK_ALERT',
            resource_id: alert.id,
            details: JSON.stringify({ assessmentId: result.assessment_id, severity: result.risk_level }),
            request_id: params.requestId ?? null,
          });
        }
      });

      return { result, fallbackApplied: false };
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (err instanceof RiskServiceUpstreamError || err instanceof NotFoundError) {
        throw err;
      }

      const errObj = err as { name?: string; code?: string };
      const isNetworkOrTimeout =
        errObj?.name === 'AbortError' ||
        err instanceof TypeError ||
        errObj?.code === 'ECONNREFUSED';

      if (isNetworkOrTimeout && failMode === 'FAIL_OPEN') {
        metrics.counters.riskFallbacks += 1;
        return {
          result: {
            assessment_id: null,
            score: 0,
            risk_level: 'LOW',
            rule_hits: [],
            explanations: [
              'SIMULATED RISK FALLBACK — Risk service unavailable/timed out; fail-open policy applied (decision support only)',
            ],
            ruleset_version: 'fallback',
            evaluated_at: new Date().toISOString(),
          },
          fallbackApplied: true,
          warning: 'Risk service unavailable; fail-open policy applied per ASSUMPTIONS.md A10',
        };
      }

      if (isNetworkOrTimeout && failMode === 'FAIL_CLOSED') {
        metrics.counters.riskFallbacks += 1;
        throw new RiskServiceUnavailableError();
      }
      throw err;
    }
  },
};
