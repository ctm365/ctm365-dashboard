# Schedules (EventBridge, us-west-2)

| Rule | Schedule | Target |
|---|---|---|
| `ctm365-hvac-health-90min` | `rate(90 minutes)` | Lambda `ctm365-hvac-health` (all HVAC units) |

Each run analyses today for every unit, and yesterday only on the first run after
local midnight. It reads recent history only (about 20 days, or all days since
learning started while a unit is still learning), so cost stays flat over time.
Roughly $0.03-0.05 per unit per month.

Created with:

    aws events put-rule --name ctm365-hvac-health-90min --schedule-expression "rate(90 minutes)" --state ENABLED
    aws lambda add-permission --function-name ctm365-hvac-health --statement-id events-90min --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:us-west-2:593989447113:rule/ctm365-hvac-health-90min
    aws events put-targets --rule ctm365-hvac-health-90min --targets Id=hvac-health,Arn=arn:aws:lambda:us-west-2:593989447113:function:ctm365-hvac-health
