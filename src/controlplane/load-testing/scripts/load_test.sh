#!/bin/bash
# Input:
#   LT_COUNT : Number of users to create
#   LT_DURATION : Duration, in seconds, per phase. We have 5 phases.

export SHARED_PASSWORD='Stopthatthats51llY!'
export USERS='./users.csv'
if [[ -z $LT_COUNT ]]
then
    LT_COUNT=5
fi
if [[ -z $LT_DURATION ]]
then
    LT_DURATION=10
fi

rm $USERS
for i in $(seq 1 $LT_COUNT)
do
    echo "${TENANT_ID}-$i,${SHARED_PASSWORD}" >> $USERS
done

echo ""
echo "Creating users"
echo ""
while IFS=, read -r username password
do
    curl -X POST \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        --data '{ "username":"'${username}'","role":"USER" }' \
        ${URL}users
done < $USERS

if ! command -v artillery
then
    echo ""
    echo "Artillery could not be found"
    echo ""
    echo "Installing Artillery"
    echo ""
    npm install -g --quiet artillery@latest
    npm install -g --quiet artillery-plugin-publish-metrics@latest
fi

artillery run load_test.yaml

echo ""
echo "Deleting users"
echo ""
while IFS=, read -r username password
do
    curl -X DELETE \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        ${URL}users/${username}
done < $USERS
