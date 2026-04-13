import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { EventTypes } from 'src/domain/events/event-types';
import { FraudConsumerService } from 'src/domain/services/fraud-consumer.service';
import { TopicResolver } from 'src/domain/services/topic-resolver';
import { KafkaConsumerRunner } from 'src/infrastructure/messaging/kafka-consumer-runner';
import { FraudConsumerModule } from 'src/modules/consumers/fraud/fraud-consumer.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('FraudConsumerProcess');
  const app = await NestFactory.createApplicationContext(FraudConsumerModule);
  const configService = app.get(ConfigService);
  const runner = app.get(KafkaConsumerRunner);
  const service = app.get(FraudConsumerService);
  const topicResolver = app.get(TopicResolver);

  const countries = configService.getOrThrow<string[]>('supportedCountries');
  const topics = Array.from(
    new Set(countries.map((country) => topicResolver.resolve(EventTypes.PaymentCreatedV1, country))),
  );
  const groupIdPrefix = configService.getOrThrow<string>('kafkaGroupIdPrefix');
  const groupId = `${groupIdPrefix}.fraud-consumer.global`;

  await runner.run({
    consumerName: 'fraud-consumer',
    groupId,
    topics,
    onMessage: (rawEvent) => service.handlePaymentCreated(rawEvent),
  });

  logger.log(`Fraud consumer (global) is running for countries: ${countries.join(', ')}`);
}

void bootstrap();
