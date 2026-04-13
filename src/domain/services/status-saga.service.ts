import { Inject, Injectable } from '@nestjs/common';
import { PaymentStatus } from 'src/domain/entities/payment';
import { StepStatus } from 'src/domain/entities/payment-step';
import {
  EventTypes,
  FraudAssessedPayload,
  LedgerPostedPayload,
  PaymentFailedPayload,
  PaymentSettledPayload,
} from 'src/domain/events/event-types';
import { PAYMENT_REPOSITORY, PaymentRepository } from 'src/domain/repositories/payment.repository';
import { PAYMENT_STEP_REPOSITORY, PaymentStepRepository } from 'src/domain/repositories/payment-step.repository';
import { EVENT_PUBLISHER, EventPublisher } from 'src/domain/repositories/ports';
import {
  PROCESSED_EVENT_REPOSITORY,
  ProcessedEventRepository,
} from 'src/domain/repositories/processed-event.repository';
import { TopicResolver } from 'src/domain/services/topic-resolver';

interface IntegrationEvent<TPayload> {
  eventId: string;
  aggregateId: string;
  countryCode: string;
  payload: TPayload;
}

@Injectable()
export class StatusSagaService {
  private readonly consumerName = 'status-saga';

  constructor(
    @Inject(PROCESSED_EVENT_REPOSITORY)
    private readonly processedEventRepository: ProcessedEventRepository,
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    @Inject(PAYMENT_STEP_REPOSITORY)
    private readonly paymentStepRepository: PaymentStepRepository,
    @Inject(EVENT_PUBLISHER)
    private readonly eventPublisher: EventPublisher,
    private readonly topicResolver: TopicResolver,
  ) {}

  async onFraudAssessed(rawEvent: string): Promise<void> {
    const event = JSON.parse(rawEvent) as IntegrationEvent<FraudAssessedPayload>;

    const firstTime = await this.processedEventRepository.tryMarkProcessed(
      this.consumerName,
      event.countryCode,
      event.eventId,
    );
    if (!firstTime) {
      return;
    }

    await this.paymentStepRepository.markFraud(
      event.payload.paymentId,
      event.payload.approved ? StepStatus.Succeeded : StepStatus.Failed,
      event.payload.reason,
    );

    await this.reconcile(event.aggregateId, event.countryCode, event.eventId);
  }

  async onLedgerPosted(rawEvent: string): Promise<void> {
    const event = JSON.parse(rawEvent) as IntegrationEvent<LedgerPostedPayload>;

    const firstTime = await this.processedEventRepository.tryMarkProcessed(
      this.consumerName,
      event.countryCode,
      event.eventId,
    );
    if (!firstTime) {
      return;
    }

    await this.paymentStepRepository.markLedger(
      event.payload.paymentId,
      event.payload.success ? StepStatus.Succeeded : StepStatus.Failed,
      event.payload.reason,
    );

    await this.reconcile(event.aggregateId, event.countryCode, event.eventId);
  }

  private async reconcile(paymentId: string, countryCode: string, sourceEventId: string): Promise<void> {
    const step = await this.paymentStepRepository.getByPaymentId(paymentId);
    if (!step) {
      return;
    }

    if (step.fraudStatus === StepStatus.Failed || step.ledgerStatus === StepStatus.Failed) {
      await this.paymentRepository.updateStatus(paymentId, PaymentStatus.Failed);

      const payload: PaymentFailedPayload = {
        paymentId,
        failedAt: new Date().toISOString(),
        reason: step.failureReason ?? 'consumer_failure',
        sourceEventId,
      };

      await this.eventPublisher.publish(
        this.topicResolver.resolve(EventTypes.PaymentFailedV1, countryCode),
        JSON.stringify({
          eventId: `${sourceEventId}.payment_failed`,
          type: EventTypes.PaymentFailedV1,
          aggregateId: paymentId,
          occurredAt: new Date().toISOString(),
          countryCode,
          schemaVersion: 1,
          payload,
        }),
        paymentId,
      );
      return;
    }

    if (step.fraudStatus === StepStatus.Succeeded && step.ledgerStatus === StepStatus.Succeeded) {
      await this.paymentRepository.updateStatus(paymentId, PaymentStatus.Settled);

      const payload: PaymentSettledPayload = {
        paymentId,
        settledAt: new Date().toISOString(),
      };

      await this.eventPublisher.publish(
        this.topicResolver.resolve(EventTypes.PaymentSettledV1, countryCode),
        JSON.stringify({
          eventId: `${sourceEventId}.payment_settled`,
          type: EventTypes.PaymentSettledV1,
          aggregateId: paymentId,
          occurredAt: new Date().toISOString(),
          countryCode,
          schemaVersion: 1,
          payload,
        }),
        paymentId,
      );
    }
  }
}
