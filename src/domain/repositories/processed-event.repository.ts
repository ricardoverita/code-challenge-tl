export const PROCESSED_EVENT_REPOSITORY = Symbol('PROCESSED_EVENT_REPOSITORY');

export interface ProcessedEventRepository {
  tryMarkProcessed(consumerName: string, countryCode: string, eventId: string): Promise<boolean>;
}
