export const handler = function(event: any, context: any) {
  // Retrieve user attribute from event request
  const userAttributes = event.request.userAttributes;
  // Add scope to event response
  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {},
      accessTokenGeneration: {
        claimsToAddOrOverride: {
          tenantId: userAttributes['custom:tenantId'],
          tier: userAttributes['custom:tier'],
          role: userAttributes['custom:role'],
        },
      },
    },
  };
  // Return to Amazon Cognito
  context.done(null, event);
};