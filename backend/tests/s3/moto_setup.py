"""C6-T4 — sets up the local S3-compatible test double (moto server).

Synthetic only. Creates, through the double's own APIs:
  - the private bucket `qa-valida-resumes`, with VERSIONING ENABLED (C6-T4
    correction 2: the driver binds every deletion to the exact object
    version it observed, and refuses to start without that capability);
  - `qa-valida-unversioned`: the same access, versioning never enabled — the
    store that cannot bind a deletion (start-up must refuse it);
  - a second bucket `qa-valida-other` the app may not use;
  - `qa-app`: a user whose policy allows only the object operations the
    backend needs (PutObject, GetObject, GetObjectVersion, DeleteObject,
    DeleteObjectVersion, ListBucket) on the two résumé buckets — the shape of
    a scoped production token (Doc 13 s101);
  - `qa-denied`: a user with no permission at all;
  - `qa-fixture`: TEST-SIDE ONLY (emptying buckets of every version, placing
    synthetic replacements); never given to the backend.
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
s3.put_bucket_versioning(Bucket='qa-valida-resumes', VersioningConfiguration={'Status': 'Enabled'})  # 2
s3.create_bucket(Bucket='qa-valida-unversioned')                              # 3
s3.create_bucket(Bucket='qa-valida-other')                                    # 4
iam.create_user(UserName='qa-app')                                            # 5
app = iam.create_access_key(UserName='qa-app')['AccessKey']                   # 6
buckets = ['qa-valida-resumes', 'qa-valida-unversioned']
policy = {
    'Version': '2012-10-17',
    'Statement': [
        {'Effect': 'Allow', 'Action': ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion', 's3:DeleteObject', 's3:DeleteObjectVersion'], 'Resource': [f'arn:aws:s3:::{b}/*' for b in buckets]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [f'arn:aws:s3:::{b}' for b in buckets]},
    ],
}
iam.put_user_policy(UserName='qa-app', PolicyName='qa-app-resumes', PolicyDocument=json.dumps(policy))  # 7
iam.create_user(UserName='qa-denied')                                         # 8
denied = iam.create_access_key(UserName='qa-denied')['AccessKey']             # 9
iam.create_user(UserName='qa-fixture')                                        # 10
fixture = iam.create_access_key(UserName='qa-fixture')['AccessKey']           # 11
fixture_policy = {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Action': ['s3:*'], 'Resource': [f'arn:aws:s3:::{b}' for b in buckets] + [f'arn:aws:s3:::{b}/*' for b in buckets]}]}
iam.put_user_policy(UserName='qa-fixture', PolicyName='qa-fixture-all', PolicyDocument=json.dumps(fixture_policy))  # 12
print(json.dumps({
    'app': {'accessKeyId': app['AccessKeyId'], 'secretAccessKey': app['SecretAccessKey']},
    'denied': {'accessKeyId': denied['AccessKeyId'], 'secretAccessKey': denied['SecretAccessKey']},
    'fixture': {'accessKeyId': fixture['AccessKeyId'], 'secretAccessKey': fixture['SecretAccessKey']},
    'bucket': 'qa-valida-resumes',
    'unversionedBucket': 'qa-valida-unversioned',
    'otherBucket': 'qa-valida-other',
}))
