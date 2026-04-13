export const EventTypes = {
  PaymentCreatedV1: 'payment.created.v1',
  FraudAssessedV1: 'fraud.assessed.v1',
  LedgerPostedV1: 'ledger.posted.v1',
  PaymentSettledV1: 'payment.settled.v1',
  PaymentFailedV1: 'payment.failed.v1',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export interface DomainEvent<TPayload> {
  eventId: string;
  type: EventType;
  aggregateId: string;
  occurredAt: string;
  countryCode: string;
  payload: TPayload;
  schemaVersion: 1;
}

export interface PaymentCreatedPayload {
  paymentId: string;
  walletId: string;
  amount: number;
  currency: string;
}

export interface FraudAssessedPayload {
  paymentId: string;
  approved: boolean;
  reason?: string;
}

export interface LedgerPostedPayload {
  paymentId: string;
  entryId: string;
  success: boolean;
  reason?: string;
}

export interface PaymentSettledPayload {
  paymentId: string;
  settledAt: string;
}

export interface PaymentFailedPayload {
  paymentId: string;
  failedAt: string;
  reason: string;
  sourceEventId: string;
}
