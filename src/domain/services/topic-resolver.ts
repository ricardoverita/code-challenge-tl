export class TopicResolver {
  constructor(private readonly perCountryNamespaceEnabled = false) {}

  resolve(baseTopic: string, countryCode: string): string {
    if (!this.perCountryNamespaceEnabled) {
      return baseTopic;
    }

    return `${countryCode.toLowerCase()}.payments.${baseTopic}`;
  }
}
