terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" { region = var.aws_region }

# EKS cluster stub - verify sizing/version against real capacity planning before applying.
module "eks" {
  source          = "terraform-aws-modules/eks/aws"
  version         = "~> 20.0"
  cluster_name    = "faithfit-${var.environment}"
  cluster_version = "1.29"
  vpc_id          = var.vpc_id
  subnet_ids      = var.subnet_ids
}

# RDS Postgres (with TimescaleDB extension enabled post-provision) for biometric_data + core schema.
resource "aws_db_instance" "postgres" {
  identifier          = "faithfit-${var.environment}-pg"
  engine              = "postgres"
  engine_version      = "16"
  instance_class      = var.db_instance_class
  allocated_storage   = 100
  db_name             = "faithfit"
  username            = "faithfit_admin"
  manage_master_user_password = true
  skip_final_snapshot = var.environment != "production"
}

# MSK (Kafka) for the event bus.
resource "aws_msk_cluster" "kafka" {
  cluster_name           = "faithfit-${var.environment}"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = 3
  broker_node_group_info {
    instance_type   = var.kafka_instance_type
    client_subnets  = var.subnet_ids
    storage_info { ebs_storage_info { volume_size = 100 } }
  }
}

# ElastiCache Redis for caching layer.
resource "aws_elasticache_cluster" "redis" {
  cluster_id      = "faithfit-${var.environment}-redis"
  engine          = "redis"
  node_type       = var.redis_node_type
  num_cache_nodes = 1
}
