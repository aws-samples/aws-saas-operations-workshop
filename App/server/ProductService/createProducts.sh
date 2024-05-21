#!/bin/bash


tenantId=$(aws dynamodb scan --table-name "SaaSOperations-TenantDetails" \
--filter-expression "tenantName = :name" \
--expression-attribute-values '{":name":{"S":"SilodTenant1"}}' | jq .Items[0].tenantId.S)

echo $tenantId

template=$(<ProductDataTemplate.json)
update_list=()

for loop in {1..200}
    do
        update_list=()
        for index in {1..25}
        do
            shardid="$tenantId-$(( ( RANDOM % 10 )  + 1 ))"
            shardid=$(echo $shardid | sed 's/"//g')
            
            echo $shardid
            
            node=$(echo "$template" | jq '.["Product-pooled"][0]' | sed -e "s/SHARDID/$shardid/g" -e "s/PRODUCTID/$(uuidgen)/g")
            update_list+=("$node")
        done
    echo $update_list
    echo "${update_list[@]}" |
    jq -s '{"Product-pooled": .}' > ProductData.json
    
    aws dynamodb batch-write-item --request-items file://ProductData.json
done