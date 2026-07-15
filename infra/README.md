# Infra

- `k8s/` - raw Kubernetes manifests (namespace, per-service Deployment+Service, ExternalSecret stub)
- `helm/faithfit/` - Helm chart wrapping the same deployments, parameterized via values.yaml
- `terraform/` - AWS stubs: EKS, RDS Postgres (Timescale-enabled), MSK Kafka, ElastiCache Redis
- `gloo-gateway/` - Gloo Gateway VirtualService routing external traffic to internal services
- `monitoring/` - Prometheus scrape config + Grafana dashboard stub
- `smoke-test.sh` - hits /health on every service after deploy

Secrets are never stored in this repo - k8s ExternalSecret pulls from a real vault/secrets manager,
and local dev falls back to `.env` (see root README).
