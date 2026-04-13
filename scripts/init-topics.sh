#!/usr/bin/env bash
set -euo pipefail

BROKER="${KAFKA_BROKER:-kafka:9092}"
COUNTRIES_RAW="${SUPPORTED_COUNTRIES:-pe,mx}"
PARTITIONS="${TOPIC_PARTITIONS:-3}"
REPLICATION="${TOPIC_REPLICATION_FACTOR:-1}"

BASE_TOPICS=(
  "payment.created.v1"
  "fraud.assessed.v1"
  "ledger.posted.v1"
  "payment.settled.v1"
  "payment.failed.v1"
)

read -r -a COUNTRIES <<< "$(echo "${COUNTRIES_RAW}" | tr ',' ' ')"

echo "Initializing topics on broker ${BROKER} for countries: ${COUNTRIES[*]}"

for country in "${COUNTRIES[@]}"; do
  normalized_country="$(echo "${country}" | tr '[:upper:]' '[:lower:]' | xargs)"

  for base in "${BASE_TOPICS[@]}"; do
    topic="${normalized_country}.payments.${base}"
    dlt_topic="${topic}.dlt"

    /opt/kafka/bin/kafka-topics.sh \
      --bootstrap-server "${BROKER}" \
      --create \
      --if-not-exists \
      --topic "${topic}" \
      --partitions "${PARTITIONS}" \
      --replication-factor "${REPLICATION}"

    /opt/kafka/bin/kafka-topics.sh \
      --bootstrap-server "${BROKER}" \
      --create \
      --if-not-exists \
      --topic "${dlt_topic}" \
      --partitions "${PARTITIONS}" \
      --replication-factor "${REPLICATION}"

    echo "Ensured topics: ${topic} and ${dlt_topic}"
  done
done

echo "Topic initialization complete."
