import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { DeadLetterPublisher, EventPublisher } from 'src/domain/repositories/ports';

@Injectable()
export class KafkaPublisher implements EventPublisher, DeadLetterPublisher, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaPublisher.name);
  private producer!: Producer;
  private kafka!: Kafka;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.kafka = new Kafka({
      clientId: this.configService.getOrThrow<string>('kafkaClientId'),
      brokers: this.configService.getOrThrow<string[]>('kafkaBrokers'),
    });

    this.producer = this.kafka.producer();
    await this.producer.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
    }
  }

  async publish(topic: string, payload: string, key?: string): Promise<void> {
    await this.producer.send({
      topic,
      messages: [
        {
          key,
          value: payload,
        },
      ],
    });
  }

  async publishDeadLetter(
    originalTopic: string,
    payload: string,
    reason: string,
    sourceEventId: string,
  ): Promise<void> {
    const dltTopic = `${originalTopic}.dlt`;
    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(payload);
    } catch {
      parsedPayload = { rawPayload: payload };
    }

    await this.producer.send({
      topic: dltTopic,
      messages: [
        {
          key: sourceEventId,
          value: JSON.stringify({
            sourceTopic: originalTopic,
            sourceEventId,
            reason,
            payload: parsedPayload,
            occurredAt: new Date().toISOString(),
          }),
        },
      ],
    });

    this.logger.warn(`Message ${sourceEventId} moved to DLT ${dltTopic} because: ${reason}`);
  }
}
