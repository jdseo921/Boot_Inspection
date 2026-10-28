# Deploying to AWS

This puts the Docker image on **Amazon ECS Express Mode** (Fargate behind an
HTTPS load balancer) with **Amazon RDS for PostgreSQL 16**. Express Mode is
what AWS now recommends in place of App Runner, which no longer takes new
customers. It needs only an image and two IAM roles, and returns an
`https://…ecs.<region>.on.aws` URL.

```
browser ──HTTPS──▶ Application Load Balancer ──▶ Fargate task (this image, :8080)
                     (created by Express Mode)            │
                                                          ▼
                                       RDS PostgreSQL 16 (private, TLS)
```

Everything below uses a recent AWS CLI v2 (one that has
`aws ecs create-express-gateway-service`) and Docker, run from the
repository root. Commands are
written for `bash`; set these first:

```bash
export AWS_REGION=us-east-1                     # any region with ECS Express Mode
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export REPO=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/boot-inspection
```

> **Cost.** The Fargate task, the load balancer, the RDS instance and public
> IPv4 addresses all bill by the hour while they exist. New accounts on the
> AWS Free plan get $100 in credits, plus up to $100 more for trying services
> such as RDS ([AWS, March 2026](https://aws.amazon.com/about-aws/whats-new/2026/03/amazon-aurora-postgresql-aws-free-tier)).
> Step 6 removes everything when the demo is over.

## 1. Push the image to Amazon ECR

```bash
aws ecr create-repository --repository-name boot-inspection
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%/*}"

# On an Apple-silicon Mac, --platform makes an x86-64 image to match Fargate's default.
docker build --platform linux/amd64 -t "$REPO:1" .
docker push "$REPO:1"
```

## 2. Create the database

RDS keeps the master password in AWS Secrets Manager, so it never appears in
a command line or in the app's configuration.

```bash
aws rds create-db-instance \
  --db-instance-identifier boot-inspection \
  --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 --storage-type gp3 \
  --db-name boot_inspection \
  --master-username postgres --manage-master-user-password \
  --no-publicly-accessible \
  --backup-retention-period 1

aws rds wait db-instance-available --db-instance-identifier boot-inspection

export DB_HOST=$(aws rds describe-db-instances --db-instance-identifier boot-inspection \
  --query 'DBInstances[0].Endpoint.Address' --output text)
export DB_SECRET_ARN=$(aws rds describe-db-instances --db-instance-identifier boot-inspection \
  --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)
export DB_SG=$(aws rds describe-db-instances --db-instance-identifier boot-inspection \
  --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text)
```

## 3. Create the two IAM roles

The task execution role pulls the image, writes logs and reads the database
secret. The infrastructure role lets ECS create the load balancer, security
groups and auto scaling for the service.

```bash
aws iam create-role --role-name ecsTaskExecutionRole --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow", "Principal": {"Service": "ecs-tasks.amazonaws.com"}, "Action": "sts:AssumeRole"}]
}'
aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name ecsTaskExecutionRole --policy-name read-db-secret --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{\"Effect\": \"Allow\", \"Action\": \"secretsmanager:GetSecretValue\", \"Resource\": \"$DB_SECRET_ARN\"}]
}"

aws iam create-role --role-name ecsInfrastructureRoleForExpressServices --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [{"Effect": "Allow", "Principal": {"Service": "ecs.amazonaws.com"}, "Action": "sts:AssumeRole"}]
}'
aws iam attach-role-policy --role-name ecsInfrastructureRoleForExpressServices \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices
```

IAM changes take up to a minute to apply. If the next step fails with
"Unable to assume the service linked role", wait and run it again.

## 4. Create the service

The container settings go in a small file, so an update later sends exactly
the same settings with only the image changed.

```bash
container_json() {  # $1 = image tag
  cat > container.json <<JSON
{
  "image": "$REPO:$1",
  "containerPort": 8080,
  "environment": [
    {"name": "SPRING_DATASOURCE_URL", "value": "jdbc:postgresql://$DB_HOST:5432/boot_inspection?sslmode=require"},
    {"name": "SPRING_DATASOURCE_USERNAME", "value": "postgres"},
    {"name": "APP_TIMEZONE", "value": "America/Chicago"}
  ],
  "secrets": [
    {"name": "SPRING_DATASOURCE_PASSWORD", "valueFrom": "$DB_SECRET_ARN:password::"}
  ]
}
JSON
}
container_json 1
```

Half a vCPU and 1 GB is enough for this app: the image sizes the heap to 75%
of the task's memory, and the end-to-end suite in CI runs against the same
image under a 1 GB limit.

```bash
export SERVICE_ARN=$(aws ecs create-express-gateway-service \
  --service-name boot-inspection \
  --execution-role-arn arn:aws:iam::$ACCOUNT_ID:role/ecsTaskExecutionRole \
  --infrastructure-role-arn arn:aws:iam::$ACCOUNT_ID:role/ecsInfrastructureRoleForExpressServices \
  --cpu 512 --memory 1024 \
  --health-check-path /actuator/health/readiness \
  --scaling-target '{"minTaskCount": 1, "maxTaskCount": 2}' \
  --primary-container file://container.json \
  --query 'service.serviceArn' --output text)
```

Express Mode places the service in the default VPC (the same one RDS used
above) and creates a security group for it. Let that group reach the
database, and only that group:

```bash
export APP_SG=$(aws ecs describe-services --cluster default --services boot-inspection \
  --query 'services[0].networkConfiguration.awsvpcConfiguration.securityGroups[0]' --output text)
aws ec2 authorize-security-group-ingress --group-id "$DB_SG" \
  --protocol tcp --port 5432 --source-group "$APP_SG"
aws ecs wait services-stable --cluster default --services boot-inspection
```

If `APP_SG` comes back as `None`, the service is still being set up; wait a
minute and look it up again.

If the first task starts before that rule exists, it cannot reach the
database, fails its health check and is replaced; the next one starts
cleanly. Flyway creates the schema on that first successful start.

The URL is in the service description:

```bash
aws ecs describe-express-gateway-service --service-arn "$SERVICE_ARN" \
  --query 'service.activeConfigurations[0].ingressPaths[0].endpoint' --output text
```

## 5. Load demo data (optional)

The database is private, so the generator on your machine cannot reach it.
For a demo, open it to your own IP address for a few minutes, load, and close
it again:

```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)/32
aws rds modify-db-instance --db-instance-identifier boot-inspection --publicly-accessible --apply-immediately
aws ec2 authorize-security-group-ingress --group-id "$DB_SG" --protocol tcp --port 5432 --cidr "$MY_IP"
aws rds wait db-instance-available --db-instance-identifier boot-inspection

DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id "$DB_SECRET_ARN" \
  --query SecretString --output text | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])')
npm ci --prefix tools/generator
DATABASE_URL="postgres://postgres:$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$DB_PASSWORD")@$DB_HOST:5432/boot_inspection?sslmode=no-verify" \
  npm run generate --prefix tools/generator -- --boards 300000 --days 30

aws ec2 revoke-security-group-ingress --group-id "$DB_SG" --protocol tcp --port 5432 --cidr "$MY_IP"
aws rds modify-db-instance --db-instance-identifier boot-inspection --no-publicly-accessible --apply-immediately
```

## 6. Remove everything

```bash
aws ecs delete-express-gateway-service --service-arn "$SERVICE_ARN"
aws rds delete-db-instance --db-instance-identifier boot-inspection --skip-final-snapshot --delete-automated-backups
aws ecr delete-repository --repository-name boot-inspection --force
```

The IAM roles cost nothing and can stay for next time.

## Updating

Build and push a new tag, then send the same container settings with the
new image:

```bash
docker build --platform linux/amd64 -t "$REPO:2" . && docker push "$REPO:2"
container_json 2
aws ecs update-express-gateway-service --service-arn "$SERVICE_ARN" --primary-container file://container.json
```

Express Mode rolls the new task out as a canary and keeps the old one until
the new one passes its health check.

## References

- [App Runner availability change](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html) (Express Mode as the replacement)
- [Create your first Express Mode service with the AWS CLI](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-getting-started.html)
- [`create-express-gateway-service` reference](https://docs.aws.amazon.com/cli/latest/reference/ecs/create-express-gateway-service.html)
- [Resources created by Express Mode services](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html)
