# README

To deploy workshop (SaaS control plane + basic cell):

`./deploy_workshop.sh`

To run a simulation load. Onboards various tenants, and runs a load test for each.

`./init_initialize.sh`

To onboard a tenant:

`./test_onboarding.sh` for random basic tenant or `./test_onboarding.sh -n 'TENANT_NAME' -t 'TIER'` where TIER=BASIC|PREMIUM. Optional `-l 'Yes'` to also run a load test for the tenant.

To offboard a tenant:

`./test_offboarding.sh TENANT_ID`

To test a tenant:

`./test_tenant.sh -i 'TENANT_ID'` or run it without arguments to get a tenant list.

To delete the entire workshop:

`./delete_workshop.sh`
