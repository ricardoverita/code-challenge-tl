import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { EventTypes } from 'src/domain/events/event-types';
import { StatusSagaService } from 'src/domain/services/status-saga.service';
import { TopicResolver } from 'src/domain/services/topic-resolver';
import { KafkaConsumerRunner } from 'src/infrastructure/messaging/kafka-consumer-runner';
import { StatusSagaModule } from 'src/modules/status-saga/status-saga.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('StatusSagaProcess');
  const app = await NestFactory.createApplicationContext(StatusSagaModule);
  const configService = app.get(ConfigService);
  const runner = app.get(KafkaConsumerRunner);
  const service = app.get(StatusSagaService);
  const topicResolver = app.get(TopicResolver);
  const supportedCountries = configService.getOrThrow<string[]>('supportedCountries');

  const country = (process.env.CONSUMER_COUNTRY ?? '').toLowerCase();
  if (!country || !supportedCountries.includes(country)) {
    throw new Error(`CONSUMER_COUNTRY must be one of [${supportedCountries.join(', ')}] for status-saga process.`);
  }

  const fraudTopic = topicResolver.resolve(EventTypes.FraudAssessedV1, country);
  const ledgerTopic = topicResolver.resolve(EventTypes.LedgerPostedV1, country);
  const groupIdPrefix = configService.getOrThrow<string>('kafkaGroupIdPrefix');
  const groupId = `${groupIdPrefix}.status-saga.${country}`;

  await runner.run({
    consumerName: 'status-saga',
    groupId,
    topics: [fraudTopic, ledgerTopic],
    onMessage: (rawEvent, sourceTopic) => {
      if (sourceTopic === fraudTopic) {
        return service.onFraudAssessed(rawEvent);
      }

      return service.onLedgerPosted(rawEvent);
    },
  });

  logger.log(`Status saga is running for country ${country} on topics ${fraudTopic} and ${ledgerTopic}`);
}

void bootstrap();
