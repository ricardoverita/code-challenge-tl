import { Module } from '@nestjs/common';
import { FraudConsumerService } from 'src/domain/services/fraud-consumer.service';
import { CoreModule } from 'src/modules/common/core.module';
import { MessagingModule } from 'src/modules/common/messaging.module';
import { PersistenceModule } from 'src/modules/common/persistence.module';

@Module({
  imports: [CoreModule, PersistenceModule, MessagingModule],
  providers: [FraudConsumerService],
})
export class FraudConsumerModule {}
