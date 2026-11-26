import { getDb } from '../../infrastructure/database/connection.js';
import { logger } from '../../infrastructure/logger/index.js';
import { metrics } from '../../infrastructure/metrics/index.js';

export interface NotificationPayload {
  userId: string;
  outboxEventId?: string;
  channel: 'EMAIL' | 'SMS';
  template: string;
  recipient: string;
  templateData?: Record<string, unknown>;
}

export interface NotificationResult {
  jobId: string;
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  providerMessageId?: string;
}

function maskRecipient(channel: 'EMAIL' | 'SMS', recipient: string): string {
  if (channel === 'EMAIL') {
    const [local, domain] = recipient.split('@');
    if (!local || !domain) return '***';
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (recipient.length <= 4) return '****';
  return `******${recipient.slice(-4)}`;
}

/**
 * Sandbox Notification Adapter — SIMULATED Email/SMS delivery.
 * Persists job state in `notification_jobs` and emits safe structured logs.
 * Never transmits real external emails/SMS.
 */
export const notificationsService = {
  async sendSandboxNotification(input: NotificationPayload): Promise<NotificationResult> {
    const db = getDb();

    // Idempotency: do not send duplicate notification for same outbox_event + channel + template
    if (input.outboxEventId) {
      const existing = await db('notification_jobs')
        .where({
          outbox_event_id: input.outboxEventId,
          channel: input.channel,
          template: input.template,
          status: 'SENT',
        })
        .first<{ id: string } | undefined>();
      if (existing) {
        return { jobId: existing.id, status: 'SENT' };
      }
    }

    const emailEnabled = process.env['EMAIL_SANDBOX_ENABLED'] !== 'false';
    const smsEnabled = process.env['SMS_SANDBOX_ENABLED'] !== 'false';
    const enabled = input.channel === 'EMAIL' ? emailEnabled : smsEnabled;

    const [job] = await db('notification_jobs')
      .insert({
        user_id: input.userId,
        outbox_event_id: input.outboxEventId ?? null,
        channel: input.channel,
        template: input.template,
        template_data: input.templateData ? JSON.stringify(input.templateData) : null,
        recipient: maskRecipient(input.channel, input.recipient),
        status: enabled ? 'SENT' : 'SKIPPED',
        sent_at: enabled ? new Date() : null,
      })
      .returning<{ id: string }[]>('id');

    const jobId = job!.id;

    if (!enabled) {
      logger.info(
        { jobId, channel: input.channel, template: input.template },
        '[SANDBOX NOTIFICATION] Channel disabled — marked SKIPPED',
      );
      return { jobId, status: 'SKIPPED' };
    }

    const providerMessageId = `sim_${input.channel.toLowerCase()}_${jobId.slice(0, 8)}`;
    metrics.counters.notificationsSent += 1;

    logger.info(
      {
        jobId,
        channel: input.channel,
        template: input.template,
        recipient: maskRecipient(input.channel, input.recipient),
        providerMessageId,
      },
      `[SANDBOX ${input.channel}] Simulated notification delivered`,
    );

    return { jobId, status: 'SENT', providerMessageId };
  },
};
