import { describe, it, expect } from 'vitest';
import {
  DISPUTE_TRANSITIONS,
  PAYMENT_INTENT_TRANSITIONS,
  REFUND_TRANSITIONS,
  TRANSFER_TRANSITIONS,
  assertValidTransition,
  canTransition,
} from '../../src/shared/state-machine.js';
import { ValidationError } from '../../src/shared/errors/index.js';

describe('Financial State Machines', () => {
  it('allows valid transfer transitions', () => {
    expect(canTransition(TRANSFER_TRANSITIONS, 'CREATED', 'PENDING_CONFIRMATION')).toBe(true);
    expect(canTransition(TRANSFER_TRANSITIONS, 'PENDING_CONFIRMATION', 'PROCESSING')).toBe(true);
    expect(canTransition(TRANSFER_TRANSITIONS, 'PENDING_CONFIRMATION', 'CANCELLED')).toBe(true);
    expect(canTransition(TRANSFER_TRANSITIONS, 'PROCESSING', 'COMPLETED')).toBe(true);
    expect(canTransition(TRANSFER_TRANSITIONS, 'COMPLETED', 'PARTIALLY_REFUNDED')).toBe(true);
    expect(canTransition(TRANSFER_TRANSITIONS, 'COMPLETED', 'REVERSED')).toBe(true);
    expect(canTransition(TRANSFER_TRANSITIONS, 'PARTIALLY_REFUNDED', 'REFUNDED')).toBe(true);
  });

  it('rejects invalid transfer transitions with ValidationError', () => {
    expect(() => assertValidTransition('Transfer', TRANSFER_TRANSITIONS, 'COMPLETED', 'PENDING_CONFIRMATION')).toThrow(ValidationError);
    expect(() => assertValidTransition('Transfer', TRANSFER_TRANSITIONS, 'REVERSED', 'COMPLETED')).toThrow(ValidationError);
    expect(() => assertValidTransition('Transfer', TRANSFER_TRANSITIONS, 'FAILED', 'COMPLETED')).toThrow(ValidationError);
    expect(() => assertValidTransition('Transfer', TRANSFER_TRANSITIONS, 'REFUNDED', 'PARTIALLY_REFUNDED')).toThrow(ValidationError);
  });

  it('enforces payment intent state transitions', () => {
    expect(canTransition(PAYMENT_INTENT_TRANSITIONS, 'PENDING', 'SUCCEEDED')).toBe(true);
    expect(canTransition(PAYMENT_INTENT_TRANSITIONS, 'PENDING', 'FAILED')).toBe(true);
    expect(canTransition(PAYMENT_INTENT_TRANSITIONS, 'SUCCEEDED', 'REFUNDED')).toBe(true);
    expect(() => assertValidTransition('PaymentIntent', PAYMENT_INTENT_TRANSITIONS, 'SUCCEEDED', 'FAILED')).toThrow(ValidationError);
    expect(() => assertValidTransition('PaymentIntent', PAYMENT_INTENT_TRANSITIONS, 'FAILED', 'SUCCEEDED')).toThrow(ValidationError);
  });

  it('enforces dispute and refund state transitions', () => {
    expect(canTransition(DISPUTE_TRANSITIONS, 'OPEN', 'UNDER_REVIEW')).toBe(true);
    expect(canTransition(DISPUTE_TRANSITIONS, 'UNDER_REVIEW', 'RESOLVED_ACCEPTED')).toBe(true);
    expect(() => assertValidTransition('Dispute', DISPUTE_TRANSITIONS, 'CLOSED', 'OPEN')).toThrow(ValidationError);
    expect(() => assertValidTransition('Refund', REFUND_TRANSITIONS, 'COMPLETED', 'FAILED')).toThrow(ValidationError);
  });
});
