variable "environment" {
  type = string
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "kafka_instance_type" {
  type    = string
  default = "kafka.t3.small"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}
