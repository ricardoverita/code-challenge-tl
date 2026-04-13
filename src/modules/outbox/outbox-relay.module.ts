import { Module } from '@nestjs/common';
import { OutboxRelayService } from 'src/domain/services/outbox-relay.service';
import { CoreModule } from 'src/modules/common/core.module';
import { MessagingModule } from 'src/modules/common/messaging.module';
import { PersistenceModule } from 'src/modules/common/persistence.module';

@Module({
  imports: [CoreModule, PersistenceModule, MessagingModule],
  providers: [OutboxRelayService],
  exports: [OutboxRelayService],
})
export class OutboxRelayModule {}
