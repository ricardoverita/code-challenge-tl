export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
export const DLT_PUBLISHER = Symbol('DLT_PUBLISHER');

export interface EventPublisher {
  publish(topic: string, payload: string, key?: string): Promise<void>;
}

export interface DeadLetterPublisher {
  publishDeadLetter(
    originalTopic: string,
    payload: string,
    reason: string,
    sourceEventId: string,
  ): Promise<void>;
}
