
#!/bin/bash -e

#source .venv/bin/activate
python3 -m pip install -r requirements.txt
cdk deploy --all
