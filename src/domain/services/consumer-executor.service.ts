import { Inject, Injectable, Logger } from '@nestjs/common';
import { DLT_PUBLISHER, DeadLetterPublisher } from 'src/domain/repositories/ports';

export interface ConsumerExecutionContext {
  consumerName: string;
  sourceTopic: string;
  eventId: string;
  payload: string;
}

@Injectable()
export class ConsumerExecutorService {
  private readonly logger = new Logger(ConsumerExecutorService.name);

  constructor(
    @Inject(DLT_PUBLISHER)
    private readonly deadLetterPublisher: DeadLetterPublisher,
  ) {}

  async executeWithRetry(
    context: ConsumerExecutionContext,
    maxRetries: number,
    operation: () => Promise<void>,
  ): Promise<void> {
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        await operation();
        return;
      } catch (error) {
        attempt += 1;

        if (attempt >= maxRetries) {
          const reason = error instanceof Error ? error.message : 'unknown_error';

          await this.deadLetterPublisher.publishDeadLetter(
            context.sourceTopic,
            context.payload,
            reason,
            context.eventId,
          );

          this.logger.error(
            `Consumer ${context.consumerName} exhausted retries for ${context.eventId}. Sent to DLT.`,
          );
          return;
        }
      }
    }
  }
}
