import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OUTBOX_REPOSITORY } from 'src/domain/repositories/outbox.repository';
import { PAYMENT_REPOSITORY } from 'src/domain/repositories/payment.repository';
import { PAYMENT_STEP_REPOSITORY } from 'src/domain/repositories/payment-step.repository';
import { PROCESSED_EVENT_REPOSITORY } from 'src/domain/repositories/processed-event.repository';
import { UNIT_OF_WORK } from 'src/domain/repositories/unit-of-work';
import { OutboxEventOrmEntity } from 'src/infrastructure/persistence/entities/outbox-event.orm-entity';
import { PaymentOrmEntity } from 'src/infrastructure/persistence/entities/payment.orm-entity';
import { PaymentStepOrmEntity } from 'src/infrastructure/persistence/entities/payment-step.orm-entity';
import { ProcessedEventOrmEntity } from 'src/infrastructure/persistence/entities/processed-event.orm-entity';
import { TypeOrmOutboxRepository } from 'src/infrastructure/persistence/repositories/outbox.typeorm-repository';
import { TypeOrmPaymentRepository } from 'src/infrastructure/persistence/repositories/payment.typeorm-repository';
import { TypeOrmPaymentStepRepository } from 'src/infrastructure/persistence/repositories/payment-step.typeorm-repository';
import { TypeOrmProcessedEventRepository } from 'src/infrastructure/persistence/repositories/processed-event.typeorm-repository';
import { TransactionContext } from 'src/infrastructure/persistence/transaction-context';
import { TypeOrmUnitOfWork } from 'src/infrastructure/persistence/typeorm-unit-of-work';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('dbHost'),
        port: config.getOrThrow<number>('dbPort'),
        username: config.getOrThrow<string>('dbUser'),
        password: config.getOrThrow<string>('dbPassword'),
        database: config.getOrThrow<string>('dbName'),
        synchronize: true,
        logging: false,
        entities: [PaymentOrmEntity, PaymentStepOrmEntity, OutboxEventOrmEntity, ProcessedEventOrmEntity],
      }),
    }),
  ],
  providers: [
    TransactionContext,
    TypeOrmUnitOfWork,
    TypeOrmPaymentRepository,
    TypeOrmPaymentStepRepository,
    TypeOrmOutboxRepository,
    TypeOrmProcessedEventRepository,
    {
      provide: UNIT_OF_WORK,
      useExisting: TypeOrmUnitOfWork,
    },
    {
      provide: PAYMENT_REPOSITORY,
      useExisting: TypeOrmPaymentRepository,
    },
    {
      provide: PAYMENT_STEP_REPOSITORY,
      useExisting: TypeOrmPaymentStepRepository,
    },
    {
      provide: OUTBOX_REPOSITORY,
      useExisting: TypeOrmOutboxRepository,
    },
    {
      provide: PROCESSED_EVENT_REPOSITORY,
      useExisting: TypeOrmProcessedEventRepository,
    },
  ],
  exports: [
    UNIT_OF_WORK,
    PAYMENT_REPOSITORY,
    PAYMENT_STEP_REPOSITORY,
    OUTBOX_REPOSITORY,
    PROCESSED_EVENT_REPOSITORY,
    TransactionContext,
  ],
})
export class PersistenceModule {}
