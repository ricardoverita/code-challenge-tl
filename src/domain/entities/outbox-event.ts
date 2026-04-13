export enum OutboxStatus {
  Pending = 'pending',
  Processing = 'processing',
  Published = 'published',
  Failed = 'failed',
}

export interface OutboxEvent {
  id: string;
  aggregateId: string;
  eventId: string;
  eventType: string;
  topic: string;
  countryCode: string;
  payload: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
