import { OutboxEvent } from 'src/domain/entities/outbox-event';

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');

export interface EnqueueOutboxEventParams {
  id: string;
  aggregateId: string;
  eventId: string;
  eventType: string;
  topic: string;
  countryCode: string;
  payload: string;
}

export interface OutboxRepository {
  enqueue(params: EnqueueOutboxEventParams): Promise<void>;
  lockPendingBatch(limit: number, now: Date): Promise<OutboxEvent[]>;
  markPublished(outboxId: string, publishedAt: Date): Promise<void>;
  markForRetry(outboxId: string, nextAttemptAt: Date): Promise<void>;
}
