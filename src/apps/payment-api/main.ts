import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PaymentApiModule } from 'src/modules/payment/payment-api.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(PaymentApiModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('port');

  await app.listen(port);
}

void bootstrap();
