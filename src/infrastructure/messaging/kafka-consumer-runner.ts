import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka } from 'kafkajs';
import { ConsumerExecutorService } from 'src/domain/services/consumer-executor.service';

@Injectable()
export class KafkaConsumerRunner {
  private readonly logger = new Logger(KafkaConsumerRunner.name);
  private readonly kafka: Kafka;

  constructor(
    private readonly configService: ConfigService,
    private readonly consumerExecutorService: ConsumerExecutorService,
  ) {
    this.kafka = new Kafka({
      clientId: this.configService.getOrThrow<string>('kafkaClientId'),
      brokers: this.configService.getOrThrow<string[]>('kafkaBrokers'),
    });
  }

  async run(params: {
    consumerName: string;
    topics: string[];
    groupId: string;
    onMessage: (rawEvent: string, sourceTopic: string) => Promise<void>;
  }): Promise<Consumer> {
    const consumer = this.kafka.consumer({ groupId: params.groupId });
    await consumer.connect();
    for (const topic of params.topics) {
      await consumer.subscribe({ topic, fromBeginning: true });
    }

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        const rawEvent = (message.value ?? Buffer.from('')).toString('utf-8');
        if (!rawEvent) {
          return;
        }

        let eventId = 'unknown';
        try {
          const parsed = JSON.parse(rawEvent) as { eventId?: string };
          eventId = parsed.eventId ?? eventId;
        } catch {
          eventId = 'malformed_event';
        }

        await this.consumerExecutorService.executeWithRetry(
          {
            consumerName: params.consumerName,
            sourceTopic: topic,
            eventId,
            payload: rawEvent,
          },
          this.configService.getOrThrow<number>('maxConsumerRetries'),
          () => params.onMessage(rawEvent, topic),
        );
      },
    });

    this.logger.log(
      `Consumer ${params.consumerName} (${params.groupId}) subscribed to topics: ${params.topics.join(', ')}`,
    );
    return consumer;
  }
}
