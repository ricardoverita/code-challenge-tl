import { Module } from '@nestjs/common';
import { EVENT_PUBLISHER, DLT_PUBLISHER } from 'src/domain/repositories/ports';
import { ConsumerExecutorService } from 'src/domain/services/consumer-executor.service';
import { KafkaConsumerRunner } from 'src/infrastructure/messaging/kafka-consumer-runner';
import { KafkaPublisher } from 'src/infrastructure/messaging/kafka-publisher';

@Module({
  providers: [
    ConsumerExecutorService,
    KafkaPublisher,
    KafkaConsumerRunner,
    {
      provide: EVENT_PUBLISHER,
      useExisting: KafkaPublisher,
    },
    {
      provide: DLT_PUBLISHER,
      useExisting: KafkaPublisher,
    },
  ],
  exports: [
    ConsumerExecutorService,
    KafkaPublisher,
    KafkaConsumerRunner,
    EVENT_PUBLISHER,
    DLT_PUBLISHER,
  ],
})
export class MessagingModule {}
