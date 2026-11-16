"""C6-T4 — sets up the local S3-compatible test double (moto server).

Synthetic only. Creates, through the double's own APIs:
  - the private bucket `qa-valida-resumes` and a second bucket `qa-valida-other`;
  - `qa-app`: a user whose policy allows only the object operations the
    backend needs (PutObject, GetObject, DeleteObject, ListBucket) on the
    private bucket — the shape of a scoped production token (Doc 13 s101);
  - `qa-denied`: a user with no permission at all.
Prints one JSON line with the synthetic credentials for the test run.
The first SETUP_ACTIONS requests are unauthenticated (moto's
INITIAL_NO_AUTH_ACTION_COUNT); every request after them is signature-checked
and authorised.
"""
import json
import sys

import boto3

endpoint = sys.argv[1]
anon = dict(endpoint_url=endpoint, region_name='us-east-1', aws_access_key_id='qa-setup', aws_secret_access_key='qa-setup-secret')
s3 = boto3.client('s3', **anon)
iam = boto3.client('iam', **anon)
s3.create_bucket(Bucket='qa-valida-resumes')                                  # 1
s3.create_bucket(Bucket='qa-valida-other')                                    # 2
iam.create_user(UserName='qa-app')                                            # 3
app = iam.create_access_key(UserName='qa-app')['AccessKey']                   # 4
policy = {
    'Version': '2012-10-17',
    'Statement': [
        {'Effect': 'Allow', 'Action': ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'], 'Resource': 'arn:aws:s3:::qa-valida-resumes/*'},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': 'arn:aws:s3:::qa-valida-resumes'},
    ],
}
iam.put_user_policy(UserName='qa-app', PolicyName='qa-app-resumes', PolicyDocument=json.dumps(policy))  # 5
iam.create_user(UserName='qa-denied')                                         # 6
denied = iam.create_access_key(UserName='qa-denied')['AccessKey']             # 7
print(json.dumps({
    'app': {'accessKeyId': app['AccessKeyId'], 'secretAccessKey': app['SecretAccessKey']},
    'denied': {'accessKeyId': denied['AccessKeyId'], 'secretAccessKey': denied['SecretAccessKey']},
    'bucket': 'qa-valida-resumes',
    'otherBucket': 'qa-valida-other',
}))
