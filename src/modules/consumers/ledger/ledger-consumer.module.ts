import { Module } from '@nestjs/common';
import { LedgerConsumerService } from 'src/domain/services/ledger-consumer.service';
import { CoreModule } from 'src/modules/common/core.module';
import { MessagingModule } from 'src/modules/common/messaging.module';
import { PersistenceModule } from 'src/modules/common/persistence.module';

@Module({
  imports: [CoreModule, PersistenceModule, MessagingModule],
  providers: [LedgerConsumerService],
})
export class LedgerConsumerModule {}
