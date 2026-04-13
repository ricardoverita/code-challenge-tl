import { Module } from '@nestjs/common';
import { StatusSagaService } from 'src/domain/services/status-saga.service';
import { CoreModule } from 'src/modules/common/core.module';
import { MessagingModule } from 'src/modules/common/messaging.module';
import { PersistenceModule } from 'src/modules/common/persistence.module';

@Module({
  imports: [CoreModule, PersistenceModule, MessagingModule],
  providers: [StatusSagaService],
})
export class StatusSagaModule {}
