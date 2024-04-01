import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';


export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC with both Public and Private Subnets
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 2,
      natGateways: 1, 
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'publicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'privateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Security Group for ECS Tasks in Private Subnet
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'ECSSecurityGroup', {
      vpc,
      description: 'Allow internal traffic to ECS Service',
      allowAllOutbound: true,
    });

    // Reference to Existing ECR Repository
    const repository = ecr.Repository.fromRepositoryName(this, 'MyRepository', 'teju-ecr');

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'MyCluster', {
      vpc,
    });

    // Fargate Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'MyTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Add container to the task definition
    const container = taskDefinition.addContainer('MyContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'MyApp' }),
    });
    container.addPortMappings({
      containerPort: 5001, 
      protocol: ecs.Protocol.TCP,
    });

    // Fargate Service in Private Subnet
    const service = new ecs.FargateService(this, 'MyService', {
      cluster,
      taskDefinition,
      securityGroups: [ecsSecurityGroup],
      assignPublicIp: false, // ECS tasks in private subnet do not need public IPs
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // Application Load Balancer in Public Subnet
    const lb = new elbv2.ApplicationLoadBalancer(this, 'MyALB', {
      vpc,
      internetFacing: true,
    });

    // Add listener and forward traffic to Fargate Service
    const listener = lb.addListener('MyListener', {
      port: 80,
    });
    listener.addTargets('MyFargateService', {
      port: 80,
      targets: [service],
    });

    // Output the DNS name of the Load Balancer
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: lb.loadBalancerDnsName,
    });

    // Create an RDS database in the private subnet
    const dbInstance = new rds.DatabaseInstance(this, 'MyDatabase', {
  engine: rds.DatabaseInstanceEngine.postgres({
    version: rds.PostgresEngineVersion.VER_13_13,
  }),
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
  vpc,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
  },
  credentials: rds.Credentials.fromGeneratedSecret('myadmin'), // Creates an admin user with a generated password.
  multiAz: false, 
  allocatedStorage: 20, 
  maxAllocatedStorage: 100, 
  deletionProtection: false, 
  backupRetention: cdk.Duration.days(7), 
});

// Output the RDS instance endpoint
new cdk.CfnOutput(this, 'DatabaseEndpoint', {
  value: dbInstance.dbInstanceEndpointAddress,
});
// Allow ECS Security Group to access RDS Database
dbInstance.connections.allowFrom(ecsSecurityGroup, ec2.Port.tcp(5432), 'Allow inbound from ECS');


  }
}


