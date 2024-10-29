#!/bin/bash

EVENT_BUS='SaaSOpsV2-EventBus'
EVENT_SOURCE='SAAS_CONTROL_PLANE'

# USER_WEIGHTINGS=(NUM_SMALL_USERS NUM_MEDIUM_USERS NUM_LARGE_USERS)
USER_WEIGHTINGS=( 2 8 20 )
# BASIC_TENANTS=(NUM_SMALL_TENANTS NUM_MEDIUM_TENANTS NUM_BASIC_TENANTS)
BASIC_TENANTS=( 5 2 1 )
# PREMIUM_TENANTS=(NUM_SMALL_TENANTS NUM_MEDIUM_TENANTS NUM_BASIC_TENANTS)
PREMIUM_TENANTS=( 1 1 1 )

load_test() {
    local tier=$1
    shift
    local tenants=("$@")
    local detail_type='LOAD_TESTING_REQUEST'
    local count=2
    for index in ${!tenants[@]}; do
        local num_tenants=${tenants[index]}
        local num_users=${USER_WEIGHTINGS[index]}
        for i in $( eval echo {1..$num_tenants} ); do
            aws events put-events --entries '{"EventBusName":"'$EVENT_BUS'","Source":"'$EVENT_SOURCE'","DetailType":"'$detail_type'","Detail":"{\"tier\":\"'$tier'\",\"count\":\"'$count'\",\"maxVUsers\":\"'$num_users'\"}"}'
        done
    done
}

load_test BASIC ${BASIC_TENANTS[@]}
load_test PREMIUM ${PREMIUM_TENANTS[@]}
