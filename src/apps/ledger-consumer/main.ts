import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { EventTypes } from 'src/domain/events/event-types';
import { LedgerConsumerService } from 'src/domain/services/ledger-consumer.service';
import { TopicResolver } from 'src/domain/services/topic-resolver';
import { KafkaConsumerRunner } from 'src/infrastructure/messaging/kafka-consumer-runner';
import { LedgerConsumerModule } from 'src/modules/consumers/ledger/ledger-consumer.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('LedgerConsumerProcess');
  const app = await NestFactory.createApplicationContext(LedgerConsumerModule);
  const configService = app.get(ConfigService);
  const runner = app.get(KafkaConsumerRunner);
  const service = app.get(LedgerConsumerService);
  const topicResolver = app.get(TopicResolver);
  const supportedCountries = configService.getOrThrow<string[]>('supportedCountries');

  const country = (process.env.CONSUMER_COUNTRY ?? '').toLowerCase();
  if (!country || !supportedCountries.includes(country)) {
    throw new Error(
      `CONSUMER_COUNTRY must be one of [${supportedCountries.join(', ')}] for ledger-consumer process.`,
    );
  }

  const topic = topicResolver.resolve(EventTypes.PaymentCreatedV1, country);
  const groupIdPrefix = configService.getOrThrow<string>('kafkaGroupIdPrefix');
  const groupId = `${groupIdPrefix}.ledger-consumer.${country}`;

  await runner.run({
    consumerName: 'ledger-consumer',
    groupId,
    topics: [topic],
    onMessage: (rawEvent) => service.handlePaymentCreated(rawEvent),
  });

  logger.log(`Ledger consumer is running for country ${country} on topic ${topic}`);
}

void bootstrap();
