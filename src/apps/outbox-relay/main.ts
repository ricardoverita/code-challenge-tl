import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { OutboxRelayService } from 'src/domain/services/outbox-relay.service';
import { OutboxRelayModule } from 'src/modules/outbox/outbox-relay.module';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function bootstrap(): Promise<void> {
  const logger = new Logger('OutboxRelayProcess');
  const app = await NestFactory.createApplicationContext(OutboxRelayModule);
  const config = app.get(ConfigService);
  const relay = app.get(OutboxRelayService);

  const pollMs = config.getOrThrow<number>('relayPollMs');
  logger.log(`Outbox relay started with polling interval ${pollMs}ms`);

  while (true) {
    try {
      await relay.relayBatch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      logger.error(`Outbox relay batch failed: ${message}`, stack);
    }
    await sleep(pollMs);
  }
}

void bootstrap();
