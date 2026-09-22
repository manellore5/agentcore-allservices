#!/bin/bash
# usage: spans.sh <filter-expression>   polls aws/spans until rows appear (max ~4 min)
FILTER="$1"
for attempt in $(seq 1 12); do
  Q=$(aws logs start-query --log-group-name aws/spans --start-time $(( $(date +%s) - 3600 )) --end-time $(date +%s) \
    --query-string "fields name, attributes.session.id as sid, attributes.gen_ai.operation.name as op, attributes.gen_ai.system as sys, resource.attributes.service.name as svc, resource.attributes.cloud.resource_id as rid | filter $FILTER | sort startTimeUnixNano asc | limit 50" \
    --query queryId --output text)
  until [ "$(aws logs get-query-results --query-id $Q --query status --output text)" = "Complete" ]; do sleep 2; done
  N=$(aws logs get-query-results --query-id $Q --query 'length(results)')
  if [ "$N" != "0" ]; then
    aws logs get-query-results --query-id $Q --output json | python3 -c "
import json,sys
for r in json.load(sys.stdin)['results']:
    d={f['field']:f['value'] for f in r if f['field']!='@ptr'}; print(d)"
    exit 0
  fi
  sleep 20
done
echo "no spans found"
