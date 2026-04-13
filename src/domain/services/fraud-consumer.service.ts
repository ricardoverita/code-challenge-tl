import { Inject, Injectable } from '@nestjs/common';
import { EventTypes, FraudAssessedPayload, PaymentCreatedPayload } from 'src/domain/events/event-types';
import { EVENT_PUBLISHER, EventPublisher } from 'src/domain/repositories/ports';
import {
  PROCESSED_EVENT_REPOSITORY,
  ProcessedEventRepository,
} from 'src/domain/repositories/processed-event.repository';
import { TopicResolver } from 'src/domain/services/topic-resolver';

interface PaymentCreatedEvent {
  eventId: string;
  aggregateId: string;
  countryCode: string;
  payload: PaymentCreatedPayload;
}

@Injectable()
export class FraudConsumerService {
  private readonly consumerName = 'fraud-consumer';

  constructor(
    @Inject(PROCESSED_EVENT_REPOSITORY)
    private readonly processedEventRepository: ProcessedEventRepository,
    @Inject(EVENT_PUBLISHER)
    private readonly eventPublisher: EventPublisher,
    private readonly topicResolver: TopicResolver,
  ) {}

  async handlePaymentCreated(rawEvent: string): Promise<void> {
    const event = JSON.parse(rawEvent) as PaymentCreatedEvent;

    const firstTime = await this.processedEventRepository.tryMarkProcessed(
      this.consumerName,
      event.countryCode,
      event.eventId,
    );
    if (!firstTime) {
      return;
    }

    const approved = event.payload.amount <= 1000;
    const result: FraudAssessedPayload = {
      paymentId: event.payload.paymentId,
      approved,
      reason: approved ? undefined : 'risk_threshold_exceeded',
    };

    const outputTopic = this.topicResolver.resolve(EventTypes.FraudAssessedV1, event.countryCode);

    await this.eventPublisher.publish(
      outputTopic,
      JSON.stringify({
        eventId: `${event.eventId}.fraud`,
        type: EventTypes.FraudAssessedV1,
        aggregateId: event.aggregateId,
        occurredAt: new Date().toISOString(),
        countryCode: event.countryCode,
        schemaVersion: 1,
        payload: result,
      }),
      event.aggregateId,
    );
  }
}
