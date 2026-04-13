import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreatePaymentCommand, PaymentService } from 'src/domain/services/payment.service';
import { CreatePaymentDto } from 'src/modules/payment/dto/create-payment.dto';
import { PaymentStatusQuery } from 'src/modules/payment/payment-status.query';

@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly paymentStatusQuery: PaymentStatusQuery,
  ) {}

  @Post()
  async createPayment(@Body() dto: CreatePaymentDto): Promise<{ paymentId: string; status: string }> {
    const command: CreatePaymentCommand = {
      walletId: dto.walletId,
      countryCode: dto.countryCode,
      amount: dto.amount,
      currency: dto.currency,
    };

    return this.paymentService.createPayment(command);
  }

  @Get(':paymentId/status')
  async getStatus(@Param('paymentId') paymentId: string): Promise<{
    paymentId: string;
    status: string;
    fraudStep: string;
    ledgerStep: string;
    consistency: 'eventual';
    note: string;
    lastUpdatedAt: string;
  }> {
    return this.paymentStatusQuery.getStatus(paymentId);
  }
}
