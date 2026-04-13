import { Inject, Injectable, Logger } from '@nestjs/common';
import { OUTBOX_REPOSITORY, OutboxRepository } from 'src/domain/repositories/outbox.repository';
import { EVENT_PUBLISHER, EventPublisher } from 'src/domain/repositories/ports';

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  constructor(
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
    @Inject(EVENT_PUBLISHER)
    private readonly eventPublisher: EventPublisher,
  ) {}

  async relayBatch(batchSize = 50): Promise<number> {
    const pending = await this.outboxRepository.lockPendingBatch(batchSize, new Date());

    for (const event of pending) {
      try {
        await this.eventPublisher.publish(event.topic, event.payload, event.aggregateId);
        await this.outboxRepository.markPublished(event.id, new Date());
      } catch (error) {
        const retryAt = new Date(Date.now() + Math.min((event.attempts + 1) * 1000, 30000));
        await this.outboxRepository.markForRetry(event.id, retryAt);
        this.logger.warn(
          `Failed to publish outbox event ${event.id}. It will be retried at ${retryAt.toISOString()}.`,
        );
      }
    }

    return pending.length;
  }
}
