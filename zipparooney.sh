#!/bin/bash

FILE='workshop.zip'

test -f $FILE && rm $FILE

/usr/bin/zip -r $FILE . -x '.git/*' 'cdk.out/*' 'coverage/*' 'node_modules/*' 'own-account/*' 'ash/*'
