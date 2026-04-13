import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { EventTypes, LedgerPostedPayload, PaymentCreatedPayload } from 'src/domain/events/event-types';
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
export class LedgerConsumerService {
  private readonly consumerName = 'ledger-consumer';

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

    const result: LedgerPostedPayload = {
      paymentId: event.payload.paymentId,
      entryId: uuidv4(),
      success: true,
    };

    const outputTopic = this.topicResolver.resolve(EventTypes.LedgerPostedV1, event.countryCode);

    await this.eventPublisher.publish(
      outputTopic,
      JSON.stringify({
        eventId: `${event.eventId}.ledger`,
        type: EventTypes.LedgerPostedV1,
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
