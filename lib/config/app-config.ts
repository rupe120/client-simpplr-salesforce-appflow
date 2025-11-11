export const appConfig: AppConfig = {
  name: 'simpplr-salesforce-appflow',
  version: '0.1.0',

  pipeline: {
    account: '971764590821',
    region: 'us-east-1',
    repositoryName: 'simpplr-salesforce-appflow',
    repositoryOwner: 'protagona',
    branch: 'main',
    connectionArn: 'arn:aws:codeconnections:us-east-1:971764590821:connection/b620b065-7ffc-465b-b479-2d641abb4d44',
  },

  environments: [
    {
      name: 'dev',
      account: '533101977259',
      region: 'us-east-1',
      requiresApproval: false,
      vpc: {
        cidr: '10.10.0.0/16',
        maxAzs: 3,
        natGateways: 1, // Single NAT Gateway for cost optimization
        subnets: {
          publicCidrMask: 24,
          privateCidrMask: 24,
          protectedCidrMask: 24,
        },
      },
    }
  ]
};

export class AppConfig {
    public name: string;
    public version: string;
    public pipeline: {
        account: string;
        region: string;
        repositoryName: string;
        repositoryOwner: string;
        branch: string;
        connectionArn: string;
    };
    public environments: EnvironmentConfig[] = [];

}

export class EnvironmentConfig {
    public name: string;
    public account: string;
    public region: string;
    public requiresApproval: boolean;
    public vpc: {
        cidr: string;
        maxAzs: number;
        natGateways: number;
        subnets: {
            publicCidrMask: number;
            privateCidrMask: number;
            protectedCidrMask: number;
        };
    };
}