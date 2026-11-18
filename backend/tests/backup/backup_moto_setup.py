"""C6-T6 — the local S3-compatible double for the backup tooling (moto server).

Synthetic only. The D-9 design, with one credential per role:
  buckets
    qa-valida-resumes       the API's primary bucket: versioned (C6-T4)
    qa-valida-resume-copy   the copy: object lock, COMPLIANCE default retention
    qa-valida-backup-log    manifests, copy-run records, the deletion log:
                            object lock, COMPLIANCE default retention
    qa-valida-restore-*     restore targets, created per rehearsal (versioned,
                            empty), by the test side
  users (each a scoped policy; the first SETUP_ACTIONS requests are
  unauthenticated, everything after is signature-checked and authorised)
    qa-app             the API's policy on the primary — the C6-T4 actions, unchanged
    qa-backup-copier   primary: read. copy: write NEW objects, read. log: write copy-runs/*
    qa-backup-manifest primary: read. copy: read. log: read; write manifests/*
    qa-backup-log-writer  log: write deletion-log/* (no read of anything else, no delete)
    qa-backup-restorer copy: read. log: read. restore targets: write, read, delete versions
    qa-rehearsal-api   the throwaway API on restored data: the C6-T4 actions on restore targets only
    qa-fixture         TEST SIDE ONLY: everything (creating restore targets, the damage of
                       rehearsal D, independent reads)
Retention is 1 day here (a test double); the design requires at least the
snapshot retention on the real provider (plan §5.2). Whether the provider
enforces it is a hosted check.
"""
import json
import sys

import boto3

endpoint = sys.argv[1]
anon = dict(endpoint_url=endpoint, region_name='us-east-1', aws_access_key_id='qa-setup', aws_secret_access_key='qa-setup-secret')
s3 = boto3.client('s3', **anon)
iam = boto3.client('iam', **anon)
PRIMARY, COPY, LOG = 'qa-valida-resumes', 'qa-valida-resume-copy', 'qa-valida-backup-log'
RESTORE = 'qa-valida-restore-*'
lock = {'ObjectLockEnabled': 'Enabled', 'Rule': {'DefaultRetention': {'Mode': 'COMPLIANCE', 'Days': 1}}}
s3.create_bucket(Bucket=PRIMARY)                                                       # 1
s3.put_bucket_versioning(Bucket=PRIMARY, VersioningConfiguration={'Status': 'Enabled'})  # 2
s3.create_bucket(Bucket=COPY, ObjectLockEnabledForBucket=True)                         # 3
s3.put_object_lock_configuration(Bucket=COPY, ObjectLockConfiguration=lock)            # 4
s3.create_bucket(Bucket=LOG, ObjectLockEnabledForBucket=True)                          # 5
s3.put_object_lock_configuration(Bucket=LOG, ObjectLockConfiguration=lock)             # 6

def obj(b, prefix='*'):
    return f'arn:aws:s3:::{b}/{prefix}'

def bucket(b):
    return f'arn:aws:s3:::{b}'

APP_ACTIONS = ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion', 's3:DeleteObject', 's3:DeleteObjectVersion']
users = {
    'qa-app': [
        {'Effect': 'Allow', 'Action': APP_ACTIONS, 'Resource': [obj(PRIMARY)]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [bucket(PRIMARY)]},
    ],
    'qa-backup-copier': [
        {'Effect': 'Allow', 'Action': ['s3:GetObject', 's3:GetObjectVersion'], 'Resource': [obj(PRIMARY)]},
        {'Effect': 'Allow', 'Action': ['s3:PutObject', 's3:GetObject'], 'Resource': [obj(COPY)]},
        {'Effect': 'Allow', 'Action': ['s3:PutObject'], 'Resource': [obj(LOG, 'copy-runs/*')]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [bucket(PRIMARY), bucket(COPY)]},
    ],
    'qa-backup-manifest': [
        {'Effect': 'Allow', 'Action': ['s3:GetObject'], 'Resource': [obj(PRIMARY), obj(COPY), obj(LOG)]},
        {'Effect': 'Allow', 'Action': ['s3:PutObject'], 'Resource': [obj(LOG, 'manifests/*')]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [bucket(LOG)]},
    ],
    'qa-backup-log-writer': [
        {'Effect': 'Allow', 'Action': ['s3:PutObject'], 'Resource': [obj(LOG, 'deletion-log/*')]},
    ],
    'qa-backup-restorer': [
        {'Effect': 'Allow', 'Action': ['s3:GetObject', 's3:GetObjectVersion'], 'Resource': [obj(COPY), obj(LOG)]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [bucket(COPY), bucket(LOG), bucket(RESTORE)]},
        {'Effect': 'Allow', 'Action': APP_ACTIONS, 'Resource': [obj(RESTORE)]},
    ],
    'qa-rehearsal-api': [
        {'Effect': 'Allow', 'Action': APP_ACTIONS, 'Resource': [obj(RESTORE)]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [bucket(RESTORE)]},
    ],
    # Proposed (MongoDB-native r2): the durable deletion journal (deletionJournal.js), in the locked log bucket.
    'qa-journal-writer': [
        {'Effect': 'Allow', 'Action': ['s3:PutObject', 's3:GetObject'], 'Resource': [obj(LOG, 'deletion-journal/*')]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [bucket(LOG)]},
    ],
    'qa-journal-reader': [
        {'Effect': 'Allow', 'Action': ['s3:GetObject'], 'Resource': [obj(LOG, 'deletion-journal/*')]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [bucket(LOG)]},
    ],
    # Proposed (MongoDB-native r3, D-MN-2): the encrypted recovery copies, in the locked copy bucket.
    'qa-dump-writer': [
        {'Effect': 'Allow', 'Action': ['s3:PutObject', 's3:GetObject'], 'Resource': [obj(COPY, 'encrypted-backups/*')]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [bucket(COPY)]},
    ],
    'qa-dump-reader': [
        {'Effect': 'Allow', 'Action': ['s3:GetObject'], 'Resource': [obj(COPY, 'encrypted-backups/*')]},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': [bucket(COPY)]},
    ],
    'qa-fixture': [
        {'Effect': 'Allow', 'Action': ['s3:*'], 'Resource': ['arn:aws:s3:::*']},
    ],
}
keys = {}
for name, statements in users.items():                                                # 11 users x 3 = 33 (7..39)
    iam.create_user(UserName=name)
    key = iam.create_access_key(UserName=name)['AccessKey']
    iam.put_user_policy(UserName=name, PolicyName=f'{name}-policy', PolicyDocument=json.dumps({'Version': '2012-10-17', 'Statement': statements}))
    keys[name] = {'accessKeyId': key['AccessKeyId'], 'secretAccessKey': key['SecretAccessKey']}
print(json.dumps({'users': keys, 'buckets': {'primary': PRIMARY, 'copy': COPY, 'log': LOG, 'restorePrefix': 'qa-valida-restore-'}}))
