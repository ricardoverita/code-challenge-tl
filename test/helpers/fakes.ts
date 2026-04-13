import { Payment, PaymentStatus } from 'src/domain/entities/payment';
import { OutboxEvent, OutboxStatus } from 'src/domain/entities/outbox-event';
import { PaymentStep, StepStatus } from 'src/domain/entities/payment-step';
import { EnqueueOutboxEventParams, OutboxRepository } from 'src/domain/repositories/outbox.repository';
import { CreatePaymentParams, PaymentRepository } from 'src/domain/repositories/payment.repository';
import { PaymentStepRepository } from 'src/domain/repositories/payment-step.repository';
import { ProcessedEventRepository } from 'src/domain/repositories/processed-event.repository';
import { DeadLetterPublisher, EventPublisher } from 'src/domain/repositories/ports';
import { UnitOfWork } from 'src/domain/repositories/unit-of-work';

export class FakePaymentRepository implements PaymentRepository {
  public readonly items = new Map<string, Payment>();

  async createPending(params: CreatePaymentParams): Promise<Payment> {
    const now = new Date();
    const payment: Payment = {
      id: params.id,
      walletId: params.walletId,
      countryCode: params.countryCode,
      amount: params.amount,
      currency: params.currency,
      status: PaymentStatus.Pending,
      createdAt: now,
      updatedAt: now,
    };

    this.items.set(params.id, payment);
    return payment;
  }

  async updateStatus(paymentId: string, status: PaymentStatus): Promise<void> {
    const payment = this.items.get(paymentId);
    if (!payment) {
      return;
    }

    payment.status = status;
    payment.updatedAt = new Date();
    this.items.set(paymentId, payment);
  }

  async getById(paymentId: string): Promise<Payment | null> {
    return this.items.get(paymentId) ?? null;
  }
}

export class FakePaymentStepRepository implements PaymentStepRepository {
  public readonly items = new Map<string, PaymentStep>();

  async init(paymentId: string): Promise<void> {
    this.items.set(paymentId, {
      paymentId,
      fraudStatus: StepStatus.Pending,
      ledgerStatus: StepStatus.Pending,
      failureReason: null,
      updatedAt: new Date(),
    });
  }

  async markFraud(paymentId: string, status: StepStatus, reason?: string): Promise<void> {
    const step = this.items.get(paymentId);
    if (!step) {
      return;
    }

    step.fraudStatus = status;
    step.failureReason = status === StepStatus.Failed ? reason ?? 'fraud_failed' : null;
    step.updatedAt = new Date();
    this.items.set(paymentId, step);
  }

  async markLedger(paymentId: string, status: StepStatus, reason?: string): Promise<void> {
    const step = this.items.get(paymentId);
    if (!step) {
      return;
    }

    step.ledgerStatus = status;
    step.failureReason = status === StepStatus.Failed ? reason ?? 'ledger_failed' : step.failureReason;
    step.updatedAt = new Date();
    this.items.set(paymentId, step);
  }

  async getByPaymentId(paymentId: string): Promise<PaymentStep | null> {
    return this.items.get(paymentId) ?? null;
  }
}

export class FakeOutboxRepository implements OutboxRepository {
  public readonly items = new Map<string, OutboxEvent>();
  public failEnqueue = false;

  async enqueue(params: EnqueueOutboxEventParams): Promise<void> {
    if (this.failEnqueue) {
      throw new Error('outbox_enqueue_failed');
    }

    const now = new Date();
    this.items.set(params.id, {
      id: params.id,
      aggregateId: params.aggregateId,
      eventId: params.eventId,
      eventType: params.eventType,
      topic: params.topic,
      countryCode: params.countryCode,
      payload: params.payload,
      status: OutboxStatus.Pending,
      attempts: 0,
      nextAttemptAt: now,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async lockPendingBatch(limit: number, now: Date): Promise<OutboxEvent[]> {
    return Array.from(this.items.values())
      .filter((item) => item.status === OutboxStatus.Pending && item.nextAttemptAt <= now)
      .slice(0, limit);
  }

  async markPublished(outboxId: string, publishedAt: Date): Promise<void> {
    const event = this.items.get(outboxId);
    if (!event) {
      return;
    }

    event.status = OutboxStatus.Published;
    event.publishedAt = publishedAt;
    event.attempts += 1;
    this.items.set(outboxId, event);
  }

  async markForRetry(outboxId: string, nextAttemptAt: Date): Promise<void> {
    const event = this.items.get(outboxId);
    if (!event) {
      return;
    }

    event.status = OutboxStatus.Pending;
    event.nextAttemptAt = nextAttemptAt;
    event.attempts += 1;
    this.items.set(outboxId, event);
  }
}

export class FakeProcessedEventRepository implements ProcessedEventRepository {
  private readonly keys = new Set<string>();

  async tryMarkProcessed(consumerName: string, countryCode: string, eventId: string): Promise<boolean> {
    const key = `${consumerName}:${countryCode.toLowerCase()}:${eventId}`;
    if (this.keys.has(key)) {
      return false;
    }

    this.keys.add(key);
    return true;
  }
}

export class FakeUnitOfWork implements UnitOfWork {
  constructor(
    private readonly paymentRepository: FakePaymentRepository,
    private readonly paymentStepRepository: FakePaymentStepRepository,
    private readonly outboxRepository: FakeOutboxRepository,
  ) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    const paymentSnapshot = new Map(this.paymentRepository.items);
    const stepSnapshot = new Map(this.paymentStepRepository.items);
    const outboxSnapshot = new Map(this.outboxRepository.items);

    try {
      return await work();
    } catch (error) {
      this.paymentRepository.items.clear();
      this.paymentStepRepository.items.clear();
      this.outboxRepository.items.clear();

      for (const [key, value] of paymentSnapshot) {
        this.paymentRepository.items.set(key, value);
      }

      for (const [key, value] of stepSnapshot) {
        this.paymentStepRepository.items.set(key, value);
      }

      for (const [key, value] of outboxSnapshot) {
        this.outboxRepository.items.set(key, value);
      }

      throw error;
    }
  }
}

export class FakeEventPublisher implements EventPublisher {
  public readonly published: Array<{ topic: string; payload: string; key?: string }> = [];

  async publish(topic: string, payload: string, key?: string): Promise<void> {
    this.published.push({ topic, payload, key });
  }
}

export class FakeDeadLetterPublisher implements DeadLetterPublisher {
  public readonly dlt: Array<{
    originalTopic: string;
    payload: string;
    reason: string;
    sourceEventId: string;
  }> = [];

  async publishDeadLetter(
    originalTopic: string,
    payload: string,
    reason: string,
    sourceEventId: string,
  ): Promise<void> {
    this.dlt.push({ originalTopic, payload, reason, sourceEventId });
  }
}
