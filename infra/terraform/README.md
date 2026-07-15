# Terraform stubs

Not applied/validated - these are structural stubs matching the architecture in section 1
(Postgres + TimescaleDB, Kafka/MSK event bus, Redis cache, EKS for microservices). Run
`terraform init && terraform validate` and fill in a `terraform.tfvars` before any real apply.
Secrets (DB passwords, API keys) must come from AWS Secrets Manager / Vault, never tfvars.
