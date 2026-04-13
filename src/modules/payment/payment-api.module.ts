import { Module } from '@nestjs/common';
import { PaymentService } from 'src/domain/services/payment.service';
import { CoreModule } from 'src/modules/common/core.module';
import { PersistenceModule } from 'src/modules/common/persistence.module';
import { PaymentController } from 'src/modules/payment/payment.controller';
import { PaymentStatusQuery } from 'src/modules/payment/payment-status.query';

@Module({
  imports: [CoreModule, PersistenceModule],
  controllers: [PaymentController],
  providers: [PaymentService, PaymentStatusQuery],
})
export class PaymentApiModule {}
