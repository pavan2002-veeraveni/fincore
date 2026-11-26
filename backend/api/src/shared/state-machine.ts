import { ValidationError } from './errors/index.js';

export const TRANSFER_TRANSITIONS: Record<string, readonly string[]> = {
  CREATED: ['PENDING_CONFIRMATION', 'PROCESSING', 'CANCELLED'],
  PENDING_CONFIRMATION: ['PROCESSING', 'CANCELLED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: ['PARTIALLY_REFUNDED', 'REFUNDED', 'REVERSED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  REFUNDED: [],
  REVERSED: [],
  FAILED: [],
  CANCELLED: [],
};

export const PAYMENT_INTENT_TRANSITIONS: Record<string, readonly string[]> = {
  CREATED: ['PENDING', 'CANCELLED', 'FAILED'],
  PENDING: ['PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
  PROCESSING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: ['REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export const DISPUTE_TRANSITIONS: Record<string, readonly string[]> = {
  OPEN: ['UNDER_REVIEW', 'CLOSED'],
  UNDER_REVIEW: ['INFORMATION_REQUESTED', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'],
  INFORMATION_REQUESTED: ['UNDER_REVIEW', 'CLOSED'],
  RESOLVED_ACCEPTED: ['CLOSED'],
  RESOLVED_REJECTED: ['CLOSED', 'UNDER_REVIEW'],
  CLOSED: [],
};

export const REFUND_TRANSITIONS: Record<string, readonly string[]> = {
  CREATED: ['PROCESSING', 'COMPLETED', 'FAILED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

/**
 * Validate whether a state transition is permitted by the given transition table.
 * Throws ValidationError when the transition is invalid.
 */
export function assertValidTransition(
  entityName: string,
  transitions: Record<string, readonly string[]>,
  fromState: string,
  toState: string,
): void {
  const allowed = transitions[fromState];
  if (!allowed || !allowed.includes(toState)) {
    throw new ValidationError(
      `Invalid ${entityName} state transition from ${fromState} to ${toState}`,
      { entityName, fromState, toState, allowed: allowed ?? [] },
    );
  }
}

export function canTransition(
  transitions: Record<string, readonly string[]>,
  fromState: string,
  toState: string,
): boolean {
  return (transitions[fromState] ?? []).includes(toState);
}
