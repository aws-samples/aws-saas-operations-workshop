import { Period, UsagePlan } from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export interface TenantAPIUsagePlansProps {
  plans:
  {
    tier: string;
    requestPerSec: number;
    concurrentRequests: number;
    quota?: {
      period: 'DAY' | 'WEEK' | 'MONTH';
      requests: number;
    };
  }[];

}

const convertToAPIGWPeriod = ((period: 'DAY' | 'WEEK' | 'MONTH') : Period => {
  switch (period) {
    case 'DAY':
      return Period.DAY;
    case 'WEEK':
      return Period.WEEK;
    case 'MONTH':
      return Period.MONTH;
  }
});

export class TenantAPIUsagePlans extends Construct {

  readonly usagePlanIds: {[tier: string]:string} = {};

  constructor(scope: Construct, id: string, props: TenantAPIUsagePlansProps) {
    super(scope, id);

    props.plans.forEach(plan => {
      const usagePlan = new UsagePlan(this, `UsagePlan-${plan.tier}`, {
        name: `UsagePlan-${plan.tier}`,
        throttle: {
          rateLimit: plan.requestPerSec,
          burstLimit: plan.concurrentRequests,
        },
        quota: plan.quota ? {
          limit: plan.quota.requests,
          period: convertToAPIGWPeriod(plan.quota.period),
        } : undefined,
      });
      this.usagePlanIds[plan.tier] = usagePlan.usagePlanId;
    });
  }
}